using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Who speaks for an airline in its portal (2-N20). The representative is the account provisioned for the airline's
/// approved request, or whoever the super administrator designates; representatives invite, deactivate and reactivate
/// the other users and mark signers. Only representatives and signers sign contracts and submit the JAC permit
/// (<see cref="SignerRequiredCode"/>). Both capabilities live in <c>iam.account_permission_grants</c>, outside the
/// department catalog, which never lets them into a department's access. An airline whose representatives were never
/// recorded (it predates this rule) is represented by its active provisioned accounts until the first designation.
/// </summary>
internal static class AirlinePortalRoles
{
    public const string RepresentativeGrant = "airline_portal.representative";
    public const string SignerGrant = "airline_portal.signer";

    /// <summary>Problem Details code: only a representative or a signer of the airline may do this.</summary>
    public const string SignerRequiredCode = "signer_required";

    /// <summary>The roles of an organization's active portal accounts. <paramref name="Implicit"/>: no designation yet.</summary>
    public sealed record Holders(IReadOnlySet<long> Representatives, IReadOnlySet<long> Signers, bool Implicit)
    {
        public bool CanSign(long accountId) => Representatives.Contains(accountId) || Signers.Contains(accountId);
    }

    /// <summary>Active portal accounts of the organization: active account and membership, with the AIRLINE_CLIENT role.</summary>
    public static Task<long[]> ActiveMembersAsync(ElevantDbContext context, long organizationId,
        CancellationToken cancellationToken) =>
        (from membership in context.OrganizationMemberships.AsNoTracking()
         join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
         where membership.OrganizationId == organizationId && membership.Kind == MembershipKind.AirlineClient &&
               membership.Status == MembershipStatus.Active && user.Status == AccountLifecycleStatus.Active &&
               context.UserRoles.Any(link => link.UserId == user.Id && context.Roles.Any(role =>
                   role.Id == link.RoleId && role.NormalizedName == "AIRLINE_CLIENT" && role.IsActive))
         select user.Id).Distinct().ToArrayAsync(cancellationToken);

    /// <summary>
    /// Representatives and signers among the organization's active portal accounts, as stored now. Once any account
    /// of the airline was designated (active or not), only designations count: an airline whose representatives were
    /// all deactivated waits for AVIAM to designate another one instead of falling back to its provisioned accounts,
    /// which AVIAM may have taken the role from.
    /// </summary>
    public static async Task<Holders> OfAsync(ElevantDbContext context, long organizationId,
        CancellationToken cancellationToken)
    {
        var members = (await ActiveMembersAsync(context, organizationId, cancellationToken)).ToHashSet();
        var grants = await GrantsAsync(context, await AllMembersAsync(context, organizationId, cancellationToken),
            cancellationToken);
        var designated = grants.Any(grant => grant.Code == RepresentativeGrant);
        var representatives = grants.Where(grant => grant.Code == RepresentativeGrant && members.Contains(grant.AccountId))
            .Select(grant => grant.AccountId).ToHashSet();
        var signers = grants.Where(grant => grant.Code == SignerGrant && members.Contains(grant.AccountId))
            .Select(grant => grant.AccountId).ToHashSet();
        if (designated) return new Holders(representatives, signers, false);
        var provisioned = await ProvisionedAccountsAsync(context, organizationId, cancellationToken);
        return new Holders(members.Where(provisioned.Contains).ToHashSet(), signers, true);
    }

    /// <summary>Every portal account of the organization, whatever its status: designations survive a deactivation.</summary>
    private static Task<long[]> AllMembersAsync(ElevantDbContext context, long organizationId,
        CancellationToken cancellationToken) =>
        context.OrganizationMemberships.AsNoTracking()
            .Where(membership => membership.OrganizationId == organizationId && membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.AccountId).Distinct().ToArrayAsync(cancellationToken);

    /// <summary>
    /// The flags to show for every portal account of the organization, active or not: its own grants, and the
    /// provisioned accounts while the airline has no designated representative.
    /// </summary>
    public static async Task<IReadOnlyDictionary<long, (bool Representative, bool Signer)>> FlagsAsync(
        ElevantDbContext context, long organizationId, IReadOnlyCollection<long> accounts,
        CancellationToken cancellationToken)
    {
        var holders = await OfAsync(context, organizationId, cancellationToken);
        var grants = await GrantsAsync(context, accounts, cancellationToken);
        var provisioned = holders.Implicit ? await ProvisionedAccountsAsync(context, organizationId, cancellationToken) : [];
        return accounts.Distinct().ToDictionary(account => account, account => (
            grants.Any(grant => grant.AccountId == account && grant.Code == RepresentativeGrant) || provisioned.Contains(account),
            grants.Any(grant => grant.AccountId == account && grant.Code == SignerGrant)));
    }

