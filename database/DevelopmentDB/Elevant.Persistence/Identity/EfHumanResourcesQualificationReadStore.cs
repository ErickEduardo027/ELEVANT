using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesQualificationReadStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesQualificationReadStore
{
    private const string RecordedAction = "hr.qualification.recorded";

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
        ListCurrentAsync(actorId, page, limit, new HumanResourcesQualificationQuery(Today()),
            cancellationToken);

    public Task<HumanResourcesQualificationPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, Guid rampProfileId, Guid equipmentTypeId,
        CancellationToken cancellationToken = default) =>
        ListCurrentAsync(actorId, page, limit, new HumanResourcesQualificationQuery(Today(),
            RampProfileId: rampProfileId, EquipmentTypeId: equipmentTypeId), cancellationToken);

    public async Task<HumanResourcesQualificationPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, HumanResourcesQualificationQuery query,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));
        Validate(query);
        if (!await AuthorizedAsync(actorId, cancellationToken)) return null;

        var rows = await WithValidity(Current(query), query)
            .OrderBy(row => row.EmployeeNumber).ThenBy(row => row.EquipmentCode)
            .ThenBy(row => row.Key)
            .Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new HumanResourcesQualificationPage(page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new HumanResourcesQualificationData(
                row.Id, row.RampProfileId, $"{row.FirstName} {row.LastName}",
                row.EmployeeNumber, row.EquipmentTypeId, row.EquipmentCode,
                row.EquipmentName, row.CycleNumber, row.TrainingDate, row.ObtainedOn,
                row.ExpiresOn, row.CertifyingEntity, row.InstructorName, row.Notes,
                row.CreatedAt, HumanResourcesDocumentSupport.Classify(
                    row.ObtainedOn, row.ExpiresOn, query.AsOf))).ToArray());
    }

    public async Task<HumanResourcesDocumentSummary?> SummarizeAsync(Guid actorId,
        HumanResourcesQualificationQuery query, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty) throw new ArgumentOutOfRangeException(nameof(actorId));
        Validate(query);
        if (!await AuthorizedAsync(actorId, cancellationToken)) return null;

        var asOf = query.AsOf;
        var soon = DocumentValidityRules.ExpiringSoonLimit(asOf);
        var counts = await Current(query with { Validity = null })
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Total = group.Count(),
                Expired = group.Count(row => row.ExpiresOn < asOf),
                Upcoming = group.Count(row => row.ExpiresOn >= asOf && row.ObtainedOn > asOf),
                ExpiringSoon = group.Count(row => row.ExpiresOn >= asOf &&
                    row.ObtainedOn <= asOf && row.ExpiresOn <= soon),
                Valid = group.Count(row => row.ObtainedOn <= asOf && row.ExpiresOn > soon),
            }).SingleOrDefaultAsync(cancellationToken);

        return new HumanResourcesDocumentSummary(asOf, DocumentValidityRules.ExpiringSoonDays,
            counts?.Total ?? 0, counts?.Valid ?? 0, counts?.ExpiringSoon ?? 0,
            counts?.Expired ?? 0, counts?.Upcoming ?? 0);
    }

    public async Task<HumanResourcesReadResult<HumanResourcesQualificationHistory>> GetHistoryAsync(
        Guid actorId, Guid qualificationId, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || qualificationId == Guid.Empty)
            throw new ArgumentOutOfRangeException(nameof(qualificationId));
        if (!await AuthorizedAsync(actorId, cancellationToken))
            return HumanResourcesReadResult<HumanResourcesQualificationHistory>.Denied();

        var anchor = await (
            from cycle in context.QualificationCycles.AsNoTracking()
            where cycle.PublicId == qualificationId
            join agent in context.RampAgents.AsNoTracking() on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
            join equipment in context.EquipmentTypes.AsNoTracking()
                on cycle.EquipmentTypeId equals equipment.Id
            select new
            {
                cycle.RampAgentId,
                cycle.EquipmentTypeId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                EquipmentPublicId = equipment.PublicId,
                equipment.Code,
                equipment.Name,
            }).SingleOrDefaultAsync(cancellationToken);
        if (anchor is null) return HumanResourcesReadResult<HumanResourcesQualificationHistory>.Missing();

        var cycles = await context.QualificationCycles.AsNoTracking()
            .Where(cycle => cycle.RampAgentId == anchor.RampAgentId &&
                cycle.EquipmentTypeId == anchor.EquipmentTypeId)
            .OrderByDescending(cycle => cycle.CycleNumber)
            .Select(cycle => new
            {
                cycle.PublicId, cycle.CycleNumber, cycle.IsCurrent, cycle.TrainingDate,
                cycle.ObtainedOn, cycle.ExpiresOn, cycle.CertifyingEntity,
                cycle.InstructorName, cycle.Notes, cycle.CreatedAt,
            }).ToArrayAsync(cancellationToken);
        var authors = await HumanResourcesDocumentSupport.RecordedByAsync(context,
            RecordedAction, cycles.Select(cycle => cycle.PublicId).ToArray(), cancellationToken);

        return HumanResourcesReadResult<HumanResourcesQualificationHistory>.Found(
            new HumanResourcesQualificationHistory(anchor.RampProfileId,
                $"{anchor.FirstName} {anchor.LastName}", anchor.EmployeeNumber,
                anchor.EquipmentPublicId, anchor.Code, anchor.Name,
                cycles.Select(cycle => new HumanResourcesQualificationCycle(cycle.PublicId,
                    cycle.CycleNumber, cycle.IsCurrent, cycle.TrainingDate, cycle.ObtainedOn,
                    cycle.ExpiresOn, cycle.CertifyingEntity, cycle.InstructorName, cycle.Notes,
                    cycle.CreatedAt, authors.GetValueOrDefault(cycle.PublicId))).ToArray()));
    }

    private IQueryable<CurrentRow> Current(HumanResourcesQualificationQuery query)
    {
        var search = HumanResourcesDocumentSupport.NormalizeSearch(query.Search);
        return
            from cycle in context.QualificationCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join equipment in context.EquipmentTypes.AsNoTracking()
                on cycle.EquipmentTypeId equals equipment.Id
            where cycle.IsCurrent &&
                (query.RampProfileId == null || agent.PublicId == query.RampProfileId) &&
                (query.EquipmentTypeId == null || equipment.PublicId == query.EquipmentTypeId) &&
                (search == null || agent.EmployeeNumber.Contains(search) ||
                    (person.FirstName + " " + person.LastName).Contains(search))
            select new CurrentRow
            {
                Key = cycle.Id,
                Id = cycle.PublicId,
                RampProfileId = agent.PublicId,
                FirstName = person.FirstName,
                LastName = person.LastName,
                EmployeeNumber = agent.EmployeeNumber,
                EquipmentTypeId = equipment.PublicId,
                EquipmentCode = equipment.Code,
                EquipmentName = equipment.Name,
                CycleNumber = cycle.CycleNumber,
                TrainingDate = cycle.TrainingDate,
                ObtainedOn = cycle.ObtainedOn,
                ExpiresOn = cycle.ExpiresOn,
                CertifyingEntity = cycle.CertifyingEntity,
                InstructorName = cycle.InstructorName,
                Notes = cycle.Notes,
                CreatedAt = cycle.CreatedAt,
            };
    }

    private static IQueryable<CurrentRow> WithValidity(IQueryable<CurrentRow> rows,
        HumanResourcesQualificationQuery query)
    {
        var asOf = query.AsOf;
        var soon = DocumentValidityRules.ExpiringSoonLimit(asOf);
        return query.Validity switch
        {
            null => rows,
            DocumentValidity.Expired => rows.Where(row => row.ExpiresOn < asOf),
            DocumentValidity.Upcoming => rows.Where(row => row.ExpiresOn >= asOf && row.ObtainedOn > asOf),
            DocumentValidity.ExpiringSoon => rows.Where(row => row.ExpiresOn >= asOf &&
                row.ObtainedOn <= asOf && row.ExpiresOn <= soon),
            DocumentValidity.Valid => rows.Where(row => row.ObtainedOn <= asOf && row.ExpiresOn > soon),
            _ => throw new ArgumentOutOfRangeException(nameof(query)),
        };
    }

    private static void Validate(HumanResourcesQualificationQuery query)
    {
        if (query is null || query.RampProfileId == Guid.Empty || query.EquipmentTypeId == Guid.Empty ||
            query.Search?.Length > HumanResourcesDocumentSupport.MaxSearchLength ||
            (query.Validity is { } validity && !Enum.IsDefined(validity)))
            throw new ArgumentOutOfRangeException(nameof(query));
    }

    // AVIAM's business day, never the UTC one (2-N31).
    private DateOnly Today() => BusinessCalendar.Today(clock.GetUtcNow());

    private async Task<bool> AuthorizedAsync(Guid actorId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.HasPermission("human_resources.qualifications.read") == true &&
            actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff);
    }

    private sealed class CurrentRow
    {
        public long Key { get; init; }
        public Guid Id { get; init; }
        public Guid RampProfileId { get; init; }
        public string FirstName { get; init; } = string.Empty;
        public string LastName { get; init; } = string.Empty;
        public string EmployeeNumber { get; init; } = string.Empty;
        public Guid EquipmentTypeId { get; init; }
        public string EquipmentCode { get; init; } = string.Empty;
        public string EquipmentName { get; init; } = string.Empty;
        public int CycleNumber { get; init; }
        public DateOnly TrainingDate { get; init; }
        public DateOnly ObtainedOn { get; init; }
        public DateOnly ExpiresOn { get; init; }
        public string CertifyingEntity { get; init; } = string.Empty;
        public string InstructorName { get; init; } = string.Empty;
        public string? Notes { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
    }
}
