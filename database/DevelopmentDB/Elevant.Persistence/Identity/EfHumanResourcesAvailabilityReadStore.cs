using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesAvailabilityReadStore(
    ElevantDbContext context, IActorContextResolver actors)
    : IHumanResourcesAvailabilityReadStore
{
    public async Task<HumanResourcesAvailabilityRequestPage?> ListAsync(
        Guid actorId, DateOnly startDate, DateOnly endDate, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || startDate > endDate ||
            endDate.DayNumber - startDate.DayNumber > 30 || page < 1 ||
            limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission("human_resources.availability.read") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;

        var rows = await (
            from request in context.AvailabilityRequests.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on request.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where request.StartsOn <= endDate && request.EndsOn >= startDate
            orderby request.StartsOn, request.Id
            select new
            {
                Id = request.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                request.StartsOn,
                request.EndsOn,
                request.Type,
                request.Status,
                request.Reason,
                request.RequestedAt,
                request.ResolvedAt,
                request.ResolutionNote,
                request.RowVersion,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new HumanResourcesAvailabilityRequestPage(startDate, endDate, page, limit,
            rows.Length > limit, rows.Take(limit).Select(row =>
                new HumanResourcesAvailabilityRequestData(row.Id, row.RampProfileId,
                    $"{row.FirstName} {row.LastName}", row.EmployeeNumber,
                    row.StartsOn, row.EndsOn, row.Type.ToString(), row.Status.ToString(),
                    row.Reason, row.RequestedAt, row.ResolvedAt,
                    row.ResolutionNote, GovernanceSupport.Version(row.RowVersion))).ToArray());
    }
}
