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
    public Task<HumanResourcesPermitPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, CancellationToken cancellationToken = default) =>
        ListCurrentCoreAsync(actorId, page, limit, null, null, cancellationToken);

    public Task<HumanResourcesPermitPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, Guid rampProfileId,
        PermitDocumentType documentType, CancellationToken cancellationToken = default) =>
        ListCurrentCoreAsync(actorId, page, limit, rampProfileId, documentType,
            cancellationToken);

    private async Task<HumanResourcesPermitPage?> ListCurrentCoreAsync(
        Guid actorId, int page, int limit, Guid? rampProfileId,
        PermitDocumentType? documentType, CancellationToken cancellationToken)
    {
        if (actorId == Guid.Empty || page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue || rampProfileId == Guid.Empty)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission("human_resources.permits.read") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;

        var rows = await (
            from cycle in context.AirportPermitCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where cycle.IsCurrent &&
                (rampProfileId == null || agent.PublicId == rampProfileId) &&
                (documentType == null || cycle.DocumentType == documentType)
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
