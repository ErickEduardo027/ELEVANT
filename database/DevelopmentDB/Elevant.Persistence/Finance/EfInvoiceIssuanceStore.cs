using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>
/// Issues one simulated e-CF invoice from completed operations in a single transaction (ADR-0035):
/// it values the approved services through the internal draft (packages, minimums, charges),
/// applies ITBIS 18 %, issues the invoice with its e-NCF, settles a charter with its confirmed
/// prepayment and queues the invoice email. No preinvoice is ever left visible or pending: any
/// failure rolls the whole transaction back, so the operations stay in «Por facturar» (4-N01), and
/// an older draft left without invoice is released on the way (<see cref="StaleInternalDrafts"/>).
/// </summary>
internal sealed class EfInvoiceIssuanceStore(
    ElevantDbContext context, TimeProvider timeProvider,
    EfPreinvoiceDraftStore drafts, EfFinanceInvoiceIssueStore issues) : IInvoiceIssuanceStore
{
    /// <summary>Receipt action of the no-charge closure (4-N07) in <see cref="CommercialCommandReceipts"/>.</summary>
    internal const string NoChargeAction = "finance.invoicing.no_charge";

    /// <summary>Receipt action of an issuance from operations (4-N29) in <see cref="CommercialCommandReceipts"/>.</summary>
    internal const string IssueAction = "finance.invoice.issue";

    /// <summary>
    /// 4-N29: what a request id stands for: the station, the operations and the versions they were sent with (none for
    /// an older client). The same key with any other body is <c>idempotency_conflict</c>, never the earlier invoice.
    /// </summary>
    internal static string IssueHash(IssueInvoiceRequest request) => CommercialCommandReceipts.Hash(new
    {
        route = IssueAction, stationId = request.StationId,
        operations = request.OperationIds.Distinct().Order().ToArray(),
        versions = request.OperationVersions?.OrderBy(item => item.OperationId)
            .Select(item => new { item.OperationId, item.Version }).ToArray(),
    });

    public async Task<IssueInvoiceResult> IssueAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var attempt = await IssueInsideTransactionAsync(request, cancellationToken);
                if (!attempt.IsSuccess)
                {
                    // 4-N01: a refusal writes nothing, the internal draft and its reserved lines included.
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return attempt;
                }
                await transaction.CommitAsync(cancellationToken);
                return attempt;
            });
        }
        catch (Exception exception) when (exception is DbUpdateException or RetryLimitExceededException or SqlException &&
            exception.GetBaseException() is SqlException { Number: 2601 or 2627 or 1205 or 1222 or 3960 })
        {
            context.ChangeTracker.Clear();
            return await ReplayAsync(request, cancellationToken) ??
                IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.StateChanged);
        }
    }

    private async Task<IssueInvoiceResult> IssueInsideTransactionAsync(IssueInvoiceRequest request,
        CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(request.AccountId, cancellationToken);
        if (actor is null || !actor.HasPermission(IssueInvoiceHandler.IssuePermission) ||
            !actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Forbidden, InvoicingCodes.Forbidden);
        if (await ReplayAsync(request, cancellationToken) is { } replay) return replay;
        // 4-N29: a key a no-charge closure or an older draft without invoice already used is not this request.
        if (await context.Preinvoices.AsNoTracking().AnyAsync(item => item.RequestId == request.RequestId, cancellationToken))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.IdempotencyConflict);

        var now = timeProvider.GetUtcNow();
        var prepared = await PrepareAsync(actor, request.StationId, request.OperationIds,
            request.OperationVersions, request.RequestId, now, cancellationToken);
        if (prepared.Failure is { } failure) return IssueInvoiceResult.Failed(failure, prepared.Code);
        var preinvoice = prepared.Draft!;
        // 4-N07: an invoice of zero is never issued: no e-NCF is used and no email is queued.
        if (preinvoice.Total == 0m)
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Unprocessable, InvoicingCodes.ZeroTotal);
        if (prepared.Lines!.Count(line => !line.IsExcluded) > FinanceInvoicePolicy.MaxLines)
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Unprocessable, InvoicingCodes.TooManyLines);
        // The draft is internal: accepted on the spot and issued in the same transaction.
        preinvoice.Status = PreinvoiceStatus.Accepted;
        preinvoice.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);

        var issued = await issues.IssueForInvoicingAsync(
            new IssueFinanceInvoiceCommand(request.AccountId, preinvoice.PublicId, request.RequestId), cancellationToken);
        if (!issued.IsSuccess)
            return issued.Failure == IssueFinanceInvoiceFailure.Forbidden
                ? IssueInvoiceResult.Failed(IssueInvoiceFailure.Forbidden, InvoicingCodes.Forbidden)
                : IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.StateChanged);
        var invoice = await context.NonFiscalInvoices.SingleAsync(item => item.PublicId == issued.InvoiceId, cancellationToken);
        var accountId = invoice.IssuedByAccountId;

        // A charter is prepaid: its confirmed prepayment settles the invoice up to its total (4-N22: once, as the receipt
        // that names the charter).
        var turnaroundIds = prepared.Operations.Select(item => item.TurnaroundId).Distinct().ToArray();
        var charters = await context.Set<CharterAgreement>().AsNoTracking()
            .Where(item => turnaroundIds.Contains(item.TurnaroundId) && item.PrepaymentStatus == CharterPrepaymentStatus.Confirmed &&
                item.PrepaymentAmount > 0)
            .OrderBy(item => item.Id).ToArrayAsync(cancellationToken);
        decimal prepaid = 0m;
        foreach (var charter in charters)
            prepaid += (await CharterPrepaymentPosting.PostAsync(context, invoice, charter, accountId, now,
                cancellationToken))?.Applied ?? 0m;

        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == invoice.AirlineId)
            .Select(item => new { item.OrganizationId, item.PublicId }).SingleAsync(cancellationToken);
        var airlineOrganization = airline.OrganizationId;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName, Action = "finance.invoice.issued", EntityType = nameof(NonFiscalInvoice),
            EntityPublicId = invoice.PublicId, OrganizationId = airlineOrganization, StationId = invoice.StationId,
            Source = AuditSource.Api, CorrelationId = request.RequestId, RequestId = request.RequestId.ToString("D"),
            Reason = "Finanzas emitió la factura (e-CF simulado) de operaciones completadas.",
            MetadataJson = JsonSerializer.Serialize(new { fiscalNumber = invoice.FiscalNumber, total = invoice.Total,
                operations = request.OperationIds, prepaid }),
        });
        await InvoiceEmails.QueueIssuedAsync(context, invoice, prepaid, now, cancellationToken);
        await AirlineOperationChangeWriter.AddTreasuryAsync(context, airlineOrganization, airline.PublicId, now, cancellationToken);
        // 4-N11: «Por facturar» hears each invoiced operation by its own id (the feed only delivers an approved operation
        // of the station), and «Facturas» hears the new invoice.
        await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId,
            prepared.Operations.Select(item => item.PublicId).ToArray(), now, "finance_approved_services", cancellationToken);
        await FinanceApprovedServiceChangeWriter.AddInvoicesAsync(context, invoice.StationId, [invoice.PublicId], now,
            cancellationToken);
        await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId, invoice.PublicId, now,
            "finance_receipts", cancellationToken);
        // 4-N29: the receipt of the request id keeps the body it stands for, versions included.
        CommercialCommandReceipts.Add(context, request.RequestId, accountId, IssueAction, IssueHash(request),
            invoice.PublicId, now);
        await context.SaveChangesAsync(cancellationToken);
        return IssueInvoiceResult.Success(invoice.PublicId, invoice.Number, invoice.FiscalNumber!, invoice.Total,
            invoice.CurrencyCode, false);
    }

    /// <summary>
    /// 4-N07: closes operations whose valuation is zero without an invoice. It runs the same preparation as an
    /// issuance (versions, active station and airline, the internal draft with packages, minimums, charges and ITBIS)
    /// and keeps the draft as <see cref="PreinvoiceStatus.NoCharge"/>, so the services leave «Por facturar» and the
    /// package consumption stays recorded for the next invoice. The Idempotency-Key replays the first closure; another
    /// body with the key is <c>idempotency_conflict</c>.
    /// </summary>
    public async Task<NoChargeClosureResult> CloseWithoutChargeAsync(NoChargeClosureCommand request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(request.AccountId, cancellationToken);
        if (actor is null || !actor.HasPermission(IssueInvoiceHandler.IssuePermission) ||
            !actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.Forbidden, InvoicingCodes.Forbidden);
        var accountId = await context.Users.AsNoTracking().Where(item => item.PublicId == request.AccountId)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (accountId is null) return NoChargeClosureResult.Failed(IssueInvoiceFailure.Forbidden, InvoicingCodes.Forbidden);

        var operations = request.Operations.OrderBy(item => item.OperationId).ToArray();
        var hash = CommercialCommandReceipts.Hash(new
        {
            route = NoChargeAction, stationId = request.StationId,
            operations = operations.Select(item => new { item.OperationId, item.Version }).ToArray(),
            reason = request.Reason,
        });
        var now = timeProvider.GetUtcNow();
        var result = await MasterDataCommand.RunAsync(context, request.IdempotencyKey, accountId.Value, NoChargeAction, hash,
            InvoicingCodes.VersionConflict, now, async () =>
            {
                // A key an issuance or an older draft already used is not this closure.
                if (await context.Preinvoices.AsNoTracking().AnyAsync(item => item.RequestId == request.IdempotencyKey,
                        cancellationToken) ||
                    await context.NonFiscalInvoices.AsNoTracking().AnyAsync(item => item.RequestId == request.IdempotencyKey,
                        cancellationToken))
                    return MasterDataCommand.Step.Fail(MasterDataFailure.Conflict, InvoicingCodes.IdempotencyConflict);
                var prepared = await PrepareAsync(actor, request.StationId,
                    operations.Select(item => item.OperationId).ToArray(), operations, request.IdempotencyKey, now,
                    cancellationToken);
                if (prepared.Failure is { } failure) return MasterDataCommand.Step.Fail(failure switch
                {
                    IssueInvoiceFailure.Forbidden => MasterDataFailure.Forbidden,
                    IssueInvoiceFailure.NotFound => MasterDataFailure.NotFound,
                    IssueInvoiceFailure.Conflict => MasterDataFailure.Conflict,
                    _ => MasterDataFailure.Invalid,
                }, prepared.Code!);
                var draft = prepared.Draft!;
                if (draft.Total != 0m)
                    return MasterDataCommand.Step.Fail(MasterDataFailure.Invalid, InvoicingCodes.OperationHasCharge);
                draft.Status = PreinvoiceStatus.NoCharge;
                draft.UpdatedAt = now;
                var operationIds = prepared.Operations.Select(item => item.PublicId).Order().ToArray();
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = accountId.Value, ActorDisplay = actor.DisplayName,
                    Action = "finance.invoicing.closed_no_charge", EntityType = nameof(Preinvoice),
                    EntityPublicId = draft.PublicId, StationId = draft.StationId, Source = AuditSource.Api,
                    CorrelationId = request.IdempotencyKey, RequestId = request.IdempotencyKey.ToString("D"),
                    Reason = request.Reason,
                    MetadataJson = JsonSerializer.Serialize(new { stationId = request.StationId, operations = operationIds }),
                });
                foreach (var operationId in operationIds)
                    await FinanceApprovedServiceChangeWriter.AddAsync(context, draft.StationId, operationId, now,
                        "finance_approved_services", cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return MasterDataCommand.Step.Done(draft.PublicId);
            }, closureId => ClosureAsync(closureId, cancellationToken), cancellationToken);
        if (result.Value is { } closure) return NoChargeClosureResult.Success(closure, result.Replayed);
        return NoChargeClosureResult.Failed(result.Failure switch
        {
            MasterDataFailure.Forbidden => IssueInvoiceFailure.Forbidden,
            MasterDataFailure.NotFound => IssueInvoiceFailure.NotFound,
            MasterDataFailure.Conflict => IssueInvoiceFailure.Conflict,
            _ => IssueInvoiceFailure.Unprocessable,
        }, result.Code ?? InvoicingCodes.StateChanged);
    }

    private async Task<NoChargeClosureData?> ClosureAsync(Guid closureId, CancellationToken cancellationToken)
    {
        var draftId = await context.Preinvoices.AsNoTracking()
            .Where(item => item.PublicId == closureId && item.Status == PreinvoiceStatus.NoCharge)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (draftId is null) return null;
        return new NoChargeClosureData(closureId, await OperationsOfDraftAsync(draftId.Value, cancellationToken));
    }

    /// <summary>The operations whose services an internal draft holds, read from its service lines.</summary>
    private async Task<Guid[]> OperationsOfDraftAsync(long draftId, CancellationToken cancellationToken) =>
        (await (from line in context.PreinvoiceLines.AsNoTracking()
                join service in context.OperationServices.AsNoTracking() on line.OperationServiceId equals (long?)service.Id
                join operation in context.GroundOperations.AsNoTracking() on service.GroundOperationId equals operation.Id
                where line.PreinvoiceId == draftId && line.Kind == PreinvoiceLineKind.Service
                select operation.PublicId).Distinct().ToArrayAsync(cancellationToken)).Order().ToArray();

    private sealed record OperationRow(long Id, Guid PublicId, GroundOperationStatus Status, byte[] RowVersion,
        DateOnly OperationDate, long TurnaroundId, long AirlineId, long StationId, bool StationActive, bool AirlineActive);

    private sealed record Prepared(IssueInvoiceFailure? Failure, string? Code, Preinvoice? Draft, List<PreinvoiceLine>? Lines,
        OperationRow[] Operations)
    {
        public static Prepared Fail(IssueInvoiceFailure failure, string code) => new(failure, code, null, null, []);
    }

    /// <summary>
    /// What an issuance and a no-charge closure share, before anything they write is kept: the operations of the
    /// station with the versions the caller saw, the active station, airline and customer organization, the approval,
    /// one airline within <see cref="FinanceInvoicePolicy.MaxDays"/> days, the billable services free of other drafts
    /// (an older draft without invoice in their way is released, 4-N01), and the internal draft valued with ITBIS 18 %
    /// (tracked, not saved).
    /// </summary>
    private async Task<Prepared> PrepareAsync(Elevant.Application.Identity.ActorContext actor, Guid stationId,
        IReadOnlyList<Guid> operationIds, IReadOnlyList<InvoiceOperationVersion>? versions, Guid requestId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var requested = operationIds.ToArray();
        var operations = await (from operation in context.GroundOperations.AsNoTracking()
                                join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                                join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                                join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                                join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                                where requested.Contains(operation.PublicId) && station.PublicId == stationId
                                select new OperationRow(operation.Id, operation.PublicId, operation.CurrentStatus,
                                    operation.RowVersion, turnaround.OperationDate, turnaround.Id, turnaround.AirlineId,
                                    station.Id, station.IsActive,
                                    airline.IsActive && organization.Type == OrganizationType.AirlineCustomer &&
                                        organization.Status == OrganizationStatus.Active))
            .ToArrayAsync(cancellationToken);
        if (operations.Length != requested.Length) return Prepared.Fail(IssueInvoiceFailure.NotFound, InvoicingCodes.NotFound);
        if (versions is not null)
        {
            var seen = versions.ToDictionary(item => item.OperationId, item => item.Version);
            if (operations.Any(item => !seen.TryGetValue(item.PublicId, out var version) ||
                    version != MasterDataCommand.Version(item.RowVersion)))
                return Prepared.Fail(IssueInvoiceFailure.Conflict, InvoicingCodes.VersionConflict);
        }
        // 4-N01: what the issuance would refuse after writing is refused before.
        if (operations.Any(item => !item.StationActive))
            return Prepared.Fail(IssueInvoiceFailure.Unprocessable, InvoicingCodes.StationInactive);
        if (operations.Any(item => !item.AirlineActive))
            return Prepared.Fail(IssueInvoiceFailure.Unprocessable, InvoicingCodes.AirlineInactive);
        if (operations.Any(item => item.Status != GroundOperationStatus.Approved))
            return Prepared.Fail(IssueInvoiceFailure.Conflict, InvoicingCodes.OperationNotApproved);
        if (operations.Select(item => item.AirlineId).Distinct().Count() != 1)
            return Prepared.Fail(IssueInvoiceFailure.Unprocessable, InvoicingCodes.MixedAirline);
        var from = operations.Min(item => item.OperationDate);
        var to = operations.Max(item => item.OperationDate);
        if (!FinanceInvoicePolicy.FitsWindow(from, to))
            return Prepared.Fail(IssueInvoiceFailure.Unprocessable, InvoicingCodes.DateWindowExceeded);

        var internalIds = operations.Select(item => item.Id).ToArray();
        // ServiceBillability (3-N11): a completed service or one in exception with its executed quantity is invoiced;
        // one not performed, or excluded by OCC in the review, is not.
        var services = await context.OperationServices.AsNoTracking()
            .Where(service => internalIds.Contains(service.GroundOperationId))
            .Where(ServiceBillability.Billable)
            .Select(service => new { service.Id, service.PublicId, service.GroundOperationId, service.ContractServiceRateId })
            .ToArrayAsync(cancellationToken);
        if (operations.Any(item => services.All(service => service.GroundOperationId != item.Id)))
            return Prepared.Fail(IssueInvoiceFailure.Unprocessable, InvoicingCodes.NothingToInvoice);
        if (services.Length > FinanceInvoicePolicy.MaxLines)
            return Prepared.Fail(IssueInvoiceFailure.Unprocessable, InvoicingCodes.TooManyLines);
        var serviceIds = services.Select(service => service.Id).ToArray();
        // 4-N01: an older draft without invoice that holds these services, or the consumption of their packages at the
        // station, has no way out of its own any more: it is released here, inside this transaction.
        var rateIds = services.Where(service => service.ContractServiceRateId != null)
            .Select(service => service.ContractServiceRateId!.Value).Distinct().ToArray();
        var stale = await StaleInternalDrafts.HoldingAsync(context, serviceIds, cancellationToken);
        if (rateIds.Length > 0)
            stale = stale.Union(await StaleInternalDrafts.ConsumingAsync(context, operations[0].StationId, rateIds,
                cancellationToken)).ToArray();
        await StaleInternalDrafts.ReleaseAsync(context, stale, actor.AccountId, actor.DisplayName, requestId, now,
            cancellationToken);
        // A service held by an invoice or a closure was invoiced; a draft an invoice issued that still holds one (it was
        // never marked invoiced) is never released and keeps blocking it by name.
        var holders = await (from line in context.PreinvoiceLines.AsNoTracking()
                             join draft in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals draft.Id
                             where line.Kind == PreinvoiceLineKind.Service && line.OperationServiceId != null &&
                                   serviceIds.Contains(line.OperationServiceId.Value) && line.ReleasedAt == null
                             select draft.Status).Distinct().ToArrayAsync(cancellationToken);
        if (holders.Any(status => status is PreinvoiceStatus.Invoiced or PreinvoiceStatus.NoCharge))
            return Prepared.Fail(IssueInvoiceFailure.Conflict, InvoicingCodes.AlreadyInvoiced);
        if (holders.Length > 0) return Prepared.Fail(IssueInvoiceFailure.Conflict, InvoicingCodes.PendingPreinvoice);

        var valued = await drafts.DraftForInvoiceAsync(new CreatePreinvoiceDraftCommand(actor.AccountId, stationId, from, to,
            requestId, services.Select(service => service.PublicId).ToArray()), cancellationToken);
        if (!valued.IsSuccess)
            return Prepared.Fail(valued.Failure switch
            {
                PreinvoiceDraftFailure.NotFound => IssueInvoiceFailure.NotFound,
                PreinvoiceDraftFailure.Conflict => IssueInvoiceFailure.Conflict,
                PreinvoiceDraftFailure.Forbidden => IssueInvoiceFailure.Forbidden,
                _ => IssueInvoiceFailure.Unprocessable,
            }, valued.Reason switch
            {
                // 4-N06: the draft's own window and size limits are the invoice's.
                "invalid_range" => InvoicingCodes.DateWindowExceeded,
                "invalid_selection" => InvoicingCodes.TooManyLines,
                { } reason => reason,
                null => valued.Failure switch
                {
                    PreinvoiceDraftFailure.Conflict => InvoicingCodes.AlreadyInvoiced,
                    PreinvoiceDraftFailure.NotFound => InvoicingCodes.NotFound,
                    PreinvoiceDraftFailure.Forbidden => InvoicingCodes.Forbidden,
                    _ => InvoicingCodes.InvalidRequest,
                },
            });

        // The draft is internal: ITBIS 18 % on every line.
        var preinvoice = await context.Preinvoices.SingleAsync(item => item.PublicId == valued.DraftId, cancellationToken);
        var lines = await context.PreinvoiceLines.Where(line => line.PreinvoiceId == preinvoice.Id).ToListAsync(cancellationToken);
        foreach (var line in lines) FinanceInvoicePolicy.ApplyItbis(line, now);
        preinvoice.Total = lines.Where(line => !line.IsExcluded).Sum(line => line.Amount);
        return new Prepared(null, null, preinvoice, lines, operations);
    }

    /// <summary>
    /// The same request again returns the invoice it issued (ADR-0035). 4-N29: only for the same account and body — the
    /// station, the operations and their versions, kept in the request id's receipt; any other use of the key, a
    /// no-charge closure's included, is <c>idempotency_conflict</c>. An invoice issued before its receipt existed is
    /// compared by its account, station and operations, read from its lines.
    /// </summary>
    private async Task<IssueInvoiceResult?> ReplayAsync(IssueInvoiceRequest request, CancellationToken cancellationToken)
    {
        var accountId = await context.Users.AsNoTracking().Where(item => item.PublicId == request.AccountId)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        var receipt = accountId is { } actorAccountId
            ? await CommercialCommandReceipts.FindAsync(context, request.RequestId, actorAccountId, IssueAction,
                IssueHash(request), cancellationToken)
            : default;
        if (receipt.Outcome == CommercialCommandReceipts.Outcome.Conflict)
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.IdempotencyConflict);
        var prior = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                           join account in context.Users.AsNoTracking() on invoice.IssuedByAccountId equals account.Id
                           join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
                           where invoice.RequestId == request.RequestId
                           select new { invoice.PublicId, invoice.Number, invoice.FiscalNumber, invoice.Total,
                               invoice.CurrencyCode, invoice.PreinvoiceId, AccountId = account.PublicId,
                               StationId = station.PublicId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is null)
            return receipt.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.IdempotencyConflict)
                : null;
        if (prior.AccountId != request.AccountId || prior.StationId != request.StationId || prior.FiscalNumber is null)
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.IdempotencyConflict);
        if (receipt.Outcome == CommercialCommandReceipts.Outcome.Replay)
            return receipt.ResultId == prior.PublicId
                ? IssueInvoiceResult.Success(prior.PublicId, prior.Number, prior.FiscalNumber, prior.Total, prior.CurrencyCode,
                    true)
                : IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.IdempotencyConflict);
        var invoiced = await OperationsOfDraftAsync(prior.PreinvoiceId, cancellationToken);
        return invoiced.SequenceEqual(request.OperationIds.Distinct().Order())
            ? IssueInvoiceResult.Success(prior.PublicId, prior.Number, prior.FiscalNumber, prior.Total, prior.CurrencyCode, true)
            : IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, InvoicingCodes.IdempotencyConflict);
    }
}
