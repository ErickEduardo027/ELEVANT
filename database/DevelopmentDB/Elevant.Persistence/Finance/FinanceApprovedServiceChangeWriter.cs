using Elevant.Application.Common;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Targets current AVIAM Finance members in the approval transaction.</summary>
internal static class FinanceApprovedServiceChangeWriter
{
    public static async Task AddAsync(
        ElevantDbContext context, long stationId, Guid operationId,
        DateTimeOffset occurredAt, CancellationToken cancellationToken)
        => await AddAsync(context, stationId, operationId, occurredAt,
            "finance_approved_services", cancellationToken);

    public static async Task AddAsync(
        ElevantDbContext context, long stationId, Guid resourceId,
        DateTimeOffset occurredAt, string resource, CancellationToken cancellationToken)
    {
        // A membership is valid by AVIAM's business day (4-N10).
        var today = BusinessCalendar.Today(occurredAt);
        var recipients = await context.Users.AsNoTracking()
            .Where(account => account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted && account.EmailConfirmed &&
                context.UserRoles.Any(userRole => userRole.UserId == account.Id &&
                    context.Roles.Any(role => role.Id == userRole.RoleId &&
                        role.NormalizedName == "FINANZAS" && role.Portal == PortalKind.BackOffice)) &&
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
                        organization.Status == OrganizationStatus.Active)))
            .Select(account => account.Id).Distinct().ToArrayAsync(cancellationToken);

        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, stationId,
                resource, resourceId, occurredAt);
    }
}
