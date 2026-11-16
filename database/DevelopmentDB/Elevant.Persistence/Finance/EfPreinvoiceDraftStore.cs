using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// The internal draft of an invoice (ADR-0035, block 3): it reserves the approved source lines and freezes their
/// valuation inside the issuance transaction of «Por facturar». It has no endpoint and no permission of its own.
/// </summary>
internal sealed class EfPreinvoiceDraftStore(
    ElevantDbContext context, TimeProvider timeProvider)
{
    /// <summary>
    /// ADR-0035: the internal valuation step of issuing an invoice. Runs inside the caller's
    /// transaction; the caller has already checked «Emitir facturas».
    /// </summary>
    internal Task<PreinvoiceDraftResult> DraftForInvoiceAsync(CreatePreinvoiceDraftCommand request,
        CancellationToken cancellationToken) =>
        CreateInsideTransactionAsync(request, HashRequest(request), cancellationToken,
            maxServices: FinanceInvoicePolicy.MaxLines);

    private async Task<PreinvoiceDraftResult> CreateInsideTransactionAsync(
        CreatePreinvoiceDraftCommand request, string payloadHash,
        CancellationToken cancellationToken, int maxServices = PreinvoiceDraftPolicy.DefaultMaxServices)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.AccountId, cancellationToken);
        if (actor is null ||
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
                SubmissionId = submission.Id, EvidenceJson = decision.ApprovedEvidenceJson ?? submission.EvidenceJson, SubmittedAt = submission.SubmittedAt, DefinitionId = definition.Id,
                AirlineId = airline.Id, AirlinePublicId = airline.PublicId,
                turnaround.OperationDate, turnaround.OperationCode,
                definition.Code, definition.Name,
                service.CurrentStatus, service.ContractedQuantity,
                service.ExecutedQuantity, service.BillingUnitSnapshot,
                service.UnitPriceSnapshot, service.CurrencyCodeSnapshot,
                service.BillingExcludedAt,
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
        var frozen = rows.Select(row =>
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
            return (Row: row, Evidence: evidence, Charges: frozenCharges, Timing: frozenTiming);
        }).ToArray();
        // 3-N29: a frozen charge the service's contract excludes blocks it; it is never valued at zero in silence.
        var carryingExcluded = await ContractChargeExclusions.ServicesCarryingExcludedAsync(context,
            frozen.SelectMany(item => item.Charges.Select(charge => (item.Row.ServiceId, charge.ChargeId))).ToArray(),
            cancellationToken);
        var approvedRows = frozen.Select(item =>
        {
            var (row, evidence, frozenCharges, frozenTiming) = item;
            var matches = evidence is not null &&
                liveMarks[row.ServiceId].Order().SequenceEqual(frozenCharges.Select(charge => charge.MarkId).Order()) &&
                evidence.Status == row.CurrentStatus.ToString() &&
                evidence.ContractedQuantity == row.ContractedQuantity &&
                evidence.ExecutedQuantity == row.ExecutedQuantity &&
                evidence.Unit == row.BillingUnitSnapshot;
            var valuation = matches
                ? FinanceApprovedServicePolicy.Evaluate(row.CurrentStatus,
                    row.ExecutedQuantity, row.UnitPriceSnapshot,
                    row.CurrencyCodeSnapshot, row.BillingUnitSnapshot, row.BillingExcludedAt is not null,
                    carryingExcluded.Contains(row.ServiceId))
                : new FinanceServiceValuation(false, "approved_evidence_mismatch", null);
            return new
            {
                Candidate = new PreinvoiceDraftCandidate(row.ServicePublicId,
                    row.AirlinePublicId, request.StationId, row.OperationDate,
                    row.CurrencyCodeSnapshot, valuation.Ready, valuation.Amount),
                Code = evidence?.Code ?? row.Code,
                Name = evidence?.Name ?? row.Name,
                Charges = frozenCharges, Timing = frozenTiming, valuation.BlockingReason,
            };
        }).ToArray();
        // OCC's exclusion (3-N11) and a charge the contract excludes (3-N29) name themselves instead of a generic
        // unbillable line: the way out is in OCC's review.
        if (approvedRows.FirstOrDefault(item => item.BlockingReason is "excluded_in_review" or
                "charge_excluded_by_contract") is { } blocked)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable, blocked.BlockingReason);
        var evaluated = PreinvoiceDraftPolicy.Evaluate(
            request.StationId, request.From, request.To,
            approvedRows.Select(item => item.Candidate).ToArray(), maxServices);
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
        await context.SaveChangesAsync(cancellationToken);
        return PreinvoiceDraftResult.Success(draft.PublicId, false);
    }

    private static string HashRequest(CreatePreinvoiceDraftCommand request)
    {
        var source = $"{request.AccountId:D}|{request.StationId:D}|{request.From:yyyy-MM-dd}|" +
            $"{request.To:yyyy-MM-dd}|{string.Join(',', request.ServiceIds.Order())}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source)));
    }
}
