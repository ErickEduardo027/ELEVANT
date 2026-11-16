using Elevant.Application.Commercial;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// A new portal account of an airline, the same for the super administrator (Clientes) and the airline's
/// representative (2-N20): person, account, AIRLINE_CLIENT role and an active membership. Without a temporary
/// password the user is invited by email (ADR-0022) and the activation email is queued in the caller's unit of work.
/// </summary>
internal static class PortalAccounts
{
    internal sealed record Created(ApplicationUser? Account, string? FailureCode, bool Conflict);

    public static async Task<Created> AddAsync(ElevantDbContext context, UserManager<ApplicationUser> userManager,
        AccountEmailOptions emailOptions, long organizationId, string firstName, string lastName, string email,
        string? temporaryPassword, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var role = await context.Roles.SingleOrDefaultAsync(item =>
            item.NormalizedName == "AIRLINE_CLIENT" && item.IsActive, cancellationToken);
        if (role is null) return new(null, "role_missing", true);
        var invite = temporaryPassword is null;
        var address = email.Trim();
        var person = new Person
        {
            PublicId = Guid.CreateVersion7(),
            FirstName = firstName.Trim(),
            LastName = lastName.Trim(),
            PrimaryEmail = address,
            IdentificationType = "GOVERNANCE_ACCOUNT",
            IdentificationNumber = Guid.CreateVersion7().ToString("N"),
        };
        context.Persons.Add(person);
        await context.SaveChangesAsync(cancellationToken);
        var account = new ApplicationUser
        {
            PublicId = Guid.CreateVersion7(),
            PersonId = person.Id,
            UserName = address,
            Email = address,
            EmailConfirmed = !invite,
            LockoutEnabled = true,
            Status = AccountLifecycleStatus.Active,
            InvitationStatus = invite ? InvitationStatus.Sent : InvitationStatus.Accepted,
            MustChangePassword = !invite,
        };
        var created = invite ? await userManager.CreateAsync(account)
            : await userManager.CreateAsync(account, temporaryPassword!);
        if (!created.Succeeded)
            return created.Errors.Any(error => error.Code is "DuplicateUserName" or "DuplicateEmail")
                ? new(null, GovernanceAccountIssues.EmailInUse, true)
                : new(null, GovernanceAccountIssues.PasswordPolicy, false);
        context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long> { UserId = account.Id, RoleId = role.Id });
        context.OrganizationMemberships.Add(new OrganizationMembership
        {
            PublicId = Guid.CreateVersion7(),
            AccountId = account.Id,
            OrganizationId = organizationId,
            Kind = MembershipKind.AirlineClient,
            Status = MembershipStatus.Active,
        });
        if (invite)
        {
            var airline = await context.Organizations.Where(item => item.Id == organizationId)
                .Select(item => item.DisplayName).SingleAsync(cancellationToken);
            if (!EfAccountEmailStore.AddActivation(context, emailOptions, account, person.FirstName, airline, now))
                return new(null, GovernanceAccountIssues.InvitationsUnavailable, false);
        }
        return new(account, null, false);
    }

    /// <summary>«Ana Rivera (ana@aerolinea.test)», as the airline's representatives read it in a notice.</summary>
    public static async Task<string> NameAsync(ElevantDbContext context, long accountId, CancellationToken cancellationToken)
    {
        var row = await (from user in context.Users.AsNoTracking()
                         join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                         where user.Id == accountId
                         select new { person.FirstName, person.LastName, user.Email }).SingleAsync(cancellationToken);
        return $"{row.FirstName} {row.LastName} ({row.Email})".Trim();
    }
}
