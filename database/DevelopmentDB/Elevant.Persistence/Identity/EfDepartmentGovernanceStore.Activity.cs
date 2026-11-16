using System.Globalization;
using System.Text;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Department activity read from the audit trail (ADR-0017).</summary>
internal sealed partial class EfDepartmentGovernanceStore
{
    private const string AuditRead = "human_resources.audit.read";
    private static readonly TimeSpan MaximumActivityWindow = TimeSpan.FromDays(92);

    /// <summary>
    /// An entry belongs to a department when it was written for it, or when its actor worked in that
    /// department at that instant (employee assignment history; accounts without an employee fall back to
    /// their current department assignment). Department administrators read their department; Human
    /// Resources auditors read the people-governance trail of every department and all of their own; the
    /// super administrator reads everything.
    /// </summary>
    public async Task<ActivityPageData?> ListActivityAsync(Guid actorId, string? department, DateTimeOffset from,
        DateTimeOffset to, string? category, Guid? accountId, string? cursor, int limit,
        CancellationToken cancellationToken = default)
    {
        if (limit is < 1 or > 100 || to <= from || to - from > MaximumActivityWindow) return null;
        if (category is not (null or "login" or "governance" or "operation")) return null;
        Department? parsed = null;
        if (department is not null)
        {
            if (!TryParse(department, out var value)) return null;
            parsed = value;
        }
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null) return null;
        var administers = parsed is { } own && actor.Administers(own);
        var auditor = actor.IsSuper || actor.Can(AuditRead);
        if (!administers && !auditor) return null;
        // Auditors outside their department only follow who was given or denied access.
        var peopleOnly = !actor.IsSuper && !administers &&
                         !(parsed == Department.HumanResources && actor.Access?.Department == Department.HumanResources);
        (DateTimeOffset At, long Id)? after = null;
        if (cursor is not null)
        {
            if (DecodeCursor(cursor) is not { } decoded) return null;
            after = decoded;
        }
        long? actorFilter = null;
        if (accountId is { } filterId)
        {
            actorFilter = await context.Users.AsNoTracking().Where(user => user.PublicId == filterId)
                .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
            if (actorFilter is null) return new ActivityPageData([], null);
        }

        var query = context.AuditEntries.AsNoTracking()
            .Where(entry => entry.OccurredAt >= from && entry.OccurredAt < to)
            .Where(entry => actorFilter == null || entry.ActorAccountId == actorFilter);
        if (parsed is { } scoped)
        {
            query = query.Where(entry => entry.Department == scoped ||
                (entry.ActorAccountId != null && (
                    (from user in context.Users
                     join employee in context.Employees on user.PersonId equals employee.PersonId
                     join assignment in context.EmployeeAssignments on employee.Id equals assignment.EmployeeId
                     where user.Id == entry.ActorAccountId && assignment.Department == scoped &&
                           assignment.ValidFrom <= entry.OccurredAt &&
                           (assignment.ValidTo == null || assignment.ValidTo > entry.OccurredAt)
                     select assignment.Id).Any() ||
                    (!(from user in context.Users
                       join employee in context.Employees on user.PersonId equals employee.PersonId
                       where user.Id == entry.ActorAccountId
                       select employee.Id).Any() &&
                     context.DepartmentAssignments.Any(assignment =>
                         assignment.AccountId == entry.ActorAccountId && assignment.Department == scoped)))));
        }
        if (peopleOnly)
            query = query.Where(entry => entry.Action.StartsWith("hr.") || entry.Action.StartsWith("governance.") ||
                entry.Action.StartsWith("auth."));
        query = category switch
        {
            "login" => query.Where(entry => entry.Action.StartsWith("auth.")),
            "governance" => query.Where(entry => entry.Action.StartsWith("governance.") || entry.Action.StartsWith("hr.")),
            "operation" => query.Where(entry => !entry.Action.StartsWith("auth.") && !entry.Action.StartsWith("governance.") &&
                !entry.Action.StartsWith("hr.")),
            _ => query,
        };
        if (after is { } position)
            query = query.Where(entry => entry.OccurredAt < position.At ||
                (entry.OccurredAt == position.At && entry.Id < position.Id));

        var rows = await query.OrderByDescending(entry => entry.OccurredAt).ThenByDescending(entry => entry.Id)
            .Take(limit + 1)
            .Select(entry => new
            {
                entry.Id, entry.PublicId, entry.OccurredAt, entry.ActorAccountId, entry.ActorDisplay, entry.Department,
                entry.Action, entry.EntityType, entry.EntityPublicId, entry.StationId, entry.Reason,
            }).ToArrayAsync(cancellationToken);
        var page = rows.Take(limit).ToArray();
        var actorIds = page.Where(row => row.ActorAccountId != null).Select(row => row.ActorAccountId!.Value).Distinct().ToArray();
        var actors = await (from user in context.Users.AsNoTracking()
                            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                            where actorIds.Contains(user.Id)
                            select new { user.Id, user.PublicId, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var stationIds = page.Where(row => row.StationId != null).Select(row => row.StationId!.Value).Distinct().ToArray();
        var stations = await context.Stations.AsNoTracking().Where(station => stationIds.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.Code, cancellationToken);
        var entries = page.Select(row =>
        {
            var who = row.ActorAccountId is { } id && actors.TryGetValue(id, out var found) ? found : null;
            return new ActivityEntryData(row.PublicId, row.OccurredAt, who?.PublicId, who?.Name ?? row.ActorDisplay,
                row.Department is { } owned ? KeyOf(owned) : null, row.Action, CategoryOf(row.Action), row.EntityType,
                row.EntityPublicId, row.StationId is { } station ? stations.GetValueOrDefault(station) : null, row.Reason);
        }).ToArray();
        var next = rows.Length > limit ? EncodeCursor(page[^1].OccurredAt, page[^1].Id) : null;
        return new ActivityPageData(entries, next);
    }

    private static string CategoryOf(string action) =>
        action.StartsWith("auth.", StringComparison.Ordinal) ? "login"
        : action.StartsWith("governance.", StringComparison.Ordinal) || action.StartsWith("hr.", StringComparison.Ordinal)
            ? "governance" : "operation";

    private static string EncodeCursor(DateTimeOffset at, long id) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(
            $"{at.UtcTicks.ToString(CultureInfo.InvariantCulture)}:{id.ToString(CultureInfo.InvariantCulture)}"));

    private static (DateTimeOffset At, long Id)? DecodeCursor(string cursor)
    {
        try
        {
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(cursor)).Split(':');
            return parts.Length == 2 &&
                   long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) &&
                   long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var id) &&
                   ticks is > 0 && ticks <= DateTimeOffset.MaxValue.UtcTicks
                ? (new DateTimeOffset(ticks, TimeSpan.Zero), id)
                : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