    /// <summary>The organization of the airline the portal account belongs to, for <see cref="OfAsync"/>.</summary>
    public static Task<long> OrganizationOfAirlineAsync(ElevantDbContext context, long airlineId,
        CancellationToken cancellationToken) =>
        context.Airlines.AsNoTracking().Where(airline => airline.Id == airlineId).Select(airline => airline.OrganizationId)
            .SingleAsync(cancellationToken);

    /// <summary>
    /// Makes <paramref name="accountId"/> a representative. While the airline is represented implicitly by its
    /// provisioned accounts, they are recorded first, so a designation never takes the role from anybody.
    /// </summary>
    public static async Task GrantRepresentativeAsync(ElevantDbContext context, long organizationId, long accountId,
        CancellationToken cancellationToken)
    {
        var holders = await OfAsync(context, organizationId, cancellationToken);
        var accounts = holders.Implicit ? holders.Representatives.Append(accountId).Distinct() : [accountId];
        foreach (var account in accounts) await GrantAsync(context, account, RepresentativeGrant, cancellationToken);
    }

    /// <summary>Records the implicit representatives, so taking the role from one of them keeps the others.</summary>
    public static async Task RecordImplicitRepresentativesAsync(ElevantDbContext context, Holders holders,
        CancellationToken cancellationToken)
    {
        if (!holders.Implicit) return;
        foreach (var account in holders.Representatives) await GrantAsync(context, account, RepresentativeGrant, cancellationToken);
    }

    public static async Task GrantAsync(ElevantDbContext context, long accountId, string code,
        CancellationToken cancellationToken)
    {
        if (context.AccountPermissionGrants.Local.Any(grant => grant.AccountId == accountId && grant.PermissionCode == code) ||
            await context.AccountPermissionGrants.AnyAsync(grant => grant.AccountId == accountId && grant.PermissionCode == code,
                cancellationToken))
            return;
        context.AccountPermissionGrants.Add(new AccountPermissionGrant { AccountId = accountId, PermissionCode = code });
    }

    /// <summary>The grant row is configuration; the audit entry of the command keeps the history of the change.</summary>
    public static async Task RevokeAsync(ElevantDbContext context, long accountId, string code,
        CancellationToken cancellationToken)
    {
        var grant = await context.AccountPermissionGrants.SingleOrDefaultAsync(item =>
            item.AccountId == accountId && item.PermissionCode == code, cancellationToken);
        if (grant is not null) context.AccountPermissionGrants.Remove(grant);
    }

    /// <summary>
    /// Queues <see cref="AccountEmailTemplates.PortalUserChanged"/> to every active representative of the airline but
    /// <paramref name="exceptAccountId"/> (who made the change), in the caller's unit of work: a replay never repeats
    /// it, and the outbox sends it (no screen says it went out). Call it after the change is saved.
    /// </summary>
    public static async Task<int> NotifyRepresentativesAsync(ElevantDbContext context, long organizationId,
        string change, string actor, long? exceptAccountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var holders = await OfAsync(context, organizationId, cancellationToken);
        var recipients = holders.Representatives.Where(account => account != exceptAccountId).ToArray();
        if (recipients.Length == 0) return 0;
        var airline = await context.Airlines.AsNoTracking().Where(item => item.OrganizationId == organizationId)
            .Select(item => item.Name).FirstAsync(cancellationToken);
        var emails = await context.Users.AsNoTracking().Where(user => recipients.Contains(user.Id) && user.Email != null)
            .Select(user => user.Email!).ToArrayAsync(cancellationToken);
        var distinct = emails.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        foreach (var email in distinct)
            EfEmailOutboxStore.Add(context, AccountEmailTemplates.PortalUserChanged(email, airline, change, actor),
                EmailPurpose.PortalUserChanged, now);
        return distinct.Length;
    }

    private sealed record Grant(long AccountId, string Code);

    private static async Task<Grant[]> GrantsAsync(ElevantDbContext context, IReadOnlyCollection<long> accounts,
        CancellationToken cancellationToken)
    {
        if (accounts.Count == 0) return [];
        var ids = accounts.Distinct().ToArray();
        return await context.AccountPermissionGrants.AsNoTracking()
            .Where(grant => ids.Contains(grant.AccountId) &&
                (grant.PermissionCode == RepresentativeGrant || grant.PermissionCode == SignerGrant))
            .Select(grant => new Grant(grant.AccountId, grant.PermissionCode)).ToArrayAsync(cancellationToken);
    }

    private static async Task<HashSet<long>> ProvisionedAccountsAsync(ElevantDbContext context, long organizationId,
        CancellationToken cancellationToken) =>
        (await (from request in context.ServiceRequests.AsNoTracking()
                join airline in context.Airlines.AsNoTracking() on request.AirlineId equals airline.Id
                where airline.OrganizationId == organizationId && request.ProvisionedAccountId != null
                select request.ProvisionedAccountId!.Value).ToArrayAsync(cancellationToken)).ToHashSet();
}
