using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Airline of a portal account read from live identity rows: an active account with the
/// AIRLINE_CLIENT role and exactly one active membership in an active airline customer.
/// </summary>
internal static class AirlinePortalTenant
{
    public static async Task<long?> AirlineIdAsync(ElevantDbContext context, Guid accountId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return null;
        var airlines = await (from user in context.Users.AsNoTracking()
                              join membership in context.OrganizationMemberships.AsNoTracking() on user.Id equals membership.AccountId
                              join organization in context.Organizations.AsNoTracking() on membership.OrganizationId equals organization.Id
                              join airline in context.Airlines.AsNoTracking() on organization.Id equals airline.OrganizationId
                              where user.PublicId == accountId && user.Status == AccountLifecycleStatus.Active &&
                                    membership.Kind == MembershipKind.AirlineClient && membership.Status == MembershipStatus.Active &&
                                    organization.Status == OrganizationStatus.Active && airline.IsActive &&
                                    context.UserRoles.Any(link => link.UserId == user.Id && context.Roles.Any(role =>
                                        role.Id == link.RoleId && role.NormalizedName == "AIRLINE_CLIENT" && role.IsActive))
                              select airline.Id).Distinct().Take(2).ToArrayAsync(cancellationToken);
        return airlines.Length == 1 ? airlines[0] : null;
    }
}
