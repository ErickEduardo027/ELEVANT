using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The airline's own management of its portal users (2-N20), from the portal. Every portal user of the airline
/// reads the list and what it may do; a representative (<see cref="AirlinePortalRoles"/>) invites users by email,
/// deactivates and reactivates them and marks signers, never itself nor another representative
/// (<c>portal_user_protected</c>). Each change is audited and queued as a notice to the other representatives in
/// the same transaction. Commands run serializable with an Idempotency-Key receipt
/// (<see cref="CommercialCommandReceipts"/>); the changes of an existing user also need its version.
/// </summary>
internal sealed class EfAirlinePortalUserStore(ElevantDbContext context, UserManager<ApplicationUser> userManager,
    AccountEmailOptions emailOptions, TimeProvider timeProvider) : IAirlinePortalUserStore
{
    private const string InviteAction = "airline_portal.user.invite";
    private const string StatusAction = "airline_portal.user.set_status";
    private const string SignerAction = "airline_portal.user.set_signer";
    private const string RepresentativeRequired = "representative_required";
    private const string ProtectedUser = "portal_user_protected";

    private sealed record Caller(long AccountId, Guid PublicId, long OrganizationId, string Name,
        AirlinePortalRoles.Holders Holders)
    {
        public bool Represents => Holders.Representatives.Contains(AccountId);
    }

    private readonly record struct Step(Guid ResultId, AirlinePortalUserFailure? Failure, string? Code)
    {
        public static Step Done(Guid id) => new(id, null, null);

        public static Step Fail(AirlinePortalUserFailure failure, string code) => new(Guid.Empty, failure, code);
    }

    public async Task<AirlinePortalUsersData?> ListAsync(Guid actorId, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(actorId, cancellationToken) is not { } caller) return null;
        var users = await UsersAsync(caller.OrganizationId, null, cancellationToken);
        return new AirlinePortalUsersData(new AirlinePortalCapabilitiesData(caller.PublicId, caller.Represents,
            caller.Holders.Signers.Contains(caller.AccountId), caller.Holders.CanSign(caller.AccountId),
            caller.Represents), users);
    }

    public async Task<AirlinePortalUserResult> InviteAsync(Guid actorId, InviteAirlinePortalUserInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(actorId, cancellationToken) is not { } caller)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, "forbidden");
        if (!caller.Represents)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, RepresentativeRequired);
        if (idempotencyKey == Guid.Empty)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, "idempotency_key_required");
        if (input is null || !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !GovernanceSupport.ValidEmail(input.Email))
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, "invalid_portal_user");
        // A representative always invites by email: the user activates its own account (ADR-0022).
        if (emailOptions.Link("/activar", "x") is null)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, GovernanceAccountIssues.InvitationsUnavailable);
        var firstName = input.FirstName!.Trim();
        var lastName = input.LastName!.Trim();
        var email = input.Email!.Trim();
        var hash = CommercialCommandReceipts.Hash(new { firstName, lastName, email = email.ToUpperInvariant(), input.Signer });
        return await RunAsync(idempotencyKey, caller.AccountId, InviteAction, hash, async now =>
        {
            var normalized = email.ToUpperInvariant();
            if (await context.Users.AnyAsync(user => user.NormalizedEmail == normalized, cancellationToken) ||
                await context.Persons.AnyAsync(person => person.PrimaryEmail == email, cancellationToken))
                return Step.Fail(AirlinePortalUserFailure.Conflict, GovernanceAccountIssues.EmailInUse);
            var created = await PortalAccounts.AddAsync(context, userManager, emailOptions, caller.OrganizationId,
                firstName, lastName, email, null, now, cancellationToken);
            if (created.Account is not { } account)
                return Step.Fail(created.Conflict ? AirlinePortalUserFailure.Conflict : AirlinePortalUserFailure.Invalid,
                    created.FailureCode!);
            if (input.Signer) await AirlinePortalRoles.GrantAsync(context, account.Id, AirlinePortalRoles.SignerGrant,
                cancellationToken);
            GovernanceSupport.AddAudit(context, caller.AccountId, "governance.client_user.invited", "iam.accounts",
                account.PublicId, null, [], now, new AuditFieldChangeData("organization", null, caller.OrganizationId.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)),
                new AuditFieldChangeData("portal.signer", null, input.Signer ? "true" : "false"));
            await context.SaveChangesAsync(cancellationToken);
            await AirlinePortalRoles.NotifyRepresentativesAsync(context, caller.OrganizationId,
                $"Se invitó a {firstName} {lastName} ({email}) como usuario del portal" +
                (input.Signer ? ", con permiso para firmar contratos y enviar el permiso de operación." : "."),
                caller.Name, caller.AccountId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return Step.Done(account.PublicId);
        }, caller.OrganizationId, cancellationToken);
    }

    public async Task<AirlinePortalUserResult> SetStatusAsync(Guid actorId, Guid userId,
        SetAirlinePortalUserStatusInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(actorId, cancellationToken) is not { } caller)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, "forbidden");
        if (!caller.Represents)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, RepresentativeRequired);
        if (idempotencyKey == Guid.Empty)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, "idempotency_key_required");
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, "expected_version_required");
        var hash = CommercialCommandReceipts.Hash(new { userId, input.IsActive, input.ExpectedVersion });
        return await RunAsync(idempotencyKey, caller.AccountId, StatusAction, hash, async now =>
        {
            if (await TargetAsync(caller, userId, cancellationToken) is not { } target)
                return Step.Fail(AirlinePortalUserFailure.NotFound, "not_found");
            if (await ProtectedAsync(caller, target.Id, cancellationToken))
                return Step.Fail(AirlinePortalUserFailure.Conflict, ProtectedUser);
            if (GovernanceSupport.Version(target.RowVersion) != input.ExpectedVersion)
                return Step.Fail(AirlinePortalUserFailure.Conflict, "version_conflict");
            var before = target.Status;
            var after = input.IsActive ? AccountLifecycleStatus.Active : AccountLifecycleStatus.Disabled;
            if (before == after) return Step.Done(target.PublicId);
            target.Status = after;
            // Its sessions end at once when it is deactivated.
            await userManager.UpdateSecurityStampAsync(target);
            GovernanceSupport.AddAudit(context, caller.AccountId, input.IsActive
                    ? "governance.client_user.reactivated" : "governance.client_user.deactivated", "iam.accounts",
                target.PublicId, null, [], now, new AuditFieldChangeData("user.status", before.ToString(), after.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            await AirlinePortalRoles.NotifyRepresentativesAsync(context, caller.OrganizationId,
                $"{(input.IsActive ? "Se reactivó" : "Se desactivó")} el acceso de " +
                $"{await PortalAccounts.NameAsync(context, target.Id, cancellationToken)} al portal.",
                caller.Name, caller.AccountId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return Step.Done(target.PublicId);
        }, caller.OrganizationId, cancellationToken);
    }

    public async Task<AirlinePortalUserResult> SetSignerAsync(Guid actorId, Guid userId,
        SetAirlinePortalUserSignerInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(actorId, cancellationToken) is not { } caller)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, "forbidden");
        if (!caller.Represents)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Forbidden, RepresentativeRequired);
        if (idempotencyKey == Guid.Empty)
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, "idempotency_key_required");
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Invalid, "expected_version_required");
        var hash = CommercialCommandReceipts.Hash(new { userId, input.Signer, input.ExpectedVersion });
        return await RunAsync(idempotencyKey, caller.AccountId, SignerAction, hash, async now =>
        {
            if (await TargetAsync(caller, userId, cancellationToken) is not { } target)
                return Step.Fail(AirlinePortalUserFailure.NotFound, "not_found");
            if (await ProtectedAsync(caller, target.Id, cancellationToken))
                return Step.Fail(AirlinePortalUserFailure.Conflict, ProtectedUser);
            if (GovernanceSupport.Version(target.RowVersion) != input.ExpectedVersion)
                return Step.Fail(AirlinePortalUserFailure.Conflict, "version_conflict");
            var flags = (await AirlinePortalRoles.FlagsAsync(context, caller.OrganizationId, [target.Id],
                cancellationToken))[target.Id];
            if (flags.Signer == input.Signer) return Step.Done(target.PublicId);
            if (input.Signer)
                await AirlinePortalRoles.GrantAsync(context, target.Id, AirlinePortalRoles.SignerGrant, cancellationToken);
            else
                await AirlinePortalRoles.RevokeAsync(context, target.Id, AirlinePortalRoles.SignerGrant, cancellationToken);
            // The account version moves with its role, so a screen that saw the old one re-reads.
            target.ConcurrencyStamp = Guid.NewGuid().ToString();
            target.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, caller.AccountId, "governance.client_user.portal_role_changed",
                "iam.accounts", target.PublicId, null, [], now,
                new AuditFieldChangeData("portal.signer", flags.Signer ? "true" : "false", input.Signer ? "true" : "false"));
            await context.SaveChangesAsync(cancellationToken);
            var name = await PortalAccounts.NameAsync(context, target.Id, cancellationToken);
            await AirlinePortalRoles.NotifyRepresentativesAsync(context, caller.OrganizationId, input.Signer
                    ? $"{name} ahora puede firmar contratos y enviar el permiso de operación."
                    : $"{name} ya no puede firmar contratos ni enviar el permiso de operación.",
                caller.Name, caller.AccountId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return Step.Done(target.PublicId);
        }, caller.OrganizationId, cancellationToken);
    }

    /// <summary>The caller as a portal user of exactly one active airline, with that airline's roles.</summary>
    private async Task<Caller?> CallerAsync(Guid actorId, CancellationToken cancellationToken)
    {
        if (await AirlinePortalTenant.AirlineIdAsync(context, actorId, cancellationToken) is not { } airline) return null;
        var organization = await AirlinePortalRoles.OrganizationOfAirlineAsync(context, airline, cancellationToken);
        var account = await (from user in context.Users.AsNoTracking()
                             join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                             where user.PublicId == actorId
                             select new { user.Id, person.FirstName, person.LastName }).SingleAsync(cancellationToken);
        var holders = await AirlinePortalRoles.OfAsync(context, organization, cancellationToken);
        return new Caller(account.Id, actorId, organization, $"{account.FirstName} {account.LastName}".Trim(), holders);
    }

    /// <summary>A portal account of the caller's airline (any status), tracked for the command.</summary>
    private Task<ApplicationUser?> TargetAsync(Caller caller, Guid userId, CancellationToken cancellationToken) =>
        (from user in context.Users
         where user.PublicId == userId && context.OrganizationMemberships.Any(membership =>
             membership.AccountId == user.Id && membership.OrganizationId == caller.OrganizationId &&
             membership.Kind == MembershipKind.AirlineClient)
         select user).SingleOrDefaultAsync(cancellationToken);

    /// <summary>A representative never changes itself nor another representative; AVIAM does (2-N20).</summary>
    private async Task<bool> ProtectedAsync(Caller caller, long targetId, CancellationToken cancellationToken) =>
        targetId == caller.AccountId ||
        (await AirlinePortalRoles.FlagsAsync(context, caller.OrganizationId, [targetId], cancellationToken))[targetId]
            .Representative;

    private async Task<IReadOnlyList<AirlinePortalUserData>> UsersAsync(long organizationId, Guid? only,
        CancellationToken cancellationToken)
    {
        var rows = await (from membership in context.OrganizationMemberships.AsNoTracking()
                          join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                          join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                          where membership.OrganizationId == organizationId && membership.Kind == MembershipKind.AirlineClient &&
                                (only == null || user.PublicId == only)
                          orderby person.LastName, person.FirstName
                          select new
                          {
                              user.Id, user.PublicId, person.FirstName, person.LastName, user.Email, user.Status,
                              Membership = membership.Status, user.InvitationStatus, user.LastLoginAt, user.RowVersion,
                          }).ToArrayAsync(cancellationToken);
        var distinct = rows.GroupBy(row => row.Id).Select(group => group.First()).ToArray();
        var flags = await AirlinePortalRoles.FlagsAsync(context, organizationId, distinct.Select(row => row.Id).ToArray(),
            cancellationToken);
        return distinct.Select(row => new AirlinePortalUserData(row.PublicId, row.FirstName, row.LastName,
            row.Email ?? string.Empty,
            row.Status == AccountLifecycleStatus.Active && row.Membership == MembershipStatus.Active
                ? nameof(AccountLifecycleStatus.Active) : nameof(AccountLifecycleStatus.Disabled),
            row.InvitationStatus == InvitationStatus.Sent, flags[row.Id].Representative, flags[row.Id].Signer,
            row.LastLoginAt, GovernanceSupport.Version(row.RowVersion))).ToArray();
    }

    /// <summary>
    /// One command: the Idempotency-Key receipt, the work, the receipt and the commit in one serializable transaction.
    /// A replay answers the user as it is now and never repeats the audit, the invitation or the notices.
    /// </summary>
    private async Task<AirlinePortalUserResult> RunAsync(Guid key, long accountId, string action, string hash,
        Func<DateTimeOffset, Task<Step>> work, long organizationId, CancellationToken cancellationToken)
    {
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            var (step, replayed) = await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return (Step.Fail(AirlinePortalUserFailure.Conflict, "idempotency_conflict"), false);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return (Step.Done(prior.ResultId), true);
                var now = timeProvider.GetUtcNow();
                var done = await work(now);
                if (done.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return (done, false);
                }
                CommercialCommandReceipts.Add(context, key, accountId, action, hash, done.ResultId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return (done, false);
            });
            context.ChangeTracker.Clear();
            if (step.Failure is { } failure) return AirlinePortalUserResult.Failed(failure, step.Code!);
            return await AnswerAsync(organizationId, step.ResultId, replayed, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await AnswerAsync(organizationId, concurrent.ResultId, true, cancellationToken)
                : AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException)
        {
            // A concurrent command took the email or changed the user first: the portal re-reads.
            context.ChangeTracker.Clear();
            return AirlinePortalUserResult.Failed(AirlinePortalUserFailure.Conflict, "version_conflict");
        }
    }

    private async Task<AirlinePortalUserResult> AnswerAsync(long organizationId, Guid userId, bool replayed,
        CancellationToken cancellationToken)
    {
        var users = await UsersAsync(organizationId, userId, cancellationToken);
        return users.Count == 1
            ? AirlinePortalUserResult.Success(users[0], replayed)
            : AirlinePortalUserResult.Failed(AirlinePortalUserFailure.NotFound, "not_found");
    }
}
