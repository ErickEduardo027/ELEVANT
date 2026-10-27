using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Entities.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Reads and acknowledges the caller's department alerts under its current access.</summary>
internal sealed class EfDepartmentNotificationStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider)
    : IDepartmentNotificationStore
{
    private const int PageLimit = 50;

    public async Task<DepartmentNotificationResult<DepartmentNotificationListData>> ListAsync(Guid accountId,
        CancellationToken cancellationToken = default)
    {
        var reader = await ReaderAsync(accountId, cancellationToken);
        if (reader is null)
            return DepartmentNotificationResult<DepartmentNotificationListData>.Failed(DepartmentNotificationFailure.Forbidden);
        var visible = Visible(reader.Value);
        var rows = await (from notification in visible.OrderByDescending(item => item.OccurredAt).ThenByDescending(item => item.Id)
                          join station in context.Stations.AsNoTracking() on notification.StationId equals station.Id into stations
                          from station in stations.DefaultIfEmpty()
                          select new { notification, StationCode = station == null ? null : station.Code })
            .Take(PageLimit + 1).ToArrayAsync(cancellationToken);
        var unread = await visible.CountAsync(item => item.ReadAt == null, cancellationToken);
        return DepartmentNotificationResult<DepartmentNotificationListData>.Success(new(
            rows.Take(PageLimit).Select(row => Map(row.notification, row.StationCode)).ToArray(), unread, rows.Length > PageLimit));
    }

    public async Task<DepartmentNotificationResult<DepartmentNotificationData>> SetReadAsync(Guid accountId,
        Guid notificationId, bool read, CancellationToken cancellationToken = default)
    {
        var reader = await ReaderAsync(accountId, cancellationToken);
        if (reader is null)
            return DepartmentNotificationResult<DepartmentNotificationData>.Failed(DepartmentNotificationFailure.Forbidden);
        var (internalId, access) = reader.Value;
        var item = await context.DepartmentNotifications
            .Where(row => row.PublicId == notificationId && row.RecipientAccountId == internalId && row.Department == access.Department &&
                (row.StationId == null || context.AccountStationScopes.Any(scope => scope.AccountId == internalId &&
                    scope.StationId == row.StationId && scope.RevokedAt == null)))
            .SingleOrDefaultAsync(cancellationToken);
        if (item is null)
            return DepartmentNotificationResult<DepartmentNotificationData>.Failed(DepartmentNotificationFailure.NotFound);
        if (item.ReadAt.HasValue != read)
        {
            var now = timeProvider.GetUtcNow();
            now = new DateTimeOffset(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
            item.ReadAt = read ? now : null;
            item.UpdatedAt = now;
            try
            {
                await context.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                context.ChangeTracker.Clear();
                return DepartmentNotificationResult<DepartmentNotificationData>.Failed(DepartmentNotificationFailure.Conflict);
            }
        }
        var stationCode = item.StationId is null ? null : await context.Stations.AsNoTracking()
            .Where(station => station.Id == item.StationId).Select(station => station.Code).SingleAsync(cancellationToken);
        return DepartmentNotificationResult<DepartmentNotificationData>.Success(Map(item, stationCode));
    }

    private IQueryable<DepartmentNotification> Visible((long Id, DepartmentAccess Access) reader) =>
        context.DepartmentNotifications.AsNoTracking()
            .Where(row => row.RecipientAccountId == reader.Id && row.Department == reader.Access.Department &&
                (row.StationId == null || context.AccountStationScopes.Any(scope => scope.AccountId == reader.Id &&
                    scope.StationId == row.StationId && scope.RevokedAt == null)));

    /// <summary>An active internal account of a department that holds its «Notificaciones» option.</summary>
    private async Task<(long Id, DepartmentAccess Access)?> ReaderAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor?.EffectiveAccess is not { Department: { } department } access ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator) ||
            !access.Has(DepartmentNotificationWriter.PermissionOf(department)))
            return null;
        var id = await context.Users.AsNoTracking().Where(user => user.PublicId == accountId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        return (id, access);
    }

    private static DepartmentNotificationData Map(DepartmentNotification row, string? stationCode) => new(
        row.PublicId, row.Department.ToString(), row.Kind, row.SourceId, row.Subject, stationCode, row.OccurredAt, row.ReadAt);
}
