using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesShiftReadStore(
    ElevantDbContext context, IActorContextResolver actors)
    : IHumanResourcesShiftReadStore
{
    public async Task<HumanResourcesShiftPage?> ListAsync(
        Guid actorId, DateOnly startDate, DateOnly endDate, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || startDate > endDate ||
            endDate.DayNumber - startDate.DayNumber > 6 ||
            page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code is "GESTION_HUMANA" or "SUPERADMIN") != true ||
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
