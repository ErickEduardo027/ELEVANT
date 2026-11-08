using Elevant.Application.Finance;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// «Por facturar» (4-N06, 4-N16, 4-N18): one row per pending operation under the account's live station grant, from
/// the oldest to the newest. What an invoice or a no-charge closure already holds never comes back, so recent
/// invoiced services cannot hide older pending operations, and an operation is never split between pages. Each row
/// names every reason the issuance would refuse it with, the valuation of its charges included; an older internal
/// draft without invoice that still holds a service shows the operation as <c>pending_preinvoice</c>.
/// </summary>
internal sealed class EfFinancePendingOperationsReadStore(ElevantDbContext context, TimeProvider timeProvider)
    : IFinancePendingOperationsReadStore
{
    private sealed record Row(long Id, Guid PublicId, byte[] RowVersion, long TurnaroundId, DateOnly OperationDate,
        string OperationCode, Guid AirlineId, string AirlineName, bool AirlineActive)
    {
        public FinancePendingKey Key => new(OperationDate, OperationCode, PublicId);
    }

    /// <summary>
    /// The pending predicate: approved operations of the station whose latest hand-off OCC approved, with a billable
    /// service (<see cref="ServiceBillability"/>), none of whose billable services an invoice or a no-charge closure
    /// holds (an unreleased service line of an Invoiced or NoCharge draft).
    /// </summary>
    internal IQueryable<GroundOperation> PendingOperations(long stationId)
    {
        var billable = context.OperationServices.AsNoTracking().Where(ServiceBillability.Billable);
        return from operation in context.GroundOperations.AsNoTracking()
               join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
               where turnaround.StationId == stationId && operation.CurrentStatus == GroundOperationStatus.Approved &&
                     context.OperationSubmissions.Any(submission => submission.GroundOperationId == operation.Id &&
                         submission.Status == SubmissionStatus.Approved &&
                         context.ReviewDecisions.Any(decision => decision.OperationSubmissionId == submission.Id &&
                             decision.Outcome == ReviewOutcome.Approved) &&
                         !context.OperationSubmissions.Any(later => later.GroundOperationId == operation.Id &&
                             later.RevisionNumber > submission.RevisionNumber)) &&
                     billable.Any(service => service.GroundOperationId == operation.Id) &&
                     !billable.Any(service => service.GroundOperationId == operation.Id &&
                         context.PreinvoiceLines.Any(line => line.OperationServiceId == service.Id &&
                             line.Kind == PreinvoiceLineKind.Service && line.ReleasedAt == null &&
                             context.Preinvoices.Any(draft => draft.Id == line.PreinvoiceId &&
                                 (draft.Status == PreinvoiceStatus.Invoiced || draft.Status == PreinvoiceStatus.NoCharge))))
               select operation;
    }

    public async Task<int?> CountAsync(Guid accountId, Guid stationId, CancellationToken cancellationToken = default)
    {
        var scope = await ScopeAsync(accountId, stationId, cancellationToken);
        return scope is null ? null : await PendingOperations(scope.Value).CountAsync(cancellationToken);
    }

    public async Task<FinancePendingOperationsData?> GetAsync(GetFinancePendingOperationsQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var station = await ScopeAsync(query.AccountId, query.StationId, cancellationToken);
        if (station is null) return null;
        var pending = from operation in PendingOperations(station.Value)
                      join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                      join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                      join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                      select new { operation, turnaround, airline, organization };
        if (query.From is { } from) pending = pending.Where(item => item.turnaround.OperationDate >= from);
        if (query.To is { } to) pending = pending.Where(item => item.turnaround.OperationDate <= to);
        var rows = await pending.Select(item => new Row(item.operation.Id, item.operation.PublicId, item.operation.RowVersion,
                item.turnaround.Id, item.turnaround.OperationDate, item.turnaround.OperationCode, item.airline.PublicId,
                item.airline.Name, item.airline.IsActive && item.organization.Type == OrganizationType.AirlineCustomer &&
                    item.organization.Status == OrganizationStatus.Active))
            .ToArrayAsync(cancellationToken);

        // The airline facet counts the period whatever airline is chosen, so Finance can switch between them.
        var airlines = rows.GroupBy(row => row.AirlineId)
            .Select(group => new FinancePendingAirlineData(group.Key, group.First().AirlineName, group.Count()))
            .OrderBy(item => item.AirlineName, StringComparer.Ordinal).ThenBy(item => item.AirlineId).ToArray();
        var filtered = rows.Where(row => query.AirlineId is null || row.AirlineId == query.AirlineId)
            .OrderBy(row => row.Key).ToArray();
        IEnumerable<Row> remaining = filtered;
        if (query.Cursor is not null)
        {
            if (!FinancePendingKey.TryDecode(query.Cursor, out var after)) return null;
            remaining = filtered.Where(row => row.Key.CompareTo(after) > 0);
        }
        var window = remaining.Take(query.Limit + 1).ToArray();
        var page = window.Take(query.Limit).ToArray();
        var operations = await DescribeAsync(page, cancellationToken);
        return new FinancePendingOperationsData(query.StationId, airlines, operations,
            window.Length > query.Limit ? page[^1].Key.Encode() : null, filtered.Length);
    }

    /// <summary>The station's internal id when the account is AVIAM staff with a live grant on it.</summary>
    private async Task<long?> ScopeAsync(Guid accountId, Guid stationId, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(accountId, cancellationToken);
        if (actor is null || !actor.HasPermission(GetFinancePendingOperationsHandler.ReadPermission) ||
            !actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;
        var now = timeProvider.GetUtcNow();
        return await (from station in context.Stations.AsNoTracking()
                      join account in context.Users.AsNoTracking() on accountId equals account.PublicId
                      where station.PublicId == stationId && station.IsActive &&
                            context.AccountStationScopes.AsNoTracking().Any(grant => grant.AccountId == account.Id &&
                                grant.StationId == station.Id && grant.GrantedAt <= now && grant.RevokedAt == null)
                      select (long?)station.Id).SingleOrDefaultAsync(cancellationToken);
    }

    /// <summary>Services, valuation, charges and blocking reasons of one page of operations.</summary>
    private async Task<IReadOnlyList<FinancePendingOperationData>> DescribeAsync(Row[] page,
        CancellationToken cancellationToken)
    {
        if (page.Length == 0) return [];
        var operationIds = page.Select(row => row.Id).ToArray();
        var turnaroundIds = page.Select(row => row.TurnaroundId).Distinct().ToArray();
        var services = await (from service in context.OperationServices.AsNoTracking().Where(ServiceBillability.Billable)
                              join definition in context.ServiceDefinitions.AsNoTracking()
                                  on service.ServiceDefinitionId equals definition.Id
                              where operationIds.Contains(service.GroundOperationId)
                              orderby service.GroundOperationId, service.LineNumber, service.Id
                              select new
                              {
                                  service.Id, service.PublicId, service.GroundOperationId, service.ContractServiceRateId,
                                  definition.Code, definition.Name, service.CurrentStatus, service.ContractedQuantity,
                                  service.ExecutedQuantity, service.BillingUnitSnapshot, service.UnitPriceSnapshot,
                                  service.CurrencyCodeSnapshot, service.BillingExcludedAt,
                              }).ToArrayAsync(cancellationToken);
        // ADR-0034: what OCC approved, charges adjusted included; older approvals kept only the hand-off.
        var approvals = (await (from submission in context.OperationSubmissions.AsNoTracking()
                                join decision in context.ReviewDecisions.AsNoTracking()
                                    on submission.Id equals decision.OperationSubmissionId
                                where operationIds.Contains(submission.GroundOperationId) &&
                                      submission.Status == SubmissionStatus.Approved &&
                                      decision.Outcome == ReviewOutcome.Approved &&
                                      !context.OperationSubmissions.Any(later =>
                                          later.GroundOperationId == submission.GroundOperationId &&
                                          later.RevisionNumber > submission.RevisionNumber)
                                select new
                                {
                                    submission.GroundOperationId, submission.SubmittedAt,
                                    EvidenceJson = decision.ApprovedEvidenceJson ?? submission.EvidenceJson,
                                }).ToArrayAsync(cancellationToken))
            .GroupBy(item => item.GroundOperationId).ToDictionary(group => group.Key, group => group.First());
        var flights = (await context.FlightLegs.AsNoTracking()
                .Where(leg => turnaroundIds.Contains(leg.TurnaroundId) && leg.Direction == FlightDirection.Arrival)
                .Select(leg => new { leg.TurnaroundId, leg.FlightNumber }).ToArrayAsync(cancellationToken))
            .GroupBy(leg => leg.TurnaroundId).ToDictionary(group => group.Key, group => group.First().FlightNumber);
        var rateIds = services.Where(service => service.ContractServiceRateId != null)
            .Select(service => service.ContractServiceRateId!.Value).Distinct().ToArray();
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
                           join version in context.ContractVersions.AsNoTracking() on rate.ContractVersionId equals version.Id
                           join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                           where rateIds.Contains(rate.Id)
                           select new { rate.Id, contract.ContractCode, version.PricingPolicyVersion, rate.MinimumQuantity })
            .ToDictionaryAsync(rate => rate.Id, cancellationToken);
        var serviceIds = services.Select(service => service.Id).ToArray();
        var heldByDraft = (await (from line in context.PreinvoiceLines.AsNoTracking()
                                  join draft in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals draft.Id
                                  where line.Kind == PreinvoiceLineKind.Service && line.OperationServiceId != null &&
                                        serviceIds.Contains(line.OperationServiceId.Value) && line.ReleasedAt == null &&
                                        draft.Status != PreinvoiceStatus.Invoiced && draft.Status != PreinvoiceStatus.NoCharge
                                  select line.OperationServiceId!.Value).Distinct().ToArrayAsync(cancellationToken))
            .ToHashSet();

        var valued = await ApprovedServiceValuation.ValueAsync(context, services.Select(service =>
            new ApprovedServiceValuation.Source(service.Id, service.PublicId,
                approvals.GetValueOrDefault(service.GroundOperationId)?.EvidenceJson, service.CurrentStatus,
                service.ContractedQuantity, service.ExecutedQuantity, service.BillingUnitSnapshot,
                service.UnitPriceSnapshot, service.CurrencyCodeSnapshot, service.BillingExcludedAt is not null)).ToArray(),
            cancellationToken);
        var lines = services.Select((service, index) =>
        {
            var item = valued[index];
            // A contractual minimum adds a line and its top-up (pricing policy 1 or later), as the draft does.
            decimal minimum = 0m;
            if (item.Valuation.Ready && service.ContractServiceRateId is { } rateId && rates.TryGetValue(rateId, out var rate) &&
                rate.PricingPolicyVersion > 0)
                minimum = FinanceMinimumPricingPolicy.TopUp(service.ExecutedQuantity, rate.MinimumQuantity,
                    service.UnitPriceSnapshot ?? 0m) ?? 0m;
            return new
            {
                Service = service, Valued = item, Minimum = minimum,
                ContractCode = service.ContractServiceRateId is { } id && rates.TryGetValue(id, out var source)
                    ? source.ContractCode : null,
            };
        }).ToLookup(line => line.Service.GroundOperationId);

        // 4-N18: what the charges of a ready operation are worth, in its currency; only when they block is each
        // operation valued alone to name which ones.
        var charges = new Dictionary<long, IReadOnlyList<ValuedCharge>>();
        var chargeBlocks = new Dictionary<long, string>();
        var ready = page.Where(row => lines[row.Id].All(line => line.Valued.Valuation.Ready) &&
                lines[row.Id].Select(line => line.Service.CurrencyCodeSnapshot).Distinct().Count() == 1 &&
                approvals.ContainsKey(row.Id))
            .ToArray();
        foreach (var group in ready.GroupBy(row => lines[row.Id].First().Service.CurrencyCodeSnapshot!))
        {
            ChargeableService[] Chargeable(Row row) => lines[row.Id].Select(line => new ChargeableService(line.Service.Id,
                row.Id, row.TurnaroundId, line.Service.ContractServiceRateId, row.OperationDate, line.Service.ExecutedQuantity,
                (line.Valued.Valuation.Amount ?? 0m) + line.Minimum, line.Valued.Charges,
                approvals[row.Id].SubmittedAt, line.Valued.Timing)).ToArray();
            var together = await FinanceChargeValuation.ValueAsync(context, group.Key,
                group.SelectMany(Chargeable).ToArray(), cancellationToken);
            if (together.BlockingReason is null)
            {
                foreach (var row in group)
                {
                    var own = lines[row.Id].Select(line => line.Service.Id).ToHashSet();
                    charges[row.Id] = together.Charges.Where(charge => own.Contains(charge.ServiceId)).ToArray();
                }
                continue;
            }
            foreach (var row in group)
            {
                var alone = await FinanceChargeValuation.ValueAsync(context, group.Key, Chargeable(row), cancellationToken);
                if (alone.BlockingReason is { } reason) chargeBlocks[row.Id] = reason;
                else charges[row.Id] = alone.Charges;
            }
        }

        return page.Select(row =>
        {
            var own = lines[row.Id].ToArray();
            var reasons = new List<string>();
            if (!row.AirlineActive) reasons.Add(InvoicingCodes.AirlineInactive);
            if (own.Any(line => heldByDraft.Contains(line.Service.Id))) reasons.Add(InvoicingCodes.PendingPreinvoice);
            reasons.AddRange(own.Where(line => line.Valued.Valuation.BlockingReason is not null)
                .Select(line => line.Valued.Valuation.BlockingReason!));
            var currencies = own.Where(line => line.Valued.Valuation.Ready)
                .Select(line => line.Service.CurrencyCodeSnapshot).Distinct().ToArray();
            if (currencies.Length > 1) reasons.Add("mixed_currency");
            if (!approvals.ContainsKey(row.Id)) reasons.Add("approved_evidence_mismatch");
            if (chargeBlocks.TryGetValue(row.Id, out var chargeReason)) reasons.Add(chargeReason);
            var valuedCharges = charges.GetValueOrDefault(row.Id);
            var chargeLines = valuedCharges?.Count(charge => !charge.IsExcluded) ?? own.Sum(line => line.Valued.Charges.Count);
            var net = own.Where(line => line.Valued.Valuation.Ready)
                .Sum(line => (line.Valued.Valuation.Amount ?? 0m) + line.Minimum) +
                (valuedCharges?.Sum(charge => charge.Amount) ?? 0m);
            var distinct = reasons.Distinct(StringComparer.Ordinal).ToArray();
            return new FinancePendingOperationData(row.PublicId, MasterDataCommand.Version(row.RowVersion),
                row.OperationCode, row.OperationDate, row.AirlineId, row.AirlineName,
                flights.GetValueOrDefault(row.TurnaroundId) ?? string.Empty,
                own.Select(line => line.ContractCode).FirstOrDefault(code => code is not null),
                currencies.FirstOrDefault() ?? own.Select(line => line.Service.CurrencyCodeSnapshot).FirstOrDefault(),
                own.Length, own.Length + own.Count(line => line.Minimum > 0) + chargeLines,
                decimal.Round(net, 2, MidpointRounding.AwayFromZero), distinct.Length == 0, distinct,
                own.Select(line => new FinancePendingServiceData(line.Service.PublicId,
                    line.Valued.Evidence?.Code ?? line.Service.Code, line.Valued.Evidence?.Name ?? line.Service.Name,
                    line.Valued.Valuation.Ready, line.Valued.Valuation.BlockingReason,
                    line.Valued.Valuation.Amount is { } amount ? decimal.Round(amount, 2, MidpointRounding.AwayFromZero) : null,
                    line.Valued.Charges.Count)).ToArray());
        }).ToArray();
    }
}
