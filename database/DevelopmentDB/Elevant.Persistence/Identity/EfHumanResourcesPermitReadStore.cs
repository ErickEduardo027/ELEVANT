using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesPermitReadStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesPermitReadStore
{
    private const string RecordedAction = "hr.permit.recorded";

    public Task<HumanResourcesPermitPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, CancellationToken cancellationToken = default) =>
        ListCurrentAsync(actorId, page, limit, new HumanResourcesPermitQuery(Today()),
            cancellationToken);

    public Task<HumanResourcesPermitPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, Guid rampProfileId,
        PermitDocumentType documentType, CancellationToken cancellationToken = default) =>
        ListCurrentAsync(actorId, page, limit, new HumanResourcesPermitQuery(Today(),
            RampProfileId: rampProfileId, DocumentType: documentType), cancellationToken);

    public async Task<HumanResourcesPermitPage?> ListCurrentAsync(
        Guid actorId, int page, int limit, HumanResourcesPermitQuery query,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));
        Validate(query);
        if (!await AuthorizedAsync(actorId, cancellationToken)) return null;

        var rows = await WithValidity(Current(query), query)
            .OrderBy(row => row.EmployeeNumber).ThenBy(row => row.DocumentType)
            .ThenBy(row => row.Key)
            .Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new HumanResourcesPermitPage(page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new HumanResourcesPermitData(
                row.Id, row.RampProfileId, $"{row.FirstName} {row.LastName}",
                row.EmployeeNumber, row.DocumentType.ToString(), row.CycleNumber,
                row.DocumentNumber, row.IssuedOn, row.ExpiresOn, row.CreatedAt,
                HumanResourcesDocumentSupport.Classify(row.IssuedOn, row.ExpiresOn,
                    query.AsOf))).ToArray());
    }

    public async Task<HumanResourcesDocumentSummary?> SummarizeAsync(Guid actorId,
        HumanResourcesPermitQuery query, CancellationToken cancellationToken = default)
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
                Upcoming = group.Count(row => row.ExpiresOn >= asOf && row.IssuedOn > asOf),
                ExpiringSoon = group.Count(row => row.ExpiresOn >= asOf &&
                    row.IssuedOn <= asOf && row.ExpiresOn <= soon),
                Valid = group.Count(row => row.IssuedOn <= asOf && row.ExpiresOn > soon),
            }).SingleOrDefaultAsync(cancellationToken);

        return new HumanResourcesDocumentSummary(asOf, DocumentValidityRules.ExpiringSoonDays,
            counts?.Total ?? 0, counts?.Valid ?? 0, counts?.ExpiringSoon ?? 0,
            counts?.Expired ?? 0, counts?.Upcoming ?? 0);
    }

    public async Task<HumanResourcesReadResult<HumanResourcesPermitHistory>> GetHistoryAsync(
        Guid actorId, Guid permitId, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || permitId == Guid.Empty)
            throw new ArgumentOutOfRangeException(nameof(permitId));
        if (!await AuthorizedAsync(actorId, cancellationToken))
            return HumanResourcesReadResult<HumanResourcesPermitHistory>.Denied();

        var anchor = await (
            from cycle in context.AirportPermitCycles.AsNoTracking()
            where cycle.PublicId == permitId
            join agent in context.RampAgents.AsNoTracking() on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
            select new
            {
                cycle.RampAgentId,
                cycle.DocumentType,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
            }).SingleOrDefaultAsync(cancellationToken);
        if (anchor is null) return HumanResourcesReadResult<HumanResourcesPermitHistory>.Missing();

        var cycles = await context.AirportPermitCycles.AsNoTracking()
            .Where(cycle => cycle.RampAgentId == anchor.RampAgentId &&
                cycle.DocumentType == anchor.DocumentType)
            .OrderByDescending(cycle => cycle.CycleNumber)
            .Select(cycle => new
            {
                cycle.PublicId, cycle.CycleNumber, cycle.IsCurrent, cycle.DocumentNumber,
                cycle.IssuedOn, cycle.ExpiresOn, cycle.CreatedAt,
            }).ToArrayAsync(cancellationToken);
        var authors = await HumanResourcesDocumentSupport.RecordedByAsync(context,
            RecordedAction, cycles.Select(cycle => cycle.PublicId).ToArray(), cancellationToken);

        return HumanResourcesReadResult<HumanResourcesPermitHistory>.Found(
            new HumanResourcesPermitHistory(anchor.RampProfileId,
                $"{anchor.FirstName} {anchor.LastName}", anchor.EmployeeNumber,
                anchor.DocumentType.ToString(),
                cycles.Select(cycle => new HumanResourcesPermitCycle(cycle.PublicId,
                    cycle.CycleNumber, cycle.IsCurrent, cycle.DocumentNumber, cycle.IssuedOn,
                    cycle.ExpiresOn, cycle.CreatedAt,
                    authors.GetValueOrDefault(cycle.PublicId))).ToArray()));
    }

    private IQueryable<CurrentRow> Current(HumanResourcesPermitQuery query)
    {
        var search = HumanResourcesDocumentSupport.NormalizeSearch(query.Search);
        return
            from cycle in context.AirportPermitCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where cycle.IsCurrent &&
                (query.RampProfileId == null || agent.PublicId == query.RampProfileId) &&
                (query.DocumentType == null || cycle.DocumentType == query.DocumentType) &&
                (search == null || agent.EmployeeNumber.Contains(search) ||
                    cycle.DocumentNumber.Contains(search) ||
                    (person.FirstName + " " + person.LastName).Contains(search))
            select new CurrentRow
            {
                Key = cycle.Id,
                Id = cycle.PublicId,
                RampProfileId = agent.PublicId,
                FirstName = person.FirstName,
                LastName = person.LastName,
                EmployeeNumber = agent.EmployeeNumber,
                DocumentType = cycle.DocumentType,
                CycleNumber = cycle.CycleNumber,
                DocumentNumber = cycle.DocumentNumber,
                IssuedOn = cycle.IssuedOn,
                ExpiresOn = cycle.ExpiresOn,
                CreatedAt = cycle.CreatedAt,
            };
    }

    private static IQueryable<CurrentRow> WithValidity(IQueryable<CurrentRow> rows,
        HumanResourcesPermitQuery query)
    {
        var asOf = query.AsOf;
        var soon = DocumentValidityRules.ExpiringSoonLimit(asOf);
        return query.Validity switch
        {
            null => rows,
            DocumentValidity.Expired => rows.Where(row => row.ExpiresOn < asOf),
            DocumentValidity.Upcoming => rows.Where(row => row.ExpiresOn >= asOf && row.IssuedOn > asOf),
            DocumentValidity.ExpiringSoon => rows.Where(row => row.ExpiresOn >= asOf &&
                row.IssuedOn <= asOf && row.ExpiresOn <= soon),
            DocumentValidity.Valid => rows.Where(row => row.IssuedOn <= asOf && row.ExpiresOn > soon),
            _ => throw new ArgumentOutOfRangeException(nameof(query)),
        };
    }

    private static void Validate(HumanResourcesPermitQuery query)
    {
        if (query is null || query.RampProfileId == Guid.Empty ||
            query.Search?.Length > HumanResourcesDocumentSupport.MaxSearchLength ||
            (query.DocumentType is { } type && !Enum.IsDefined(type)) ||
            (query.Validity is { } validity && !Enum.IsDefined(validity)))
            throw new ArgumentOutOfRangeException(nameof(query));
    }

    private DateOnly Today() => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

    private async Task<bool> AuthorizedAsync(Guid actorId, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.HasPermission("human_resources.permits.read") == true &&
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
        public PermitDocumentType DocumentType { get; init; }
        public int CycleNumber { get; init; }
        public string DocumentNumber { get; init; } = string.Empty;
        public DateOnly IssuedOn { get; init; }
        public DateOnly ExpiresOn { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
    }
}
