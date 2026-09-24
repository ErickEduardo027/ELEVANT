using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>Appends account-targeted alerts in the transaction of the source event.</summary>
internal static class OperationalNotificationWriter
{
    public static async Task NotifyOccAsync(
        ElevantDbContext context, long stationId, long operationId,
        Guid sourceId, string kind, DateTimeOffset occurredAt,
        long? exceptAccountId, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(occurredAt.UtcDateTime);
        var recipients = await context.Users.AsNoTracking()
            .Where(account => account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted && account.EmailConfirmed &&
                account.Id != exceptAccountId &&
                context.UserRoles.Any(userRole => userRole.UserId == account.Id &&
                    context.Roles.Any(role => role.Id == userRole.RoleId &&
                        role.NormalizedName == "ADMIN_OCC" && role.Portal == PortalKind.BackOffice)) &&
                context.AccountStationScopes.Any(scope => scope.AccountId == account.Id &&
                    scope.StationId == stationId && scope.GrantedAt <= occurredAt && scope.RevokedAt == null) &&
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
            .Select(account => account.Id)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        Add(context, recipients, stationId, operationId, sourceId, kind, occurredAt);
    }

    public static async Task NotifyAssignedAgentsAsync(
        ElevantDbContext context, long stationId, long operationId,
        Guid sourceId, string kind, DateTimeOffset occurredAt,
        long? exceptAccountId, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(occurredAt.UtcDateTime);
        var recipients = await (
            from assignment in context.OperationAgentAssignments.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on assignment.RampAgentId equals agent.Id
            join account in context.Users.AsNoTracking()
                on agent.PersonId equals account.PersonId
            where assignment.GroundOperationId == operationId &&
                  assignment.ReleasedAt == null && agent.IsActive &&
                  account.Status == AccountLifecycleStatus.Active &&
                  account.InvitationStatus == InvitationStatus.Accepted && account.EmailConfirmed &&
                  account.Id != exceptAccountId &&
                  context.UserRoles.Any(userRole => userRole.UserId == account.Id &&
                      context.Roles.Any(role => role.Id == userRole.RoleId &&
                          role.NormalizedName == "RAMP_AGENT" && role.Portal == PortalKind.RampMobileApp)) &&
                  context.OrganizationMemberships.Any(membership =>
                      membership.AccountId == account.Id &&
                      membership.Kind == MembershipKind.InternalStaff &&
                      membership.Status == MembershipStatus.Active &&
                      (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                      (membership.ValidTo == null || membership.ValidTo >= today) &&
                      context.Organizations.Any(organization =>
                          organization.Id == membership.OrganizationId &&
                          organization.Type == OrganizationType.AviamOperator &&
                          organization.Status == OrganizationStatus.Active)) &&
                  context.AccountStationScopes.Any(scope => scope.AccountId == account.Id &&
                      scope.StationId == stationId && scope.GrantedAt <= occurredAt &&
                      scope.RevokedAt == null)
            select account.Id)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        Add(context, recipients, stationId, operationId, sourceId, kind, occurredAt);
    }

    public static async Task NotifyAgentAsync(
        ElevantDbContext context, long rampAgentId, long stationId,
        long operationId, Guid sourceId, string kind,
        DateTimeOffset occurredAt, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(occurredAt.UtcDateTime);
        var recipients = await (
            from agent in context.RampAgents.AsNoTracking()
            join account in context.Users.AsNoTracking()
                on agent.PersonId equals account.PersonId
            where agent.Id == rampAgentId && agent.IsActive &&
                  account.Status == AccountLifecycleStatus.Active &&
                  account.InvitationStatus == InvitationStatus.Accepted && account.EmailConfirmed &&
                  context.UserRoles.Any(userRole => userRole.UserId == account.Id &&
                      context.Roles.Any(role => role.Id == userRole.RoleId &&
                          role.NormalizedName == "RAMP_AGENT" && role.Portal == PortalKind.RampMobileApp)) &&
                  context.AccountStationScopes.Any(scope => scope.AccountId == account.Id &&
                      scope.StationId == stationId && scope.GrantedAt <= occurredAt &&
                      scope.RevokedAt == null) &&
                  context.OrganizationMemberships.Any(membership =>
                      membership.AccountId == account.Id &&
                      membership.Kind == MembershipKind.InternalStaff &&
                      membership.Status == MembershipStatus.Active &&
                      (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                      (membership.ValidTo == null || membership.ValidTo >= today) &&
                      context.Organizations.Any(organization =>
                          organization.Id == membership.OrganizationId &&
                          organization.Type == OrganizationType.AviamOperator &&
                          organization.Status == OrganizationStatus.Active))
            select account.Id)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        Add(context, recipients, stationId, operationId, sourceId, kind, occurredAt);
    }

    private static void Add(ElevantDbContext context, IEnumerable<long> recipients,
        long stationId, long operationId, Guid sourceId, string kind,
        DateTimeOffset occurredAt)
    {
        foreach (var recipientAccountId in recipients)
        {
            context.OperationalNotifications.Add(new OperationalNotification
            {
                PublicId = Guid.CreateVersion7(),
                RecipientAccountId = recipientAccountId,
                StationId = stationId,
                GroundOperationId = operationId,
                SourceId = sourceId,
                Kind = kind,
                OccurredAt = occurredAt,
                CreatedAt = occurredAt,
                UpdatedAt = occurredAt,
            });
        }
    }
}
