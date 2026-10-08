using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesShiftReadStore(
    ElevantDbContext context, IActorContextResolver actors)
    : IHumanResourcesShiftReadStore
{
    public async Task<HumanResourcesShiftAssignmentOptions?> GetAssignmentOptionsAsync(
        Guid actorId, Guid rampProfileId, DateOnly workDate,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || rampProfileId == Guid.Empty || workDate == default)
            throw new ArgumentOutOfRangeException(nameof(rampProfileId));
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission("human_resources.schedules.read") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;

        var agentId = await context.RampAgents.AsNoTracking()
            .Where(agent => agent.PublicId == rampProfileId && agent.IsActive)
            .Select(agent => (long?)agent.Id).SingleOrDefaultAsync(cancellationToken);
        if (agentId is null)
            return new HumanResourcesShiftAssignmentOptions(rampProfileId, workDate,
                false, []);

        var stations = await (
            from scope in context.Set<RampAgentStationScope>().AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on scope.StationId equals station.Id
            where scope.RampAgentId == agentId && station.IsActive &&
                scope.ValidFrom <= workDate &&
                (scope.ValidTo == null || scope.ValidTo >= workDate)
            orderby station.Code
            select new { station.Id, station.PublicId, station.Code })
            .Distinct().ToArrayAsync(cancellationToken);
        var terminals = await (
            from scope in context.Set<RampAgentTerminalScope>().AsNoTracking()
            join terminal in context.Terminals.AsNoTracking()
                on scope.TerminalId equals terminal.Id
            where scope.RampAgentId == agentId && terminal.IsActive &&
                scope.ValidFrom <= workDate &&
                (scope.ValidTo == null || scope.ValidTo >= workDate)
            orderby terminal.Code
            select new { terminal.StationId, terminal.PublicId, terminal.Code })
            .Distinct().ToArrayAsync(cancellationToken);
        var hasShift = await context.ShiftAssignments.AsNoTracking()
            .AnyAsync(shift => shift.RampAgentId == agentId &&
                shift.WorkDate == workDate, cancellationToken);
        return new HumanResourcesShiftAssignmentOptions(rampProfileId, workDate,
            hasShift, stations.Select(station => new HumanResourcesShiftStationOption(
                station.PublicId, station.Code, terminals
                    .Where(terminal => terminal.StationId == station.Id)
                    .Select(terminal => new HumanResourcesShiftTerminalOption(
                        terminal.PublicId, terminal.Code)).ToArray()))
                .Where(station => station.Terminals.Count > 0).ToArray());
    }

    public async Task<HumanResourcesShiftPage?> ListAsync(
        Guid actorId, DateOnly startDate, DateOnly endDate, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || startDate > endDate ||
            endDate.DayNumber - startDate.DayNumber > 30 ||
            page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission("human_resources.schedules.read") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;

        var rows = await (
            from shift in context.ShiftAssignments.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on shift.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join station in context.Stations.AsNoTracking()
                on shift.StationId equals station.Id
            join terminal in context.Terminals.AsNoTracking()
                on shift.TerminalId equals terminal.Id
            join position in context.OperationalPositions.AsNoTracking()
                on shift.OperationalPositionId equals (long?)position.Id into positions
            from position in positions.DefaultIfEmpty()
            where shift.WorkDate >= startDate && shift.WorkDate <= endDate
            orderby shift.WorkDate, agent.EmployeeNumber, shift.Id
            select new
            {
                Id = shift.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                StationId = station.PublicId,
                StationCode = station.Code,
                TerminalId = terminal.PublicId,
                TerminalCode = terminal.Code,
                PositionId = position == null ? (Guid?)null : position.PublicId,
                PositionCode = position == null ? null : position.Code,
                shift.WorkDate,
                shift.StartsAtLocal,
                shift.EndsAtLocal,
                shift.Block,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new HumanResourcesShiftPage(startDate, endDate, page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new HumanResourcesShiftData(
                row.Id, row.RampProfileId, $"{row.FirstName} {row.LastName}",
                row.EmployeeNumber, row.StationId, row.StationCode,
                row.TerminalId, row.TerminalCode, row.PositionId, row.PositionCode,
                row.WorkDate, row.StartsAtLocal, row.EndsAtLocal,
                row.Block.ToString())).ToArray());
    }
}
