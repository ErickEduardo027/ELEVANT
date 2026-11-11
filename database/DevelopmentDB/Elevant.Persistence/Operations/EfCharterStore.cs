using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Charter flights (ADR-0033): the agent adds the services at Finance's base tariff and records the
/// carrier data the representative gives; Finance confirms the prepayment. Tablet writes follow the
/// mobile command contract (device receipt, assigned agent, serializable transaction, audit). Once
/// Finance confirms the prepayment no service is added until it reopens the quotation (3-N24); a
/// service not performed no longer counts in the prepayment total.
/// </summary>
internal sealed class EfCharterStore(ElevantDbContext context, TimeProvider timeProvider) : ICharterStore
{
    private const string AddServiceCommand = "ramp.charter.service.add.v1";
    private const string DetailsCommand = "ramp.charter.details.update.v1";
    private const string ReopenAction = "finance.charter.prepayment.reopen";
    private const string ConfirmAction = "finance.charter.prepayment.confirm";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<CharterView?> ReadForAgentAsync(Guid accountId, IReadOnlyCollection<Guid> stations, Guid operationId,
        CancellationToken cancellationToken = default)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actor = await authorization.ResolveActorAsync(accountId, stations, null, cancellationToken);
        if (!actor.IsSuccess) return null;
        var scope = await authorization.ResolveOperationAsync(actor.Access!, operationId, false, cancellationToken);
        return scope is null ? null : await ViewAsync(scope.Operation.Id, cancellationToken);
    }

    public async Task<CharterWriteResult> AddServiceAsync(CharterServiceWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        var runner = new RampReceiptRunner(context, timeProvider);
        var outcome = await runner.RunAsync(AddServiceCommand, request.ActorAccountId, request.AllowedStationIds,
            request.OperationId, request.InstallationId, request.IdempotencyKey,
            RampReceiptRunner.Hash(new { command = AddServiceCommand, operationId = request.OperationId,
                request.ServiceDefinitionId, request.Quantity }),
            async (scope, ct) =>
            {
                var operation = scope.Operation.Operation;
                var agreement = await AgreementAsync(operation.TurnaroundId, ct);
                if (agreement is null || !CanCapture(scope)) return RampProblemCodes.GenericConflict;
                // 3-N24: what the carrier prepaid is closed; a new service waits for Finance to reopen the quotation.
                if (agreement.PrepaymentStatus == CharterPrepaymentStatus.Confirmed) return CharterCodes.PrepaymentConfirmed;
                var definition = await context.ServiceDefinitions.AsNoTracking()
                    .Where(item => item.PublicId == request.ServiceDefinitionId && item.IsActive)
                    .Select(item => new { item.Id, item.Code }).SingleOrDefaultAsync(ct);
                if (definition is null) return RampProblemCodes.GenericConflict;
                var lines = await context.OperationServices.Where(item => item.GroundOperationId == operation.Id)
                    .Select(item => new { item.LineNumber, item.ServiceDefinitionId }).ToArrayAsync(ct);
                // One line per service: the quantity actually served is set when the agent completes it.
                if (lines.Any(line => line.ServiceDefinitionId == definition.Id)) return RampProblemCodes.GenericConflict;
                var rates = await FinanceTariffLookup.ServiceRatesAsync(context, agreement.CurrencyCode,
                    scope.Operation.OperationDate, scope.Operation.StationInternalId, [definition.Id], ct);
                if (!rates.TryGetValue(definition.Id, out var rate)) return RampProblemCodes.GenericConflict;
                var service = new OperationService
                {
                    PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id,
                    LineNumber = lines.Length == 0 ? 1 : lines.Max(line => line.LineNumber) + 1,
                    ServiceDefinitionId = definition.Id, ContractServiceRateId = null,
                    ContractedQuantity = Math.Max(request.Quantity, rate.MinimumBillableQuantity), ExecutedQuantity = 0m,
                    BillingUnitSnapshot = rate.BillingUnit, UnitPriceSnapshot = rate.UnitPrice,
                    CurrencyCodeSnapshot = agreement.CurrencyCode, CurrentStatus = ServiceExecutionStatus.Planned,
                    CreatedAt = scope.Now, UpdatedAt = scope.Now,
                };
                context.OperationServices.Add(service);
                await context.SaveChangesAsync(ct);
                context.Set<OperationServiceStatusEvent>().Add(new OperationServiceStatusEvent
                {
                    OperationServiceId = service.Id, FromStatus = null, ToStatus = ServiceExecutionStatus.Planned,
                    OccurredAt = scope.Now, Note = "Added on the ramp to a charter at the base tariff.",
                });
                runner.Audit(scope, request.RequestId, "ramp.charter.service.added",
                    "Assigned ramp agent added a charter service at the base tariff.", new
                    {
                        code = definition.Code, quantity = service.ContractedQuantity, unitPrice = rate.UnitPrice,
                        currency = agreement.CurrencyCode, installationId = request.InstallationId,
                    });
                return (string?)null;
            }, cancellationToken);
        return await ResultAsync(outcome, cancellationToken);
    }

    public async Task<CharterWriteResult> UpdateDetailsAsync(CharterDetailsWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        var runner = new RampReceiptRunner(context, timeProvider);
        var outcome = await runner.RunAsync(DetailsCommand, request.ActorAccountId, request.AllowedStationIds,
            request.OperationId, request.InstallationId, request.IdempotencyKey,
            RampReceiptRunner.Hash(new { command = DetailsCommand, operationId = request.OperationId,
                request.CarrierAddress, request.ChargesPayableBy }),
            async (scope, ct) =>
            {
                var agreement = await context.Set<CharterAgreement>()
                    .SingleOrDefaultAsync(item => item.TurnaroundId == scope.Operation.Operation.TurnaroundId, ct);
                if (agreement is null ||
                    !OperationDocumentRules.CanSign(scope.Operation.Operation.CurrentStatus,
                        scope.Operation.Operation.ActualStartAt) && !CanCapture(scope))
                    return false;
                var before = new { agreement.CarrierAddress, agreement.ChargesPayableBy };
                agreement.CarrierAddress = request.CarrierAddress;
                agreement.ChargesPayableBy = request.ChargesPayableBy;
                agreement.UpdatedAt = scope.Now;
                runner.Audit(scope, request.RequestId, "ramp.charter.details.updated",
                    "Assigned ramp agent recorded the charter carrier data.", new
                    {
                        before, request.CarrierAddress, request.ChargesPayableBy, installationId = request.InstallationId,
                    });
                return true;
            }, cancellationToken);
        return await ResultAsync(outcome, cancellationToken);
    }

    public async Task<IReadOnlyList<CharterPrepaymentItem>> ListForFinanceAsync(IReadOnlyCollection<Guid> stations,
        CancellationToken cancellationToken = default)
    {
        var allowed = stations.Where(id => id != Guid.Empty).Distinct().ToArray();
        var ids = await (from agreement in context.Set<CharterAgreement>().AsNoTracking()
                         join turnaround in context.Turnarounds.AsNoTracking() on agreement.TurnaroundId equals turnaround.Id
                         join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                         where allowed.Contains(station.PublicId)
                         orderby agreement.PrepaymentStatus, turnaround.OperationDate descending, agreement.Id descending
                         select agreement.Id).Take(200).ToArrayAsync(cancellationToken);
        var items = new List<CharterPrepaymentItem>(ids.Length);
        foreach (var id in ids) items.Add((await ItemAsync(id, cancellationToken))!);
        return items;
    }

    /// <summary>
    /// 4-N22: the confirmation is a command of its own (Idempotency-Key receipt, expected version, one serializable
    /// transaction). Pending becomes confirmed and settles the charter's invoice when it was already issued; the same
    /// amount and reference again change nothing; another amount or reference corrects a prepayment that never became a
    /// receipt, with its reason and the before and after in the audit. Once applied it is <c>charter_prepayment_applied</c>:
    /// Finance reverses that receipt, reopens the prepayment and confirms it again. A receipt of the airline posted at the
    /// same moment that takes what the prepayment's receipt needs (its reference, the invoice's account) is
    /// <c>charter_prepayment_receipt_conflict</c>, never a stale charter.
    /// </summary>
    public async Task<MasterDataResult<CharterPrepaymentItem>> ConfirmPrepaymentAsync(Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid charterId, decimal amount, string reference, string? reason,
        string expectedVersion, Guid idempotencyKey, string? requestId, CancellationToken cancellationToken = default)
    {
        var found = await FinanceScopeAsync(stations, charterId, cancellationToken);
        if (found is null) return MasterDataResult<CharterPrepaymentItem>.Failed(MasterDataFailure.NotFound, "not_found");
        var account = await context.Users.AsNoTracking().Where(user => user.PublicId == accountId)
            .Select(user => new { user.Id, user.UserName }).SingleOrDefaultAsync(cancellationToken);
        if (account is null) return MasterDataResult<CharterPrepaymentItem>.Failed(MasterDataFailure.NotFound, "not_found");
        var now = RampReceiptRunner.Truncate(timeProvider.GetUtcNow());
        var hash = CommercialCommandReceipts.Hash(new { charterId, amount, reference, reason, expected = expectedVersion });
        return await MasterDataCommand.RunAsync(context, idempotencyKey, account.Id, ConfirmAction, hash,
            CharterCodes.PrepaymentReceiptConflict, now, async () =>
            {
                var agreement = await context.Set<CharterAgreement>().SingleAsync(item => item.Id == found.AgreementId,
                    cancellationToken);
                if (MasterDataCommand.Version(agreement.RowVersion) != expectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                var confirmed = agreement.PrepaymentStatus == CharterPrepaymentStatus.Confirmed;
                // The prepayment already says this: nothing to write.
                if (confirmed && agreement.PrepaymentAmount == amount && agreement.PrepaymentReference == reference)
                    return Step.Done(agreement.PublicId);
                var before = new { amount = agreement.PrepaymentAmount, reference = agreement.PrepaymentReference };
                if (confirmed)
                {
                    if (reason is null) return Step.Fail(MasterDataFailure.Invalid, "reason_required");
                    // Even a reversed receipt closes the correction: the new amount is confirmed again from Pending.
                    if (await CharterPrepaymentPosting.HasReceiptAsync(context, agreement, true, cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, CharterCodes.PrepaymentApplied);
                }
                agreement.PrepaymentStatus = CharterPrepaymentStatus.Confirmed;
                agreement.PrepaymentAmount = amount;
                agreement.PrepaymentReference = reference;
                agreement.PrepaymentConfirmedAt = now;
                agreement.PrepaymentConfirmedByAccountId = account.Id;
                agreement.UpdatedAt = now;
                await context.SaveChangesAsync(cancellationToken);
                // Confirmed after the invoice: the prepayment settles it now, never twice.
                var applied = await CharterPrepaymentPosting.ApplyToIssuedInvoiceAsync(context, agreement, account.Id, now,
                    cancellationToken);
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = account.Id, ActorDisplay = account.UserName,
                    Action = confirmed ? "finance.charter.prepayment_corrected" : "finance.charter.prepayment_confirmed",
                    EntityType = nameof(CharterAgreement), EntityPublicId = agreement.PublicId,
                    OrganizationId = found.OrganizationId, StationId = found.StationId, Source = AuditSource.Api,
                    CorrelationId = Guid.CreateVersion7(), RequestId = requestId,
                    Reason = confirmed ? reason : "Finance confirmed the charter carrier's prepayment.",
                    MetadataJson = JsonSerializer.Serialize(new
                    {
                        amount, reference, turnaroundId = found.TurnaroundPublicId,
                        before = confirmed ? before : null,
                        appliedToInvoiceId = applied?.InvoiceId, applied = applied?.Applied,
                    }, Json),
                });
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(agreement.PublicId);
            }, _ => ItemAsync(found.AgreementId, cancellationToken), cancellationToken);
    }

    /// <summary>The charter of one of Finance's stations, with what its commands audit.</summary>
    private async Task<FinanceCharterScope?> FinanceScopeAsync(IReadOnlyCollection<Guid> stations, Guid charterId,
        CancellationToken cancellationToken)
    {
        var allowed = stations.Where(id => id != Guid.Empty).Distinct().ToArray();
        return await (from agreement in context.Set<CharterAgreement>().AsNoTracking()
                      join turnaround in context.Turnarounds.AsNoTracking() on agreement.TurnaroundId equals turnaround.Id
                      join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                      join airline in context.Airlines.AsNoTracking() on agreement.AirlineId equals airline.Id
                      where agreement.PublicId == charterId && allowed.Contains(station.PublicId)
                      select new FinanceCharterScope(agreement.Id, station.Id, airline.OrganizationId, turnaround.PublicId,
                          context.GroundOperations.Where(item => item.TurnaroundId == turnaround.Id)
                              .Select(item => (long?)item.Id).FirstOrDefault()))
            .SingleOrDefaultAsync(cancellationToken);
    }

    private sealed record FinanceCharterScope(long AgreementId, long StationId, long OrganizationId,
        Guid TurnaroundPublicId, long? OperationId);

    public async Task<MasterDataResult<CharterPrepaymentItem>> ReopenPrepaymentAsync(Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid charterId, string reason, string expectedVersion, Guid idempotencyKey,
        string? requestId, CancellationToken cancellationToken = default)
    {
        var found = await FinanceScopeAsync(stations, charterId, cancellationToken);
        if (found is null) return MasterDataResult<CharterPrepaymentItem>.Failed(MasterDataFailure.NotFound, "not_found");
        var account = await context.Users.AsNoTracking().Where(user => user.PublicId == accountId)
            .Select(user => new { user.Id, user.UserName }).SingleOrDefaultAsync(cancellationToken);
        if (account is null) return MasterDataResult<CharterPrepaymentItem>.Failed(MasterDataFailure.NotFound, "not_found");
        var now = RampReceiptRunner.Truncate(timeProvider.GetUtcNow());
        var hash = CommercialCommandReceipts.Hash(new { charterId, reason, expected = expectedVersion });
        return await MasterDataCommand.RunAsync(context, idempotencyKey, account.Id, ReopenAction, hash, "version_conflict",
            now, async () =>
            {
                var agreement = await context.Set<CharterAgreement>().SingleAsync(item => item.Id == found.AgreementId,
                    cancellationToken);
                if (MasterDataCommand.Version(agreement.RowVersion) != expectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                if (agreement.PrepaymentStatus != CharterPrepaymentStatus.Confirmed)
                    return Step.Fail(MasterDataFailure.Conflict, CharterCodes.PrepaymentNotConfirmed);
                // 4-N22: a prepayment that settled the invoice is reopened only after Finance reverses its receipt.
                if (await CharterPrepaymentPosting.HasReceiptAsync(context, agreement, false, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, CharterCodes.PrepaymentApplied);
                var before = new
                {
                    amount = agreement.PrepaymentAmount, reference = agreement.PrepaymentReference,
                    confirmedAt = agreement.PrepaymentConfirmedAt,
                };
                // A new quotation: the amount and the reference stay until Finance confirms it again.
                agreement.PrepaymentStatus = CharterPrepaymentStatus.Pending;
                agreement.PrepaymentConfirmedAt = null;
                agreement.PrepaymentConfirmedByAccountId = null;
                agreement.UpdatedAt = now;
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = account.Id, ActorDisplay = account.UserName,
                    Action = "finance.charter.prepayment_reopened", EntityType = nameof(CharterAgreement),
                    EntityPublicId = agreement.PublicId, OrganizationId = found.OrganizationId, StationId = found.StationId,
                    Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(), RequestId = requestId, Reason = reason,
                    MetadataJson = JsonSerializer.Serialize(new { before, turnaroundId = found.TurnaroundPublicId }, Json),
                });
                // The agent's tablet hears that services can be added again.
                if (found.OperationId is long operationId)
                    await RampOperationChangeWriter.AnnounceAsync(context, operationId, now, false, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(agreement.PublicId);
            }, _ => ItemAsync(found.AgreementId, cancellationToken), cancellationToken);
    }

    /// <summary>The agent captures charter data while the operation is assigned or being executed.</summary>
    private static bool CanCapture(RampReceiptScope scope)
    {
        var operation = scope.Operation.Operation;
        return operation.CurrentStatus == GroundOperationStatus.Assigned ||
               RampOperationExecutionPolicy.CanExecute(scope.Operation.TurnaroundStatus, operation.CurrentStatus,
                   operation.ActualStartAt, operation.ActualEndAt);
    }

    private Task<CharterAgreement?> AgreementAsync(long turnaroundId, CancellationToken cancellationToken) =>
        context.Set<CharterAgreement>().AsNoTracking().SingleOrDefaultAsync(item => item.TurnaroundId == turnaroundId,
            cancellationToken);

    private async Task<CharterWriteResult> ResultAsync(RampReceiptOutcome outcome, CancellationToken cancellationToken)
    {
        if (!outcome.IsSuccess) return new CharterWriteResult(null, outcome.Failure, outcome.ReceiptId, outcome.Code);
        var view = await ViewAsync(outcome.OperationId, cancellationToken);
        return view is null
            ? new CharterWriteResult(null, RampExecutionWriteFailure.NotFound, outcome.ReceiptId)
            : new CharterWriteResult(view, null, outcome.ReceiptId);
    }

    /// <summary>The charter of an operation and the services the agent can add, with their base price.</summary>
    private async Task<CharterView?> ViewAsync(long operationId, CancellationToken cancellationToken)
    {
        var head = await (from operation in context.GroundOperations.AsNoTracking()
                          join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                          join agreement in context.Set<CharterAgreement>().AsNoTracking()
                              on turnaround.Id equals agreement.TurnaroundId
                          where operation.Id == operationId
                          select new { operation.PublicId, turnaround.OperationDate, turnaround.StationId, agreement })
            .SingleOrDefaultAsync(cancellationToken);
        if (head is null) return null;
        var definitions = await context.ServiceDefinitions.AsNoTracking().Where(item => item.IsActive)
            .OrderBy(item => item.DisplayOrder).ThenBy(item => item.Name)
            .Select(item => new { item.Id, item.PublicId, item.Code, item.Name }).ToArrayAsync(cancellationToken);
        var rates = await FinanceTariffLookup.ServiceRatesAsync(context, head.agreement.CurrencyCode, head.OperationDate,
            head.StationId, definitions.Select(item => item.Id).ToArray(), cancellationToken);
        return new CharterView(head.PublicId, head.agreement.PublicId, head.agreement.CurrencyCode,
            head.agreement.CarrierAddress, head.agreement.ChargesPayableBy, head.agreement.PrepaymentStatus.ToString(),
            head.agreement.PrepaymentAmount,
            definitions.Where(item => rates.ContainsKey(item.Id)).Select(item => new CharterCatalogItem(item.PublicId,
                item.Code, item.Name, rates[item.Id].BillingUnit, rates[item.Id].UnitPrice,
                rates[item.Id].MinimumBillableQuantity)).ToArray());
    }

    private async Task<CharterPrepaymentItem?> ItemAsync(long agreementId, CancellationToken cancellationToken)
    {
        var row = await (from agreement in context.Set<CharterAgreement>().AsNoTracking()
                         join turnaround in context.Turnarounds.AsNoTracking() on agreement.TurnaroundId equals turnaround.Id
                         join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                         join airline in context.Airlines.AsNoTracking() on agreement.AirlineId equals airline.Id
                         join operation in context.GroundOperations.AsNoTracking() on turnaround.Id equals operation.TurnaroundId
                         where agreement.Id == agreementId
                         select new
                         {
                             agreement, OperationId = operation.Id, OperationPublicId = operation.PublicId,
                             turnaround.OperationCode, turnaround.OperationDate, StationCode = station.Code,
                             AirlineName = airline.Name,
                         }).FirstOrDefaultAsync(cancellationToken);
        if (row is null) return null;
        var lines = await context.OperationServices.AsNoTracking().Where(item => item.GroundOperationId == row.OperationId)
            .Select(item => new { item.UnitPriceSnapshot, item.ExecutedQuantity, item.ContractedQuantity, item.CurrentStatus })
            .ToArrayAsync(cancellationToken);
        // 3-N24: a service not performed (added by mistake or not served) is not prepaid.
        decimal? total = lines.Length == 0 ? null
            : lines.Where(line => line.CurrentStatus != ServiceExecutionStatus.NotPerformed)
                .Sum(line => (line.UnitPriceSnapshot ?? 0m) *
                    (line.ExecutedQuantity > 0 ? line.ExecutedQuantity : line.ContractedQuantity));
        var required = OperationDocumentRules.RolesFor(OperationDocumentKind.CharterServiceRequest);
        var signedRoles = await (from version in context.Set<OperationDocumentVersion>().AsNoTracking()
                                 join signature in context.Set<OperationDocumentSignature>().AsNoTracking()
                                     on version.Id equals signature.OperationDocumentVersionId
                                 where version.GroundOperationId == row.OperationId &&
                                       version.Kind == OperationDocumentKind.CharterServiceRequest
                                 select new { version.Id, signature.Role }).ToArrayAsync(cancellationToken);
        var signed = signedRoles.GroupBy(item => item.Id)
            .Any(group => required.All(role => group.Any(item => item.Role == role)));
        return new CharterPrepaymentItem(row.agreement.PublicId, row.OperationPublicId, row.OperationCode, row.OperationDate,
            row.StationCode, row.AirlineName, row.agreement.CurrencyCode, total is null ? null : decimal.Round(total.Value, 2),
            signed, row.agreement.PrepaymentStatus.ToString(), row.agreement.PrepaymentAmount,
            row.agreement.PrepaymentReference, row.agreement.PrepaymentConfirmedAt,
            MasterDataCommand.Version(row.agreement.RowVersion));
    }
}
