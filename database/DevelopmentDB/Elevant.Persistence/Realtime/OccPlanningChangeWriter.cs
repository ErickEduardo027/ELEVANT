using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Realtime;

/// <summary>Publishes a station-only OCC invalidation in the source transaction.</summary>
internal static class OccPlanningChangeWriter
{
    public static async Task AddForAgentAsync(ElevantDbContext context, long rampAgentId,
        DateOnly startsOn, DateOnly endsOn, DateTimeOffset occurredAt,
        CancellationToken cancellationToken)
    {
        var stations = await (from scope in context.Set<RampAgentStationScope>().AsNoTracking()
            join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
            where scope.RampAgentId == rampAgentId &&
                scope.ValidFrom <= endsOn &&
                (scope.ValidTo == null || scope.ValidTo >= startsOn)
            select new { station.Id, station.PublicId }).Distinct()
            .ToArrayAsync(cancellationToken);
        foreach (var station in stations)
            await AddForStationAsync(context, station.Id, station.PublicId,
                occurredAt, cancellationToken);
    }

    public static async Task AddForStationAsync(ElevantDbContext context,
        long stationId, Guid stationPublicId, DateTimeOffset occurredAt,
        CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(occurredAt.UtcDateTime);
        var recipients = await context.Users.AsNoTracking()
            .Where(account => account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted &&
                account.EmailConfirmed &&
                context.UserRoles.Any(link => link.UserId == account.Id &&
                    context.Roles.Any(role => role.Id == link.RoleId &&
                        role.NormalizedName == "ADMIN_OCC" &&
                        role.Portal == PortalKind.BackOffice)) &&
                context.AccountStationScopes.Any(scope =>
                    scope.AccountId == account.Id && scope.StationId == stationId &&
                    scope.GrantedAt <= occurredAt && scope.RevokedAt == null) &&
                context.OrganizationMemberships.Any(membership =>
                    membership.AccountId == account.Id &&
                    membership.Kind == MembershipKind.InternalStaff &&
                    membership.Status == MembershipStatus.Active &&
                    (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                    (membership.ValidTo == null || membership.ValidTo >= today) &&
                    context.Organizations.Any(organization =>
                        organization.Id == membership.OrganizationId &&
                        organization.Type == OrganizationType.AviamOperator &&
                        organization.Status == OrganizationStatus.Active)))
            .Select(account => account.Id).Distinct()
            .ToArrayAsync(cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, stationId,
                "occ_planning", stationPublicId, occurredAt);
    }
}
