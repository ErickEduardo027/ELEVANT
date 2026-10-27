using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Appends on-screen alerts for a department in the transaction of the source event. A
/// recipient needs the department's «Notificaciones» option and the permission that lets it
/// open the source; a station-scoped source also needs that station. Re-raising the same
/// source marks the alert unread again instead of duplicating it.
/// </summary>
internal static class DepartmentNotificationWriter
{
    public static string PermissionOf(Department department) => department switch
    {
        Department.Operations => "operations.notifications.read",
        Department.HumanResources => "human_resources.notifications.read",
        Department.Contracts => "contracts.notifications.read",
        Department.Finance => "finance.notifications.read",
        _ => throw new ArgumentOutOfRangeException(nameof(department)),
    };

    public static async Task NotifyAsync(ElevantDbContext context, Department department,
        string sourcePermission, string kind, Guid sourceId, string? subject, DateTimeOffset occurredAt,
        CancellationToken cancellationToken, long? stationId = null, long? exceptAccountId = null)
    {
        var accounts = await DepartmentAccessQueries.ActiveInternalAccounts(context).ToArrayAsync(cancellationToken);
        var accesses = await DepartmentAccessQueries.ReadManyAsync(context, accounts, cancellationToken);
        var notification = PermissionOf(department);
        var recipients = accesses
            .Where(pair => pair.Key != exceptAccountId && !pair.Value.IsSuperAdministrator &&
                pair.Value.Department == department &&
                pair.Value.Has(notification) && pair.Value.Has(sourcePermission))
            .Select(pair => pair.Key).ToArray();
        if (stationId is { } station && recipients.Length > 0)
            recipients = await context.AccountStationScopes.AsNoTracking()
                .Where(scope => recipients.Contains(scope.AccountId) && scope.StationId == station &&
                    scope.GrantedAt <= occurredAt && scope.RevokedAt == null)
                .Select(scope => scope.AccountId).Distinct().ToArrayAsync(cancellationToken);
        if (recipients.Length == 0) return;

        var trimmed = subject?.Trim() is { Length: > 0 } text ? text[..Math.Min(text.Length, 160)] : null;
        var existing = await context.DepartmentNotifications
            .Where(item => recipients.Contains(item.RecipientAccountId) && item.Kind == kind && item.SourceId == sourceId)
            .ToDictionaryAsync(item => item.RecipientAccountId, cancellationToken);
        foreach (var recipient in recipients.Order())
        {
            if (!existing.TryGetValue(recipient, out var row))
            {
                row = new DepartmentNotification
                {
                    PublicId = Guid.CreateVersion7(), RecipientAccountId = recipient, Department = department,
                    StationId = stationId, Kind = kind, SourceId = sourceId, CreatedAt = occurredAt,
                };
                context.DepartmentNotifications.Add(row);
            }
            row.Subject = trimmed;
            row.OccurredAt = occurredAt;
            row.ReadAt = null;
            row.UpdatedAt = occurredAt;
            AccountChangeOutboxWriter.Add(context, recipient, stationId, "notifications", row.PublicId, occurredAt);
        }
    }
}
