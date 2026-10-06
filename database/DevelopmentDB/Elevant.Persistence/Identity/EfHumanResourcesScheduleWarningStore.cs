using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesScheduleWarningStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesScheduleWarningStore
{
    private static readonly ScheduleWarningRule Rule = new(
        "dev-2026-10-05", new DateOnly(2026, 10, 5),
        TimeSpan.FromHours(12), TimeSpan.FromHours(48));

    public async Task<ScheduleWarningReadResult> ListAsync(Guid actorId,
        Guid stationId, DateOnly from, DateOnly to, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty ||
            from == default || to < from || to.DayNumber - from.DayNumber >= 30 ||
            page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(from));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code == "GESTION_HUMANA") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return new ScheduleWarningReadResult(null,
                ScheduleWarningFailure.ForbiddenRole);
        var visibleStationIds = actor.StationScopes.Select(item => item.StationId)
            .ToHashSet();
        if (!visibleStationIds.Contains(stationId))
            return new ScheduleWarningReadResult(null,
                ScheduleWarningFailure.ForbiddenStation);

        var station = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.IanaTimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null)
            return new ScheduleWarningReadResult(null,
                ScheduleWarningFailure.ForbiddenStation);
        var requestedZone = TimeZoneInfo.FindSystemTimeZoneById(station.IanaTimeZone);

        var candidateIds = await context.ShiftAssignments.AsNoTracking()
            .Where(item => item.StationId == station.Id &&
                item.WorkDate >= from && item.WorkDate <= to)
            .Select(item => item.RampAgentId).Distinct()
            .ToArrayAsync(cancellationToken);
        if (candidateIds.Length == 0)
            return new ScheduleWarningReadResult(new ScheduleWarningPage(
                stationId, from, to, page, limit, false, clock.GetUtcNow(),
                Rule.Version, Rule.EffectiveOn, []), null);

        // The boundary day covers cross-zone starts near a local midnight.
        // The query is restricted to agents who have a target-station shift.
        var contextFrom = from.DayNumber > 7 ? from.AddDays(-7) : DateOnly.MinValue;
        var contextTo = to.DayNumber < DateOnly.MaxValue.DayNumber
            ? to.AddDays(1) : DateOnly.MaxValue;
        var rows = await (
            from shift in context.ShiftAssignments.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on shift.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join shiftStation in context.Stations.AsNoTracking()
                on shift.StationId equals shiftStation.Id
            where candidateIds.Contains(shift.RampAgentId) &&
                shift.WorkDate >= contextFrom && shift.WorkDate <= contextTo
            select new
            {
                ShiftId = shift.PublicId,
                AgentId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                StationId = shiftStation.PublicId,
                StationCode = shiftStation.Code,
                shiftStation.IanaTimeZone,
                shift.WorkDate,
                shift.StartsAtLocal,
                shift.EndsAtLocal,
            }).ToArrayAsync(cancellationToken);

        var shifts = rows.Select(row => new ScheduleShift(row.ShiftId,
            row.AgentId, $"{row.FirstName} {row.LastName}", row.EmployeeNumber,
            row.StationId, row.StationCode, row.IanaTimeZone,
            row.WorkDate, row.StartsAtLocal, row.EndsAtLocal,
            visibleStationIds.Contains(row.StationId))).ToArray();
        var warnings = ScheduleWarningEvaluator.Evaluate(shifts, stationId,
            requestedZone, from, to, Rule);
        var offset = (page - 1) * limit;
        var pageRows = warnings.Skip(offset).Take(limit + 1).ToArray();
        return new ScheduleWarningReadResult(new ScheduleWarningPage(
            stationId, from, to, page, limit, pageRows.Length > limit,
            clock.GetUtcNow(), Rule.Version, Rule.EffectiveOn,
            pageRows.Take(limit).ToArray()), null);
    }
}
