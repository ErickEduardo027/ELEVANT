using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Persistence.Commercial;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed partial class EfDepartmentGovernanceStore
{
    /// <summary>Who made a change of portal users, as the airline's representatives read it.</summary>
    private const string AviamActor = "Superadministración de AVIAM";

    public async Task<IReadOnlyList<ClientAirlineData>?> ListClientsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var airlines = await (from airline in context.Airlines.AsNoTracking()
                              join organization in context.Organizations.AsNoTracking()
                                  on airline.OrganizationId equals organization.Id
                              where organization.Status == OrganizationStatus.Active
                              orderby airline.Name
                              select new { organization.Id, organization.PublicId, airline.Name, airline.IataCode })
            .ToArrayAsync(cancellationToken);
        var organizationIds = airlines.Select(item => item.Id).ToArray();
        var users = await (from membership in context.OrganizationMemberships.AsNoTracking()
                           join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                           where organizationIds.Contains(membership.OrganizationId) &&
                               membership.Kind == MembershipKind.AirlineClient
                           select new { membership.OrganizationId, user.Status, Membership = membership.Status })
            .ToArrayAsync(cancellationToken);
        var byOrganization = users.ToLookup(item => item.OrganizationId);
        return airlines.Select(airline => new ClientAirlineData(airline.PublicId, airline.Name, airline.IataCode ?? string.Empty,
            byOrganization[airline.Id].Count(),
            byOrganization[airline.Id].Count(item => item.Status == AccountLifecycleStatus.Active &&
                item.Membership == MembershipStatus.Active))).ToArray();
    }

    public async Task<IReadOnlyList<ClientUserData>?> ListClientUsersAsync(Guid actorId, Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var organization = await AirlineOrganizationAsync(organizationId, cancellationToken);
        if (organization is null) return null;
        var rows = await (from membership in context.OrganizationMemberships.AsNoTracking()
                          join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                          join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                          where membership.OrganizationId == organization.Value && membership.Kind == MembershipKind.AirlineClient
                          orderby person.LastName, person.FirstName
                          select new
                          {
                              user.Id, user.PublicId, person.FirstName, person.LastName, Email = user.Email ?? string.Empty,
                              user.Status, user.MustChangePassword, user.LastLoginAt, user.RowVersion, user.InvitationStatus,
                          })
            .ToArrayAsync(cancellationToken);
        var flags = await AirlinePortalRoles.FlagsAsync(context, organization.Value, rows.Select(row => row.Id).ToArray(),
            cancellationToken);
        return rows.Select(row => new ClientUserData(row.PublicId, row.FirstName, row.LastName, row.Email,
            row.Status.ToString(), row.MustChangePassword, row.LastLoginAt, Convert.ToBase64String(row.RowVersion),
            row.InvitationStatus == InvitationStatus.Sent, flags[row.Id].Representative, flags[row.Id].Signer)).ToArray();
    }

    /// <summary>
    /// The super administrator adds portal users to an airline that already has its organization. The optional
    /// Idempotency-Key replays the account it created (2-N39); the airline's representatives hear of it (2-N20).
    /// </summary>
    public async Task<GovernanceResult> CreateClientUserAsync(Guid actorId, Guid organizationId,
        CreateClientUserInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var organization = await AirlineOrganizationAsync(organizationId, cancellationToken);
        if (organization is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
        if (idempotencyKey == Guid.Empty)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        if (input is null || !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !GovernanceSupport.ValidEmail(input.Email))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, GovernanceAccountIssues.InvalidClientUser);
        var invite = string.IsNullOrWhiteSpace(input.TemporaryPassword);
        var receipt = ReceiptOf(actor, idempotencyKey, "governance.client_user.create", new
        {
            organizationId, firstName = input.FirstName.Trim(), lastName = input.LastName.Trim(),
            email = input.Email.Trim().ToUpperInvariant(), invite,
        });
        if (await ReplayAsync(receipt, cancellationToken,
                id => PasswordMatchesAsync(id, invite ? null : input.TemporaryPassword, cancellationToken)) is { } replay)
            return replay;
        // An invitation needs the portal origin for its activation link.
        if (invite && emailOptions.Link("/activar", "x") is null)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, GovernanceAccountIssues.InvitationsUnavailable);
        if (await EmailInUseAsync(input.Email, null, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict, GovernanceAccountIssues.EmailInUse);

        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var created = await PortalAccounts.AddAsync(context, userManager, emailOptions, organization.Value,
                input.FirstName, input.LastName, input.Email, invite ? null : input.TemporaryPassword, now, cancellationToken);
            if (created.Account is not { } account)
                return GovernanceResult.Failed(created.Conflict ? GovernanceFailure.Conflict : GovernanceFailure.Invalid,
                    created.FailureCode);
            GovernanceSupport.AddAudit(context, actor.Id, "governance.client_user.created", "iam.accounts",
                account.PublicId, null, [], now, new AuditFieldChangeData("organization", null, organizationId.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            await AirlinePortalRoles.NotifyRepresentativesAsync(context, organization.Value,
                $"Se creó el acceso de {input.FirstName.Trim()} {input.LastName.Trim()} ({account.Email}) al portal.",
                AviamActor, null, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(account.PublicId);
        }, cancellationToken, receipt);
    }

    public async Task<GovernanceResult> SetClientUserStatusAsync(Guid actorId, Guid organizationId, Guid userId,
        SetDepartmentUserStatusInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var target = await ClientTargetAsync(actorId, organizationId, userId, cancellationToken);
        if (target.Failure is { } failure)
            return GovernanceResult.Failed(failure, failure == GovernanceFailure.NotFound ? "not_found" : null);
        if (idempotencyKey == Guid.Empty)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        var receipt = idempotencyKey is { } key
            ? new CommandReceipt(target.ActorId, key, "governance.client_user.set_status",
                CommercialCommandReceipts.Hash(new { organizationId, userId, input.IsActive, input.ExpectedVersion }))
            : null;
        if (await ReplayAsync(receipt, cancellationToken) is { } replay) return replay;
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var user = await context.Users.SingleAsync(item => item.Id == target.AccountId, cancellationToken);
            if (GovernanceSupport.Version(user.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            var before = user.Status;
            user.Status = input.IsActive ? AccountLifecycleStatus.Active : AccountLifecycleStatus.Disabled;
            await userManager.UpdateSecurityStampAsync(user);
            GovernanceSupport.AddAudit(context, target.ActorId, input.IsActive
                    ? "governance.client_user.reactivated" : "governance.client_user.deactivated",
                "iam.accounts", user.PublicId, null, [], now, new AuditFieldChangeData("user.status", before.ToString(), user.Status.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            if (before != user.Status)
                await AirlinePortalRoles.NotifyRepresentativesAsync(context, target.OrganizationId,
                    $"{(input.IsActive ? "Se reactivó" : "Se desactivó")} el acceso de {await PortalUserNameAsync(user.Id, cancellationToken)}.",
                    AviamActor, null, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        }, cancellationToken, receipt);
    }

    /// <summary>
    /// The super administrator designates representatives and signers (2-N20). Taking the role from the last active
    /// representative is refused (<c>last_representative</c>): somebody must keep managing the airline's users.
    /// </summary>
    public async Task<GovernanceResult> SetClientUserPortalRoleAsync(Guid actorId, Guid organizationId, Guid userId,
        SetClientUserPortalRoleInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        var target = await ClientTargetAsync(actorId, organizationId, userId, cancellationToken);
        if (target.Failure is { } failure)
            return GovernanceResult.Failed(failure, failure == GovernanceFailure.NotFound ? "not_found" : null);
        if (idempotencyKey == Guid.Empty)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        var receipt = new CommandReceipt(target.ActorId, idempotencyKey, "governance.client_user.portal_role",
            CommercialCommandReceipts.Hash(new { organizationId, userId, input.Representative, input.Signer, input.ExpectedVersion }));
        if (await ReplayAsync(receipt, cancellationToken) is { } replay) return replay;
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var user = await context.Users.SingleAsync(item => item.Id == target.AccountId, cancellationToken);
            if (GovernanceSupport.Version(user.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            var flags = (await AirlinePortalRoles.FlagsAsync(context, target.OrganizationId, [user.Id], cancellationToken))[user.Id];
            var holders = await AirlinePortalRoles.OfAsync(context, target.OrganizationId, cancellationToken);
            var changes = new List<AuditFieldChangeData>();
            var name = await PortalUserNameAsync(user.Id, cancellationToken);
            var notices = new List<string>();
            if (input.Representative != flags.Representative)
            {
                if (input.Representative)
                {
                    await AirlinePortalRoles.GrantRepresentativeAsync(context, target.OrganizationId, user.Id, cancellationToken);
                    notices.Add($"{name} ahora es representante de la aerolínea en el portal.");
                }
                else
                {
                    if (holders.Representatives.Contains(user.Id) &&
                        holders.Representatives.All(account => account == user.Id))
                        return GovernanceResult.Failed(GovernanceFailure.Conflict, "last_representative");
                    await AirlinePortalRoles.RecordImplicitRepresentativesAsync(context, holders, cancellationToken);
                    await context.SaveChangesAsync(cancellationToken);
                    await AirlinePortalRoles.RevokeAsync(context, user.Id, AirlinePortalRoles.RepresentativeGrant, cancellationToken);
                    notices.Add($"{name} dejó de ser representante de la aerolínea en el portal.");
                }
                changes.Add(new AuditFieldChangeData("portal.representative", Flag(flags.Representative), Flag(input.Representative)));
            }
            if (input.Signer != flags.Signer)
            {
                if (input.Signer) await AirlinePortalRoles.GrantAsync(context, user.Id, AirlinePortalRoles.SignerGrant, cancellationToken);
                else await AirlinePortalRoles.RevokeAsync(context, user.Id, AirlinePortalRoles.SignerGrant, cancellationToken);
                notices.Add(input.Signer
                    ? $"{name} ahora puede firmar contratos y enviar el permiso de operación."
                    : $"{name} ya no puede firmar contratos ni enviar el permiso de operación.");
                changes.Add(new AuditFieldChangeData("portal.signer", Flag(flags.Signer), Flag(input.Signer)));
            }
            if (changes.Count == 0) return GovernanceResult.Success(user.PublicId);
            // The account version moves with its roles, so a screen that saw the old ones re-reads.
            user.ConcurrencyStamp = Guid.NewGuid().ToString();
            user.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, target.ActorId, "governance.client_user.portal_role_changed", "iam.accounts",
                user.PublicId, null, [], now, [.. changes]);
            await context.SaveChangesAsync(cancellationToken);
            await AirlinePortalRoles.NotifyRepresentativesAsync(context, target.OrganizationId, string.Join(' ', notices),
                AviamActor, null, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(user.PublicId);
        }, cancellationToken, receipt);
    }

    private static string Flag(bool value) => value ? "true" : "false";

    /// <summary>«Ana Rivera (ana@aerolinea.test)», as the representatives read it in a notice.</summary>
    private Task<string> PortalUserNameAsync(long accountId, CancellationToken cancellationToken) =>
        PortalAccounts.NameAsync(context, accountId, cancellationToken);

    private const string ClientPasswordResetAction = "governance.client_user.password_reset";

    public async Task<GovernanceResult> ResetClientUserPasswordAsync(Guid actorId, Guid organizationId, Guid userId,
        ResetClientUserPasswordInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var target = await ClientTargetAsync(actorId, organizationId, userId, cancellationToken);
        if (target.Failure is { } failure)
            return GovernanceResult.Failed(failure, failure == GovernanceFailure.NotFound ? "not_found" : null);
        if (input is null || string.IsNullOrWhiteSpace(input.TemporaryPassword))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, GovernanceAccountIssues.PasswordPolicy);
        // Expand phase: older clients send neither; a client that sends the key must send the version.
        if (idempotencyKey is { } key)
        {
            if (key == Guid.Empty) return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
            if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        }
        // The receipt never stores the temporary password: a replay compares it with the account instead.
        var hash = CommercialCommandReceipts.Hash(new { organizationId, userId, input.ExpectedVersion });
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (idempotencyKey is { } receiptKey)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, receiptKey, target.ActorId,
                        ClientPasswordResetAction, hash, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await ReplayPasswordAsync(prior.ResultId, input.TemporaryPassword, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return GovernanceResult.Failed(GovernanceFailure.Conflict, "idempotency_conflict");
                }
                var now = timeProvider.GetUtcNow();
                var user = await context.Users.SingleAsync(item => item.Id == target.AccountId, cancellationToken);
                if (input.ExpectedVersion is { } expected && GovernanceSupport.Version(user.RowVersion) != expected)
                    return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
                var invitation = user.InvitationStatus;
                // The policy is checked before anything changes; the password is set without a reset token,
                // so it also works for an invited account that never had one.
                foreach (var validator in userManager.PasswordValidators)
                    if (!(await validator.ValidateAsync(userManager, user, input.TemporaryPassword)).Succeeded)
                        return GovernanceResult.Failed(GovernanceFailure.Invalid, GovernanceAccountIssues.PasswordPolicy);
                user.PasswordHash = userManager.PasswordHasher.HashPassword(user, input.TemporaryPassword);
                user.MustChangePassword = true;
                if (invitation != InvitationStatus.Accepted)
                {
                    // 1-N12: the temporary password replaces the pending invitation. It is accepted with
                    // the email the superadministrator confirmed, its links stop working and its queued
                    // email is discarded; the first sign-in still requires a new password.
                    user.InvitationStatus = InvitationStatus.Accepted;
                    user.EmailConfirmed = true;
                    await EfAccountEmailStore.RetireActivationAsync(context, user, EmailDeliveryReasons.InvitationClosed,
                        now, cancellationToken);
                }
                await userManager.UpdateSecurityStampAsync(user);
                GovernanceSupport.AddAudit(context, target.ActorId, "governance.client_user.password_reset", "iam.accounts",
                    user.PublicId, null, [], now,
                    new AuditFieldChangeData("user.invitation", invitation.ToString(), user.InvitationStatus.ToString()));
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, target.ActorId, ClientPasswordResetAction, hash,
                        user.PublicId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return GovernanceResult.Success(user.PublicId);
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } duplicateKey &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent reset with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, duplicateKey, target.ActorId,
                ClientPasswordResetAction, hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await ReplayPasswordAsync(concurrent.ResultId, input.TemporaryPassword, cancellationToken)
                : GovernanceResult.Failed(GovernanceFailure.Conflict, "idempotency_conflict");
        }
    }

    /// <summary>A replayed reset must carry the temporary password the account now has.</summary>
    private async Task<GovernanceResult> ReplayPasswordAsync(Guid accountId, string password,
        CancellationToken cancellationToken)
    {
        var account = await context.Users.SingleOrDefaultAsync(item => item.PublicId == accountId, cancellationToken);
        return account is not null && await userManager.CheckPasswordAsync(account, password)
            ? GovernanceResult.Success(accountId)
            : GovernanceResult.Failed(GovernanceFailure.Conflict, "idempotency_conflict");
    }

    private sealed record ClientTarget(long ActorId, long AccountId, long OrganizationId, GovernanceFailure? Failure);

    private async Task<ClientTarget> ClientTargetAsync(Guid actorId, Guid organizationId, Guid userId,
        CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return new(0, 0, 0, GovernanceFailure.Forbidden);
        var organization = await AirlineOrganizationAsync(organizationId, cancellationToken);
        if (organization is null) return new(actor.Id, 0, 0, GovernanceFailure.NotFound);
        var accountId = await (from membership in context.OrganizationMemberships.AsNoTracking()
                               join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                               where user.PublicId == userId && membership.OrganizationId == organization.Value &&
                                   membership.Kind == MembershipKind.AirlineClient
                               select (long?)user.Id).FirstOrDefaultAsync(cancellationToken);
        return accountId is null
            ? new(actor.Id, 0, organization.Value, GovernanceFailure.NotFound)
            : new(actor.Id, accountId.Value, organization.Value, null);
    }

    private Task<long?> AirlineOrganizationAsync(Guid organizationId, CancellationToken cancellationToken) =>
        (from organization in context.Organizations.AsNoTracking()
         where organization.PublicId == organizationId && organization.Status == OrganizationStatus.Active &&
             context.Airlines.Any(airline => airline.OrganizationId == organization.Id)
         select (long?)organization.Id).SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<LegacyRoleData>?> ListLegacyRolesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var roles = await context.Roles.AsNoTracking()
            .Where(role => role.IsCustom && role.IsActive && role.NormalizedName!.StartsWith("CUSTOM_"))
            .OrderBy(role => role.Name).ToArrayAsync(cancellationToken);
        var roleIds = roles.Select(role => role.Id).ToArray();
        var permissions = (await (from grant in context.Set<RolePermissionGrant>().AsNoTracking()
                                  join permission in context.Permissions.AsNoTracking() on grant.PermissionId equals permission.Id
                                  where roleIds.Contains(grant.RoleId)
                                  select new { grant.RoleId, permission.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RoleId, item => item.Code);
        var users = await (from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
                           join user in context.Users.AsNoTracking() on link.UserId equals user.Id
                           where roleIds.Contains(link.RoleId) && user.Status == AccountLifecycleStatus.Active
                           group link by link.RoleId into grouped
                           select new { grouped.Key, Count = grouped.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        return roles.Select(role => new LegacyRoleData(role.PublicId, role.NormalizedName!, role.Name ?? role.NormalizedName!,
            DepartmentAccessResolver.MapLegacyCommercial(permissions[role.Id]).Order(StringComparer.Ordinal).ToArray(),
            users.GetValueOrDefault(role.Id), role.ConcurrencyStamp)).ToArray();
    }

    /// <summary>
    /// Turns a legacy CUSTOM_* role into a Contracts template: its holders become Contracts members that follow
    /// the template and the legacy role is retired. A holder an administrator already edited keeps the permissions
    /// chosen for it (2-N19). With an Idempotency-Key the role version is required and a retry replays (2-N39).
    /// </summary>
    public async Task<GovernanceResult> ConvertLegacyRoleAsync(Guid actorId, Guid roleId, ConvertLegacyRoleInput? input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        var expected = string.IsNullOrWhiteSpace(input?.ExpectedVersion) ? null : input.ExpectedVersion;
        if (idempotencyKey is not null && expected is null)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        var receipt = ReceiptOf(actor, idempotencyKey, "governance.legacy_role.convert", new { roleId, expected });
        if (await ReplayAsync(receipt, cancellationToken) is { } replay) return replay;
        return await InSerializableTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var role = await context.Roles.SingleOrDefaultAsync(item => item.PublicId == roleId, cancellationToken);
            if (role is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
            if (!role.IsCustom || !role.IsActive || role.NormalizedName?.StartsWith("CUSTOM_", StringComparison.Ordinal) != true)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "legacy_role_converted");
            if (expected is not null && role.ConcurrencyStamp != expected)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            var codes = DepartmentAccessResolver.MapLegacyCommercial(await (
                    from grant in context.Set<RolePermissionGrant>()
                    join permission in context.Permissions on grant.PermissionId equals permission.Id
                    where grant.RoleId == role.Id
                    select permission.Code).ToArrayAsync(cancellationToken))
                .Distinct().Order(StringComparer.Ordinal).ToArray();
            if (codes.Length == 0) return GovernanceResult.Failed(GovernanceFailure.Conflict, "legacy_role_empty");
            var contractsRole = await context.Roles.SingleOrDefaultAsync(item =>
                item.NormalizedName == DepartmentAccessResolver.RoleCodeOf(Department.Contracts) && item.IsActive,
                cancellationToken);
            if (contractsRole is null) return GovernanceResult.Failed(GovernanceFailure.Conflict, "role_missing");
            var name = (role.Name ?? role.NormalizedName!).Trim();
            if (name.Length > 80) name = name[..80];
            if (await context.AccessProfiles.AnyAsync(item => item.Department == Department.Contracts && item.IsActive &&
                    item.Name == name, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "profile_name_in_use");

            var profile = new AccessProfile
            {
                PublicId = Guid.CreateVersion7(), Department = Department.Contracts, Name = name,
                Description = role.Description, IsActive = true, CreatedByAccountId = actor.Id,
                CreatedAt = now, UpdatedAt = now,
            };
            context.AccessProfiles.Add(profile);
            await context.SaveChangesAsync(cancellationToken);
            foreach (var code in codes)
                context.AccessProfileGrants.Add(new AccessProfileGrant { AccessProfileId = profile.Id, PermissionCode = code });

            var links = await context.Set<IdentityUserRole<long>>().Where(link => link.RoleId == role.Id)
                .ToArrayAsync(cancellationToken);
            var holders = links.Select(link => link.UserId).ToArray();
            var explicitGrants = (await context.AccountPermissionGrants.AsNoTracking()
                    .Where(grant => holders.Contains(grant.AccountId)).Select(grant => grant.AccountId)
                    .ToArrayAsync(cancellationToken)).ToHashSet();
            var kept = 0;
            foreach (var link in links)
            {
                context.Set<IdentityUserRole<long>>().Remove(link);
                if (!await context.Set<IdentityUserRole<long>>().AnyAsync(item =>
                        item.UserId == link.UserId && item.RoleId == contractsRole.Id, cancellationToken))
                    context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
                    { UserId = link.UserId, RoleId = contractsRole.Id });
                var assignment = await context.DepartmentAssignments.SingleOrDefaultAsync(item =>
                    item.AccountId == link.UserId, cancellationToken);
                if (assignment is null)
                    context.DepartmentAssignments.Add(new DepartmentAssignment
                    {
                        PublicId = Guid.CreateVersion7(), AccountId = link.UserId, Kind = DepartmentAssignmentKind.Member,
                        Department = Department.Contracts, AccessProfileId = profile.Id, CreatedAt = now, UpdatedAt = now,
                    });
                else if (assignment.Kind == DepartmentAssignmentKind.Member && assignment.Department == Department.Contracts)
                {
                    // 2-N19: permissions an administrator chose for this member win over the role's template.
                    if (assignment.AccessProfileId is null && explicitGrants.Contains(link.UserId))
                    {
                        kept++;
                        continue;
                    }
                    assignment.AccessProfileId = profile.Id;
                    assignment.UpdatedAt = now;
                }
            }
            role.IsActive = false;
            await context.SaveChangesAsync(cancellationToken);
            foreach (var user in await context.Users.Where(user => holders.Contains(user.Id)).ToArrayAsync(cancellationToken))
                await userManager.UpdateSecurityStampAsync(user);
            GovernanceSupport.AddAudit(context, actor.Id, "governance.legacy_role.converted", "iam.access_profiles",
                profile.PublicId, null, [], now, new AuditFieldChangeData("role", role.NormalizedName, null),
                new AuditFieldChangeData("profile.permissions", null, string.Join(',', codes)),
                new AuditFieldChangeData("profile.members", null,
                    (links.Length - kept).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new AuditFieldChangeData("members.kept_permissions", null,
                    kept.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            await NotifyDepartmentAsync(Department.Contracts, "department_users", profile.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(profile.PublicId);
        }, cancellationToken, receipt);
    }
}
