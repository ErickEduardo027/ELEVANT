using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Application.Commercial;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>Serializes source-line reservation and immutable draft snapshots.</summary>
internal sealed class EfPreinvoiceDraftStore(
    ElevantDbContext context, TimeProvider timeProvider) : IPreinvoiceDraftStore
{
    public async Task<IReadOnlyList<PreinvoiceDisputeData>?> GetDisputesAsync(
        Guid accountId, Guid draftId, CancellationToken cancellationToken = default)
    {
        if (await GetAsync(accountId, draftId, cancellationToken) is null) return null;
        var now = timeProvider.GetUtcNow();
        var internalId = await (
            from item in context.Preinvoices.AsNoTracking()
            join station in context.Stations.AsNoTracking() on item.StationId equals station.Id
            join account in context.Users.AsNoTracking() on accountId equals account.PublicId
            join grant in context.AccountStationScopes.AsNoTracking()
                on new { AccountId = account.Id, StationId = station.Id }
                equals new { grant.AccountId, grant.StationId }
            where item.PublicId == draftId && grant.GrantedAt <= now && grant.RevokedAt == null
            select (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        return internalId is null ? null : await PreinvoiceDisputeReader.ReadAsync(
            context, internalId.Value, cancellationToken);
    }

    public async Task<PreinvoiceDraftDetail?> GetAsync(
        Guid accountId, Guid draftId, CancellationToken cancellationToken = default)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.preinvoices.read") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return null;
        var allowedStationIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var now = timeProvider.GetUtcNow();
        var draft = await (
            from item in context.Preinvoices.AsNoTracking()
            join airline in context.Airlines.AsNoTracking() on item.AirlineId equals airline.Id
            join station in context.Stations.AsNoTracking() on item.StationId equals station.Id
            where item.PublicId == draftId && allowedStationIds.Contains(station.PublicId) &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == accountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new
            {
                item.Id, item.PublicId, item.From, item.To, item.CurrencyCode,
                item.Total, item.Status, AirlineId = airline.PublicId,
                AirlineName = airline.Name, StationId = station.PublicId, item.RowVersion,
            }).SingleOrDefaultAsync(cancellationToken);
        if (draft is null) return null;

        var lines = await (
            from line in context.PreinvoiceLines.AsNoTracking()
            join serviceCandidate in context.OperationServices.AsNoTracking()
                on line.OperationServiceId equals (long?)serviceCandidate.Id into services
            from service in services.DefaultIfEmpty()
            join submissionCandidate in context.OperationSubmissions.AsNoTracking()
                on line.ApprovedSubmissionId equals (long?)submissionCandidate.Id into submissions
            from submission in submissions.DefaultIfEmpty()
            join parentCandidate in context.PreinvoiceLines.AsNoTracking()
                on line.ParentLineId equals (long?)parentCandidate.Id into parents
            from parent in parents.DefaultIfEmpty()
            where line.PreinvoiceId == draft.Id
            orderby line.LineNumber
            select new PreinvoiceDraftLineDetail(
                line.PublicId, service == null ? null : service.PublicId,
                submission == null ? null : submission.PublicId,
                line.LineNumber, line.OperationCode, line.OperationDate,
                line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.CurrencyCode, line.Amount,
                line.Kind.ToString(), parent == null ? null : parent.PublicId, line.ComputedQuantity,
                line.ComputedAmount, line.IsExcluded, line.AdjustmentReason, line.EditedAt))
            .ToArrayAsync(cancellationToken);
        return new PreinvoiceDraftDetail(draft.PublicId, draft.AirlineId,
            draft.AirlineName, draft.StationId, draft.From, draft.To,
            draft.CurrencyCode, draft.Total, draft.Status.ToString(), lines,
            Convert.ToBase64String(draft.RowVersion));
    }

    public async Task<PreinvoiceDraftResult> CreateAsync(
        CreatePreinvoiceDraftCommand request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var payloadHash = HashRequest(request);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                var attempt = await CreateInsideTransactionAsync(request, payloadHash, cancellationToken);
                if (!attempt.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return attempt;
                }
                await transaction.CommitAsync(cancellationToken);
                return attempt;
            });
        }
        catch (DbUpdateException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(request, payloadHash, cancellationToken);
        }
        catch (RetryLimitExceededException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(request, payloadHash, cancellationToken);
        }
        catch (SqlException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(request, payloadHash, cancellationToken);
        }
    }

    private async Task<PreinvoiceDraftResult> ReplayOrConflictAsync(
        CreatePreinvoiceDraftCommand request, string payloadHash,
        CancellationToken cancellationToken)
    {
        // A concurrent commit can win the unique request key before this transaction.
        var prior = await context.Preinvoices.AsNoTracking()
            .Where(item => item.RequestId == request.RequestId)
            .Select(item => new { item.PublicId, item.PayloadHash,
                item.CreatedByAccountId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null && prior.PayloadHash == payloadHash)
        {
            var ownerId = await context.Users.AsNoTracking()
                .Where(item => item.PublicId == request.AccountId)
                .Select(item => (long?)item.Id)
                .SingleOrDefaultAsync(cancellationToken);
            if (prior.CreatedByAccountId == ownerId)
                return PreinvoiceDraftResult.Success(prior.PublicId, true);
        }
        return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);
    }

    private async Task<PreinvoiceDraftResult> CreateInsideTransactionAsync(
        CreatePreinvoiceDraftCommand request, string payloadHash,
        CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.AccountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.approved_services.preinvoice") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from account in context.Users.AsNoTracking()
            from station in context.Stations.AsNoTracking()
            where account.PublicId == request.AccountId &&
                  station.PublicId == request.StationId && station.IsActive &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { AccountId = account.Id, StationId = station.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);

        var prior = await context.Preinvoices.AsNoTracking()
            .Where(item => item.RequestId == request.RequestId)
            .Select(item => new { item.PublicId, item.PayloadHash, item.CreatedByAccountId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null)
            return prior.PayloadHash == payloadHash && prior.CreatedByAccountId == scope.AccountId
                ? PreinvoiceDraftResult.Success(prior.PublicId, true)
                : PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);

        var requestedIds = request.ServiceIds.ToArray();
        var rows = await (
            from service in context.OperationServices.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on service.GroundOperationId equals operation.Id
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            join definition in context.ServiceDefinitions.AsNoTracking()
                on service.ServiceDefinitionId equals definition.Id
            join submission in context.OperationSubmissions.AsNoTracking()
                on operation.Id equals submission.GroundOperationId
            join decision in context.ReviewDecisions.AsNoTracking()
                on submission.Id equals decision.OperationSubmissionId
            where requestedIds.Contains(service.PublicId) &&
                  turnaround.StationId == scope.StationId &&
                  turnaround.OperationDate >= request.From &&
                  turnaround.OperationDate <= request.To &&
                  operation.CurrentStatus == GroundOperationStatus.Approved &&
                  submission.Status == SubmissionStatus.Approved &&
                  decision.Outcome == ReviewOutcome.Approved &&
                  !context.OperationSubmissions.AsNoTracking().Any(later =>
                      later.GroundOperationId == operation.Id &&
                      later.RevisionNumber > submission.RevisionNumber)
            orderby turnaround.OperationDate, turnaround.OperationCode, service.LineNumber, service.Id
            select new
            {
                ServiceId = service.Id, ServicePublicId = service.PublicId,
                OperationId = operation.Id, TurnaroundId = turnaround.Id, service.ContractServiceRateId,
                SubmissionId = submission.Id, submission.EvidenceJson, SubmittedAt = submission.SubmittedAt, DefinitionId = definition.Id,
                AirlineId = airline.Id, AirlinePublicId = airline.PublicId,
                turnaround.OperationDate, turnaround.OperationCode,
                definition.Code, definition.Name,
                service.CurrentStatus, service.ContractedQuantity,
                service.ExecutedQuantity, service.BillingUnitSnapshot,
                service.UnitPriceSnapshot, service.CurrencyCodeSnapshot,
            }).ToArrayAsync(cancellationToken);
        if (rows.Length != requestedIds.Length)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);
        var serviceInternalIds = rows.Select(row => row.ServiceId).ToArray();
        if (await context.PreinvoiceLines.AsNoTracking().AnyAsync(
            line => line.Kind == PreinvoiceLineKind.Service && line.OperationServiceId != null &&
                serviceInternalIds.Contains(line.OperationServiceId.Value) && line.ReleasedAt == null,
            cancellationToken))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);

        // Charges the agent still has marked must be exactly the ones the approved delivery froze.
        var liveMarks = (await context.OperationServiceCharges.AsNoTracking()
                .Where(mark => serviceInternalIds.Contains(mark.OperationServiceId) && mark.RemovedAt == null)
                .Select(mark => new { mark.OperationServiceId, mark.PublicId }).ToArrayAsync(cancellationToken))
            .ToLookup(mark => mark.OperationServiceId, mark => mark.PublicId);
        var approvedRows = rows.Select(row =>
        {
            OccReviewServiceData? evidence = null;
            IReadOnlyList<ServiceChargeEvidence> frozenCharges = [];
            ServiceTimingEvidence? frozenTiming = null;
            try
            {
                if (row.EvidenceJson is not null)
                {
                    var snapshot = OperationSubmissionEvidence.Parse(row.EvidenceJson);
                    evidence = snapshot.Services.SingleOrDefault(item => item.Id == row.ServicePublicId);
                    frozenCharges = snapshot.ChargesOf(row.ServicePublicId);
                    frozenTiming = snapshot.TimingOf(row.ServicePublicId);
                }
            }
            catch (JsonException) { }
            catch (InvalidOperationException) { }
            var matches = evidence is not null &&
                liveMarks[row.ServiceId].Order().SequenceEqual(frozenCharges.Select(charge => charge.MarkId).Order()) &&
                evidence.Status == row.CurrentStatus.ToString() &&
                evidence.ContractedQuantity == row.ContractedQuantity &&
                evidence.ExecutedQuantity == row.ExecutedQuantity &&
                evidence.Unit == row.BillingUnitSnapshot;
            var valuation = matches
                ? FinanceApprovedServicePolicy.Evaluate(row.CurrentStatus,
                    row.ExecutedQuantity, row.UnitPriceSnapshot,
                    row.CurrencyCodeSnapshot, row.BillingUnitSnapshot)
                : new FinanceServiceValuation(false, "approved_evidence_mismatch", null);
            return new
            {
                Candidate = new PreinvoiceDraftCandidate(row.ServicePublicId,
                    row.AirlinePublicId, request.StationId, row.OperationDate,
                    row.CurrencyCodeSnapshot, valuation.Ready, valuation.Amount),
                Code = evidence?.Code ?? row.Code,
                Name = evidence?.Name ?? row.Name,
                Charges = frozenCharges, Timing = frozenTiming,
            };
        }).ToArray();
        var evaluated = PreinvoiceDraftPolicy.Evaluate(
            request.StationId, request.From, request.To,
            approvedRows.Select(item => item.Candidate).ToArray());
        if (!evaluated.Ready)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable,
                evaluated.Failure);
        var packageValuation = await FinancePackageValuation.ReserveAsync(context, scope.StationId, evaluated.Currency!,
            rows.Select((row, index) => new PackageChargeableService(row.ServiceId, row.DefinitionId, row.ContractServiceRateId, row.TurnaroundId, row.SubmissionId, row.SubmittedAt, row.OperationDate, row.ExecutedQuantity, row.BillingUnitSnapshot, approvedRows[index].Timing)).ToArray(), now, cancellationToken);
        if (packageValuation.BlockingReason is not null)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, packageValuation.BlockingReason);
        var packageTotal = packageValuation.Services.Values.Sum(item => item.Price.Amount);
        var serviceTotal = evaluated.Lines.Where(item => !packageValuation.Services.ContainsKey(rows.Single(row => row.ServicePublicId == item.ServiceId).ServiceId)).Sum(item => item.Amount);
        var sourceRateKeys = rows.Where(r => r.ContractServiceRateId.HasValue).Select(r => r.ContractServiceRateId!.Value).Distinct().ToArray();
        var minimumRates = await (from rate in context.ContractServiceRates.AsNoTracking()
            join version in context.ContractVersions.AsNoTracking() on rate.ContractVersionId equals version.Id
            where sourceRateKeys.Contains(rate.Id) && version.PricingPolicyVersion > 0
            select new { rate.Id, rate.MinimumQuantity }).ToDictionaryAsync(x => x.Id, x => x.MinimumQuantity, cancellationToken);
        var minimums = rows.ToDictionary(row => row.ServiceId, row => packageValuation.Services.ContainsKey(row.ServiceId) ? 0m : FinanceMinimumPricingPolicy.TopUp(row.ExecutedQuantity, row.ContractServiceRateId is { } key ? minimumRates.GetValueOrDefault(key) : 0, row.UnitPriceSnapshot!.Value));
        if (minimums.Values.Any(x => x is null)) return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, "invalid_amount");
        var minimumTotal = minimums.Values.Sum(x => x!.Value);
        var chargeValuation = await FinanceChargeValuation.ValueAsync(context, evaluated.Currency!,
            rows.Select((row, index) => new ChargeableService(row.ServiceId, row.OperationId, row.TurnaroundId,
                row.ContractServiceRateId, row.OperationDate, row.ExecutedQuantity, evaluated.Lines[index].Amount + minimums[row.ServiceId]!.Value,
                approvedRows[index].Charges, row.SubmittedAt, approvedRows[index].Timing, packageValuation.Services.ContainsKey(row.ServiceId))).ToArray(), cancellationToken);
        if (chargeValuation.BlockingReason is not null)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, chargeValuation.BlockingReason);
        var chargesTotal = chargeValuation.Charges.Sum(charge => charge.Amount);
        if (serviceTotal + packageTotal + minimumTotal + chargesTotal > 900_000_000_000m)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, "invalid_amount");

        var draft = new Preinvoice
        {
            PublicId = Guid.CreateVersion7(), AirlineId = rows[0].AirlineId,
            StationId = scope.StationId, CreatedByAccountId = scope.AccountId,
            RequestId = request.RequestId, PayloadHash = payloadHash,
            From = request.From, To = request.To, CurrencyCode = evaluated.Currency!,
            Total = serviceTotal + packageTotal + minimumTotal + chargesTotal, Status = PreinvoiceStatus.Draft,
            CreatedAt = now, UpdatedAt = now,
        };
        context.Preinvoices.Add(draft);
        await context.SaveChangesAsync(cancellationToken);

        var lineNumber = 0;
        for (var index = 0; index < rows.Length; index++)
        {
            var row = rows[index];
            var package = packageValuation.Services.GetValueOrDefault(row.ServiceId);
            var serviceAmount = package is null ? evaluated.Lines[index].Amount : 0m;
            var serviceLine = new PreinvoiceLine
            {
                PublicId = Guid.CreateVersion7(), PreinvoiceId = draft.Id,
                OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId,
                OperationCode = row.OperationCode,
                OperationDate = row.OperationDate,
                ServiceCode = approvedRows[index].Code,
                ServiceName = approvedRows[index].Name,
                ExecutedQuantity = row.ExecutedQuantity,
                BillingUnit = row.BillingUnitSnapshot,
                UnitPrice = package is null ? row.UnitPriceSnapshot!.Value : 0m,
                CurrencyCode = row.CurrencyCodeSnapshot!,
                Amount = serviceAmount,
                ComputedQuantity = row.ExecutedQuantity, ComputedAmount = serviceAmount,
                AdjustmentReason = package is null ? null : "Cubierto por paquete " + package.Code,
                CalculationJson = package?.CalculationJson ?? JsonSerializer.Serialize(new { row.ServicePublicId, row.ContractServiceRateId, row.ExecutedQuantity, row.BillingUnitSnapshot, row.UnitPriceSnapshot, row.CurrencyCodeSnapshot, amount = serviceAmount }),
                CreatedAt = now, UpdatedAt = now,
            };
            serviceLine.LineNumber = ++lineNumber;
            context.PreinvoiceLines.Add(serviceLine);
            await context.SaveChangesAsync(cancellationToken);
            if (minimums[row.ServiceId] is > 0)
            {
                var quantity = minimumRates[row.ContractServiceRateId!.Value] - row.ExecutedQuantity;
                context.PreinvoiceLines.Add(new PreinvoiceLine
                {
                    PublicId = Guid.CreateVersion7(), PreinvoiceId = draft.Id, Kind = PreinvoiceLineKind.Minimum, OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId, ParentLineId = serviceLine.Id,
                    LineNumber = ++lineNumber, OperationCode = row.OperationCode, OperationDate = row.OperationDate, ServiceCode = row.Code, ServiceName = "Mínimo contractual · " + row.Name,
                    ExecutedQuantity = quantity, BillingUnit = row.BillingUnitSnapshot, UnitPrice = row.UnitPriceSnapshot!.Value, CurrencyCode = row.CurrencyCodeSnapshot!, Amount = minimums[row.ServiceId]!.Value,
                    ComputedQuantity = quantity, ComputedAmount = minimums[row.ServiceId]!.Value, AdjustmentReason = "Complemento hasta el mínimo contractual aprobado", CreatedAt = now, UpdatedAt = now,
                });
            }
            if (package is not null)
            {
                context.Set<PackageConsumptionEntry>().Add(new()
                {
                    PublicId = Guid.CreateVersion7(), ConsumptionId = package.ConsumptionId, ComponentId = package.ComponentId,
                    OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId, PreinvoiceLineId = serviceLine.Id,
                    Quantity = package.Quantity, IncludedQuantity = package.Price.IncludedQuantity, ExcessQuantity = package.Price.ExcessQuantity,
                    BaseAmount = package.Price.BaseAmount, ExcessAmount = package.Price.ExcessAmount, CalculationJson = package.CalculationJson, CreatedAt = now, UpdatedAt = now,
                });
                foreach (var part in new[] { (Kind: PreinvoiceLineKind.Package, Amount: package.Price.BaseAmount, Quantity: 1m, Unit: "package", Label: "Paquete " + package.Name), (Kind: PreinvoiceLineKind.Excess, Amount: package.Price.ExcessAmount, Quantity: package.ExcessBlockPrice > 0 ? package.Price.ExcessAmount / package.ExcessBlockPrice : 0m, Unit: "block", Label: "Excedente " + package.Name) }.Where(part => part.Amount > 0))
                    context.PreinvoiceLines.Add(new PreinvoiceLine
                    {
                        PublicId = Guid.CreateVersion7(), PreinvoiceId = draft.Id, Kind = part.Kind, OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId, ParentLineId = serviceLine.Id,
                        LineNumber = ++lineNumber, OperationCode = row.OperationCode, OperationDate = row.OperationDate, ServiceCode = package.Code, ServiceName = part.Label, ExecutedQuantity = part.Quantity,
                        BillingUnit = part.Unit, UnitPrice = part.Amount / Math.Max(1m, part.Quantity), CurrencyCode = row.CurrencyCodeSnapshot!, Amount = part.Amount, ComputedQuantity = part.Quantity, ComputedAmount = part.Amount,
                        CalculationJson = package.CalculationJson, AdjustmentReason = "Cálculo contractual por ámbito", CreatedAt = now, UpdatedAt = now,
                    });
            }
            foreach (var charge in chargeValuation.Charges.Where(charge => charge.ServiceId == row.ServiceId))
                context.PreinvoiceLines.Add(new PreinvoiceLine
                {
                    PublicId = Guid.CreateVersion7(), PreinvoiceId = draft.Id, Kind = PreinvoiceLineKind.Charge,
                    OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId,
                    ParentLineId = serviceLine.Id, ChargeDefinitionId = charge.ChargeDefinitionId,
                    LineNumber = ++lineNumber, OperationCode = row.OperationCode, OperationDate = row.OperationDate,
                    ServiceCode = charge.Code, ServiceName = charge.Name, ExecutedQuantity = charge.Quantity,
                    BillingUnit = charge.BillingUnit ?? row.BillingUnitSnapshot, UnitPrice = charge.UnitPrice,
                    CurrencyCode = row.CurrencyCodeSnapshot!, Amount = charge.Amount, ComputedQuantity = charge.Quantity,
                    ComputedAmount = charge.Amount, IsExcluded = charge.IsExcluded, ComputedIsExcluded = charge.IsExcluded,
                    CreatedAt = now, UpdatedAt = now,
                });
        }
        var pricedLines = await context.PreinvoiceLines.Where(line => line.PreinvoiceId == draft.Id).ToListAsync(cancellationToken);
        pricedLines.AddRange(context.ChangeTracker.Entries<PreinvoiceLine>().Where(entry => entry.State == EntityState.Added && entry.Entity.PreinvoiceId == draft.Id).Select(entry => entry.Entity).Where(line => !pricedLines.Contains(line)));
        try { await FinanceTaxSnapshotWriter.ApplyOnceAsync(context, draft, pricedLines, now, cancellationToken); }
        catch (FinanceTaxRuleException failure) { return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, failure.Code); }
        if (draft.Total is < 0 or > 900_000_000_000m) return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, "invalid_amount");
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = scope.AccountId,
            ActorDisplay = actor.DisplayName, Action = "finance.preinvoice.draft.created",
            EntityType = nameof(Preinvoice), EntityPublicId = draft.PublicId,
            StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = request.RequestId, RequestId = request.RequestId.ToString("D"),
            Reason = "Finance grouped approved service snapshots in a non-fiscal draft.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, draft.PublicId, now, "finance_preinvoices", cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return PreinvoiceDraftResult.Success(draft.PublicId, false);
    }

    private static string HashRequest(CreatePreinvoiceDraftCommand request)
    {
        var source = $"{request.AccountId:D}|{request.StationId:D}|{request.From:yyyy-MM-dd}|" +
            $"{request.To:yyyy-MM-dd}|{string.Join(',', request.ServiceIds.Order())}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source)));
    }

    private static bool IsConflict(Exception exception) =>
        exception is SqlException sql && sql.Number is 2601 or 2627 or 1205 or 1222 or 3960;
}
