using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>Targets the airline's current portal members without trusting a browser tenant ID.</summary>
internal static class AirlineOperationChangeWriter
{
    public static async Task AddAsync(ElevantDbContext context, long airlineOrganizationId,
        Guid operationId, DateTimeOffset occurredAt, CancellationToken cancellationToken)
        => await AddForResourceAsync(context, airlineOrganizationId,
            "airline_operations", operationId, occurredAt, cancellationToken);

    public static async Task AddPreinvoiceAsync(ElevantDbContext context, long airlineOrganizationId,
        Guid preinvoiceId, DateTimeOffset occurredAt, CancellationToken cancellationToken)
        => await AddForResourceAsync(context, airlineOrganizationId,
            "airline_preinvoices", preinvoiceId, occurredAt, cancellationToken);

    private static async Task AddForResourceAsync(ElevantDbContext context,
        long airlineOrganizationId, string resource, Guid resourceId,
        DateTimeOffset occurredAt, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(occurredAt.UtcDateTime);
        var recipients = await (
            from membership in context.OrganizationMemberships.AsNoTracking()
            join account in context.Users.AsNoTracking()
                on membership.AccountId equals account.Id
            join organization in context.Organizations.AsNoTracking()
                on membership.OrganizationId equals organization.Id
            where membership.OrganizationId == airlineOrganizationId &&
                  membership.Kind == MembershipKind.AirlineClient &&
                  membership.Status == MembershipStatus.Active &&
                  (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                  (membership.ValidTo == null || membership.ValidTo >= today) &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active &&
                  account.Status == AccountLifecycleStatus.Active &&
                  account.InvitationStatus == InvitationStatus.Accepted &&
                  account.EmailConfirmed &&
                  context.UserRoles.Any(userRole => userRole.UserId == account.Id &&
                      context.Roles.Any(role => role.Id == userRole.RoleId &&
                          role.NormalizedName == "AIRLINE_CLIENT" &&
                          role.Portal == PortalKind.AirlinePortal))
            select account.Id)
            .Distinct()
            .ToArrayAsync(cancellationToken);

        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                resource, resourceId, occurredAt);
    }
}
