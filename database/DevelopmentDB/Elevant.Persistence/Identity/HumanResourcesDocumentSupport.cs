using Elevant.Domain.Governance;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Helpers shared by the qualification and airport permit read stores.</summary>
internal static class HumanResourcesDocumentSupport
{
    public const int MaxSearchLength = 100;

    public static string? NormalizeSearch(string? search)
    {
        var trimmed = search?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    /// <summary>Resolves who recorded each cycle from its write audit; seeded cycles have no author.</summary>
    public static async Task<IReadOnlyDictionary<Guid, string>> RecordedByAsync(
        ElevantDbContext context, string action, IReadOnlyCollection<Guid> cycleIds,
        CancellationToken cancellationToken)
    {
        if (cycleIds.Count == 0) return new Dictionary<Guid, string>();
        var rows = await (
            from entry in context.AuditEntries.AsNoTracking()
            where entry.Action == action && entry.EntityPublicId != null &&
                cycleIds.Contains(entry.EntityPublicId.Value)
            join user in context.Users.AsNoTracking() on entry.ActorAccountId equals user.Id into users
            from user in users.DefaultIfEmpty()
            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id into people
            from person in people.DefaultIfEmpty()
            orderby entry.OccurredAt
            select new
            {
                CycleId = entry.EntityPublicId!.Value,
                Name = person == null ? entry.ActorDisplay : person.FirstName + " " + person.LastName,
            }).ToArrayAsync(cancellationToken);
        var result = new Dictionary<Guid, string>();
        foreach (var row in rows)
            if (!string.IsNullOrWhiteSpace(row.Name)) result.TryAdd(row.CycleId, row.Name);
        return result;
    }

    public static string Classify(DateOnly startsOn, DateOnly expiresOn, DateOnly asOf) =>
        DocumentValidityRules.Classify(startsOn, expiresOn, asOf).ToString();
}
