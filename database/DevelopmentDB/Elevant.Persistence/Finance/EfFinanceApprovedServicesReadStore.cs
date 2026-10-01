using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Reads bounded, approved evidence under the account's live station grant.</summary>
internal sealed class EfFinanceApprovedServicesReadStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IFinanceApprovedServicesReadStore
{
    private const int PageLimit = 200;

    public async Task<FinanceApprovedServicesData?> GetAsync(
        Guid accountId, Guid stationId, DateOnly startDate, DateOnly endDate,
        CancellationToken cancellationToken = default)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from station in context.Stations.AsNoTracking()
            join account in context.Users.AsNoTracking() on accountId equals account.PublicId
            where station.PublicId == stationId && station.IsActive &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { StationId = station.Id, AccountId = account.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return null;

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
            where turnaround.StationId == scope.StationId &&
                  turnaround.OperationDate >= startDate &&
                  turnaround.OperationDate <= endDate &&
                  operation.CurrentStatus == GroundOperationStatus.Approved &&
                  submission.Status == SubmissionStatus.Approved &&
                  decision.Outcome == ReviewOutcome.Approved &&
                  !context.OperationSubmissions.AsNoTracking().Any(later =>
                      later.GroundOperationId == operation.Id &&
                      later.RevisionNumber > submission.RevisionNumber) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == scope.AccountId &&
                      grant.StationId == turnaround.StationId &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            orderby turnaround.OperationDate descending, turnaround.OperationCode,
                service.LineNumber, service.Id
            select new
            {
                ServiceId = service.PublicId,
                OperationId = operation.PublicId,
                TurnaroundId = turnaround.PublicId,
                SubmissionId = submission.PublicId,
                submission.EvidenceJson,
                turnaround.OperationCode,
                turnaround.OperationDate,
                AirlineId = airline.PublicId,
                AirlineName = airline.Name,
                PreinvoiceId = (
                    from line in context.PreinvoiceLines.AsNoTracking()
                    join draft in context.Preinvoices.AsNoTracking()
                        on line.PreinvoiceId equals draft.Id
                    where line.OperationServiceId == service.Id && line.ReleasedAt == null
                    select (Guid?)draft.PublicId).FirstOrDefault(),
                FlightNumber = context.FlightLegs.AsNoTracking()
                    .Where(leg => leg.TurnaroundId == turnaround.Id &&
                        leg.Direction == FlightDirection.Arrival)
                    .Select(leg => leg.FlightNumber).FirstOrDefault(),
                ContractCode = (
                    from rate in context.ContractServiceRates.AsNoTracking()
                    join version in context.ContractVersions.AsNoTracking()
                        on rate.ContractVersionId equals version.Id
                    join contract in context.Contracts.AsNoTracking()
                        on version.ContractId equals contract.Id
                    where rate.Id == service.ContractServiceRateId
                    select contract.ContractCode).FirstOrDefault(),
                definition.Code,
                definition.Name,
                service.CurrentStatus,
                service.ContractedQuantity,
                service.ExecutedQuantity,
                service.BillingUnitSnapshot,
                service.UnitPriceSnapshot,
                service.CurrencyCodeSnapshot,
            })
            .Take(PageLimit + 1)
            .ToArrayAsync(cancellationToken);

        var services = rows.Take(PageLimit).Select(row =>
        {
            OccReviewServiceData? evidence = null;
            if (row.EvidenceJson is not null)
            {
                try
                {
                    evidence = OperationSubmissionEvidence.Parse(row.EvidenceJson)
                        .Services.SingleOrDefault(item => item.Id == row.ServiceId);
                }
                catch (System.Text.Json.JsonException) { }
                catch (InvalidOperationException) { }
            }
            var evidenceMatches = evidence is not null &&
                evidence.Status == row.CurrentStatus.ToString() &&
                evidence.ExecutedQuantity == row.ExecutedQuantity &&
                evidence.ContractedQuantity == row.ContractedQuantity &&
                evidence.Unit == row.BillingUnitSnapshot;
            var valuation = evidenceMatches
                ? FinanceApprovedServicePolicy.Evaluate(
                    row.CurrentStatus, row.ExecutedQuantity, row.UnitPriceSnapshot,
                    row.CurrencyCodeSnapshot, row.BillingUnitSnapshot)
                : new FinanceServiceValuation(false, "approved_evidence_mismatch", null);
            return new FinanceApprovedServiceData(
                row.ServiceId, row.OperationId, row.TurnaroundId, row.SubmissionId,
                row.OperationCode, row.OperationDate, row.AirlineId, row.AirlineName,
                row.FlightNumber ?? string.Empty, row.ContractCode,
                evidence?.Code ?? row.Code, evidence?.Name ?? row.Name,
                row.CurrentStatus.ToString(), row.ContractedQuantity,
                row.ExecutedQuantity, row.BillingUnitSnapshot,
                row.UnitPriceSnapshot, row.CurrencyCodeSnapshot,
                valuation.Ready, valuation.BlockingReason, valuation.Amount,
                row.PreinvoiceId);
        }).ToArray();
        return new FinanceApprovedServicesData(stationId, startDate, endDate,
            services, rows.Length > PageLimit);
    }
}
