using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesQualificationReadStore(
    ElevantDbContext context, IActorContextResolver actors)
    : IHumanResourcesQualificationReadStore
{
    public async Task<IReadOnlyList<HumanResourcesQualificationEquipmentType>?> ListEquipmentTypesAsync(
        Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await AuthorizedAsync(actorId, cancellationToken)) return null;
        return await context.EquipmentTypes.AsNoTracking()
            .Where(item => item.IsActive && item.RequiresQualification)
            .OrderBy(item => item.Code)
            .Select(item => new HumanResourcesQualificationEquipmentType(
                item.PublicId, item.Code, item.Name))
            .ToArrayAsync(cancellationToken);
    }

    public Task<HumanResourcesQualificationPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, CancellationToken cancellationToken = default) =>
        ListCurrentCoreAsync(actorId, page, limit, null, null, cancellationToken);

    public Task<HumanResourcesQualificationPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, Guid rampProfileId, Guid equipmentTypeId,
        CancellationToken cancellationToken = default) =>
        ListCurrentCoreAsync(actorId, page, limit, rampProfileId, equipmentTypeId,
            cancellationToken);

    private async Task<HumanResourcesQualificationPage?> ListCurrentCoreAsync(
        Guid actorId, int page, int limit, Guid? rampProfileId, Guid? equipmentTypeId,
        CancellationToken cancellationToken)
    {
        if (actorId == Guid.Empty || page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue ||
            rampProfileId == Guid.Empty || equipmentTypeId == Guid.Empty)
            throw new ArgumentOutOfRangeException(nameof(page));

        if (!await AuthorizedAsync(actorId, cancellationToken)) return null;

        var rows = await (
            from cycle in context.QualificationCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join equipment in context.EquipmentTypes.AsNoTracking()
                on cycle.EquipmentTypeId equals equipment.Id
            where cycle.IsCurrent &&
                (rampProfileId == null || agent.PublicId == rampProfileId) &&
                (equipmentTypeId == null || equipment.PublicId == equipmentTypeId)
            orderby agent.EmployeeNumber, equipment.Code, cycle.Id
            select new
            {
                Id = cycle.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                EquipmentTypeId = equipment.PublicId,
                EquipmentCode = equipment.Code,
                EquipmentName = equipment.Name,
                cycle.CycleNumber,
                cycle.TrainingDate,
                cycle.ObtainedOn,
                cycle.ExpiresOn,
                cycle.CertifyingEntity,
                cycle.InstructorName,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new HumanResourcesQualificationPage(page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new HumanResourcesQualificationData(
                row.Id, row.RampProfileId, $"{row.FirstName} {row.LastName}",
                row.EmployeeNumber, row.EquipmentTypeId, row.EquipmentCode,
                row.EquipmentName, row.CycleNumber, row.TrainingDate, row.ObtainedOn,
                row.ExpiresOn, row.CertifyingEntity, row.InstructorName)).ToArray());
    }

    private async Task<bool> AuthorizedAsync(Guid actorId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code is "GESTION_HUMANA" or "SUPERADMIN") == true &&
            actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff);
    }
}
