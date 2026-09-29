using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesPermitReadStore(
    ElevantDbContext context, IActorContextResolver actors)
    : IHumanResourcesPermitReadStore
{
    public async Task<HumanResourcesPermitPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code is "GESTION_HUMANA" or "SUPERADMIN") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;

        var rows = await (
            from cycle in context.AirportPermitCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where cycle.IsCurrent
            orderby agent.EmployeeNumber, cycle.DocumentType, cycle.Id
            select new
            {
                Id = cycle.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                cycle.DocumentType,
                cycle.CycleNumber,
                cycle.DocumentNumber,
                cycle.IssuedOn,
                cycle.ExpiresOn,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new HumanResourcesPermitPage(page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new HumanResourcesPermitData(
                row.Id, row.RampProfileId, $"{row.FirstName} {row.LastName}",
                row.EmployeeNumber, row.DocumentType.ToString(), row.CycleNumber,
                row.DocumentNumber, row.IssuedOn, row.ExpiresOn)).ToArray());
    }
}
