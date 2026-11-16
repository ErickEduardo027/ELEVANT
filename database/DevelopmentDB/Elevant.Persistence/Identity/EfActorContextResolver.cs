using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Builds an actor exclusively from current, server-owned identity data.</summary>
internal sealed class EfActorContextResolver(
    ElevantDbContext context,
    TimeProvider timeProvider) : IActorContextResolver
{
    public async Task<ActorContext?> ResolveAsync(
        Guid accountId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
        {
            return null;
        }

        var now = timeProvider.GetUtcNow();
        var account = await context.Users
            .AsNoTracking()
            .Where(item =>
                item.PublicId == accountId &&
                item.Status == AccountLifecycleStatus.Active &&
                item.InvitationStatus == InvitationStatus.Accepted &&
                item.EmailConfirmed &&
                item.LockoutEnabled &&
                !item.TwoFactorEnabled &&
                item.SecurityStamp != null &&
                item.SecurityStamp != string.Empty &&
                (item.LockoutEnd == null || item.LockoutEnd <= now))
            .Select(item => new
            {
                item.Id,
                item.PublicId,
                item.Email,
                item.PersonId,
            })
            .SingleOrDefaultAsync(cancellationToken);

        if (account is null ||
            account.PublicId == Guid.Empty ||
            string.IsNullOrWhiteSpace(account.Email))
        {
            return null;
        }

        var person = await context.Persons
            .AsNoTracking()
            .Where(item => item.Id == account.PersonId)
            .Select(item => new { item.FirstName, item.LastName })
            .SingleOrDefaultAsync(cancellationToken);

        if (person is null)
        {
            return null;
        }

        var displayName = string.Join(
            ' ',
            new[] { person.FirstName, person.LastName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part.Trim()));

        if (string.IsNullOrWhiteSpace(displayName))
        {
            return null;
        }

        var roles = await (
                from assignment in context.Set<IdentityUserRole<long>>().AsNoTracking()
                join role in context.Roles.AsNoTracking() on assignment.RoleId equals role.Id
                where assignment.UserId == account.Id &&
                      role.IsActive &&
                      role.PublicId != Guid.Empty &&
                      role.NormalizedName != null &&
                      role.Name != null
                orderby role.NormalizedName
                select new ActorRole(
                    role.PublicId,
                    role.NormalizedName!,
                    role.Name!,
                    role.Portal,
                    role.UserType))
            .ToArrayAsync(cancellationToken);

        var today = DateOnly.FromDateTime(now.UtcDateTime);

        var memberships = await (
                from membership in context.OrganizationMemberships.AsNoTracking()
                join organization in context.Organizations.AsNoTracking()
                    on membership.OrganizationId equals organization.Id
                where membership.AccountId == account.Id &&
                      membership.Status == MembershipStatus.Active &&
                      organization.Status == OrganizationStatus.Active &&
                      (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                      (membership.ValidTo == null || membership.ValidTo >= today)
                orderby organization.Code
                select new ActorMembership(
                    membership.PublicId,
                    organization.PublicId,
                    organization.Code,
                    organization.DisplayName,
                    organization.Type,
                    membership.Kind))
            .ToArrayAsync(cancellationToken);

        var stationScopes = await (
                from scope in context.AccountStationScopes.AsNoTracking()
                join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
                where scope.AccountId == account.Id &&
                      scope.GrantedAt <= now &&
                      scope.RevokedAt == null &&
                      station.IsActive
                orderby station.Code
                select new ActorStationScope(station.PublicId, station.Code))
            .ToArrayAsync(cancellationToken);

        var access = await DepartmentAccessQueries.ReadAsync(context, account.Id, cancellationToken);

        return new ActorContext(
            account.PublicId,
            account.Email,
            displayName,
            roles,
            memberships,
            stationScopes,
            access);
    }
}
