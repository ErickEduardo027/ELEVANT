using System.Data;
using System.Net.Mail;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Portal accounts of the approved requests (ADR-0022, 1-N13). The superadministrator creates the
/// account (invitation by email by default, or a temporary password) or links the existing portal
/// account of the email. Every command runs serializable with an idempotency receipt
/// (<see cref="CommercialCommandReceipts"/>) and the version the superadministrator saw.
/// </summary>
internal sealed class EfCommercialProvisioningStore(
    ElevantDbContext context,
    CommercialPermissionGuard permissions,
    UserManager<ApplicationUser> userManager,
    AccountEmailOptions emailOptions)
    : ICommercialProvisioningStore
{
    private const string ProvisionAction = "governance.provisioning.provision";
    private const string LinkAction = "governance.provisioning.link";
    private const string ResendAction = "governance.provisioning.resend_invitation";

    public async Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return null;
        return await (from request in context.ServiceRequests.AsNoTracking()
            join contract in context.Contracts.AsNoTracking()
                on request.Id equals contract.OriginatingServiceRequestId
            where request.Status == CommercialRequestStatus.Approved &&
                request.ProvisionedAccountId == null &&
                contract.Status == ContractStatus.Draft
            orderby request.ReviewedAt descending
            select new ProvisioningTaskData(request.PublicId, request.RequestCode,
                request.RequestedAirlineName, request.ContactName, request.ContactEmail,
                contract.PublicId, request.ReviewedAt ?? request.SubmittedAt,
                Convert.ToBase64String(request.RowVersion)))
            .ToArrayAsync(cancellationToken);
    }

    public async Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId,
        ProvisionAirlineInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return ProvisioningResult.Failed(ProvisioningFailure.Forbidden);
        if (input is null || !ValidEmail(input.Email))
            return ProvisioningResult.Failed(ProvisioningFailure.Invalid, GovernanceAccountIssues.InvalidProvisioning);
        // Expand phase: older clients send neither; a client that sends the key must send the version.
        if (idempotencyKey is { } key && HeaderFailure(key, input.ExpectedVersion) is { } headerFailure)
            return headerFailure;
        var invite = string.IsNullOrWhiteSpace(input.TemporaryPassword);
        // An invitation needs the portal origin for its activation link.
        if (invite && emailOptions.Link("/activar", "x") is null)
            return ProvisioningResult.Failed(ProvisioningFailure.Invalid, GovernanceAccountIssues.InvitationsUnavailable);
        var email = input.Email.Trim();
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        // The receipt never stores the temporary password: a replay compares it with the account instead.
        return await RunAsync(actor, idempotencyKey, ProvisionAction,
            new { requestId, email = email.ToUpperInvariant(), input.ExpectedVersion, invite },
            invite ? null : accountId => PasswordMatchesAsync(accountId, input.TemporaryPassword!, cancellationToken),
            async now =>
            {
                var target = await AvailableRequestAsync(requestId, input.ExpectedVersion, cancellationToken);
                if (target.Failure is { } unavailable) return unavailable;
                var (request, airlineName, organizationId) = (target.Request!, target.AirlineName!, target.OrganizationId);
                var role = await context.Roles.SingleOrDefaultAsync(item =>
                    item.NormalizedName == "AIRLINE_CLIENT" && item.IsActive, cancellationToken);
                if (role is null)
                    return ProvisioningResult.Failed(ProvisioningFailure.Conflict, GovernanceAccountIssues.RequestUnavailable);
                var existing = await ExistingAccountAsync(email, organizationId, cancellationToken);
                if (existing.Account is not null)
                    return ProvisioningResult.Failed(ProvisioningFailure.Conflict,
                        ProvisioningAccountRules.ProvisionIssue(existing.Facts!));
                if (await context.Persons.AnyAsync(item => item.PrimaryEmail == email, cancellationToken))
                    return ProvisioningResult.Failed(ProvisioningFailure.Conflict, GovernanceAccountIssues.EmailInUse);

                var words = request.ContactName.Trim().Split(' ',
                    StringSplitOptions.RemoveEmptyEntries);
                var person = new Person
                {
                    PublicId = Guid.CreateVersion7(),
                    FirstName = words[0],
                    LastName = words.Length > 1 ? string.Join(' ', words[1..]) : "Representante",
                    PrimaryEmail = email,
                    PhoneNumber = request.ContactPhone,
                    // Technical linkage only; this is not a claimed legal identity number.
                    IdentificationType = "COMMERCIAL_REQUEST",
                    IdentificationNumber = request.PublicId.ToString("N"),
                };
                context.Persons.Add(person);
                await context.SaveChangesAsync(cancellationToken);
                var account = new ApplicationUser
                {
                    PublicId = Guid.CreateVersion7(),
                    PersonId = person.Id,
                    UserName = email, Email = email, EmailConfirmed = !invite,
                    LockoutEnabled = true,
                    Status = AccountLifecycleStatus.Active,
                    // Invited accounts cannot sign in until they confirm the email and set a password.
                    InvitationStatus = invite ? InvitationStatus.Sent : InvitationStatus.Accepted,
                    MustChangePassword = !invite,
                };
                var created = invite ? await userManager.CreateAsync(account)
                    : await userManager.CreateAsync(account, input.TemporaryPassword!);
                if (!created.Succeeded)
                {
                    // A concurrent command took the email between the check and the insert.
                    var duplicate = created.Errors.Any(error => error.Code is "DuplicateUserName" or "DuplicateEmail");
                    return ProvisioningResult.Failed(duplicate ? ProvisioningFailure.Conflict : ProvisioningFailure.Invalid,
                        duplicate ? GovernanceAccountIssues.EmailHasAccount : GovernanceAccountIssues.PasswordPolicy);
                }
                context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
                { UserId = account.Id, RoleId = role.Id });
                context.OrganizationMemberships.Add(new OrganizationMembership
                {
                    PublicId = Guid.CreateVersion7(),
                    AccountId = account.Id, OrganizationId = organizationId,
                    Kind = MembershipKind.AirlineClient,
                    Status = MembershipStatus.Active,
                    JobTitle = request.ContactTitle,
                });
                request.ProvisionedAccountId = account.Id;
                request.UpdatedAt = now;
                // 2-N20: the provisioned account represents the airline in its portal.
                await AirlinePortalRoles.GrantRepresentativeAsync(context, organizationId, account.Id, cancellationToken);
                Audit(actor, "commercial.airline_account.provisioned", account.PublicId, organizationId, now,
                    $"Commercial request {request.RequestCode}");
                AccountChangeOutboxWriter.Add(context, account.Id, null,
                    "airline_contracts", request.PublicId, now);
                if (invite && !EfAccountEmailStore.AddActivation(context, emailOptions, account,
                        person.FirstName, airlineName, now))
                    return ProvisioningResult.Failed(ProvisioningFailure.Invalid,
                        GovernanceAccountIssues.InvitationsUnavailable);
                // 1-N14: Contratos can now send the airline's draft to Finance.
                await ContractDraftAudience.PortalAccountReadyAsync(context, request.Id, now, cancellationToken);
                return ProvisioningResult.Success(account.PublicId);
            }, cancellationToken);
    }

    public async Task<ProvisioningResult> LinkAccountAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
        LinkProvisioningAccountInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return ProvisioningResult.Failed(ProvisioningFailure.Forbidden);
        if (HeaderFailure(idempotencyKey, input?.ExpectedVersion) is { } headerFailure) return headerFailure;
        if (!ValidEmail(input!.Email))
            return ProvisioningResult.Failed(ProvisioningFailure.Invalid, GovernanceAccountIssues.InvalidProvisioning);
        var email = input.Email.Trim();
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, LinkAction,
            new { requestId, email = email.ToUpperInvariant(), input.ExpectedVersion }, null, async now =>
            {
                var target = await AvailableRequestAsync(requestId, input.ExpectedVersion, cancellationToken);
                if (target.Failure is { } unavailable) return unavailable;
                var (request, organizationId) = (target.Request!, target.OrganizationId);
                var existing = await ExistingAccountAsync(email, organizationId, cancellationToken);
                if (existing.Account is not { } account)
                    return ProvisioningResult.Failed(ProvisioningFailure.Invalid, GovernanceAccountIssues.AccountNotFound);
                if (ProvisioningAccountRules.LinkIssue(existing.Facts!) is { } refused)
                    return ProvisioningResult.Failed(ProvisioningFailure.Conflict, refused);

                // A portal account without an airline joins this one; an ended membership of the same
                // airline (a returning customer) is reactivated. Credentials are never touched.
                var membership = await context.OrganizationMemberships.SingleOrDefaultAsync(item =>
                    item.AccountId == account.Id && item.OrganizationId == organizationId, cancellationToken);
                var before = membership?.Status.ToString();
                if (membership is null)
                    context.OrganizationMemberships.Add(new OrganizationMembership
                    {
                        PublicId = Guid.CreateVersion7(),
                        AccountId = account.Id, OrganizationId = organizationId,
                        Kind = MembershipKind.AirlineClient,
                        Status = MembershipStatus.Active,
                        JobTitle = request.ContactTitle,
                    });
                else if (membership.Status != MembershipStatus.Active || membership.ValidTo is not null)
                {
                    membership.Status = MembershipStatus.Active;
                    membership.ValidTo = null;
                    membership.UpdatedAt = now;
                }
                request.ProvisionedAccountId = account.Id;
                request.UpdatedAt = now;
                // 2-N20: the provisioned account represents the airline in its portal.
                await AirlinePortalRoles.GrantRepresentativeAsync(context, organizationId, account.Id, cancellationToken);
                Audit(actor, "commercial.airline_account.linked", account.PublicId, organizationId, now,
                    $"Commercial request {request.RequestCode}",
                    new AuditFieldChangeData("membership.status", before, MembershipStatus.Active.ToString()));
                AccountChangeOutboxWriter.Add(context, account.Id, null, "airline_contracts", request.PublicId, now);
                await ContractDraftAudience.PortalAccountReadyAsync(context, request.Id, now, cancellationToken);
                return ProvisioningResult.Success(account.PublicId);
            }, cancellationToken);
    }

    public async Task<ProvisioningResult> ResendInvitationAsync(Guid actorId, Guid accountId,
        ResendInvitationInput? input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return ProvisioningResult.Failed(ProvisioningFailure.Forbidden);
        var expectedVersion = input?.ExpectedVersion;
        if (idempotencyKey is { } key && HeaderFailure(key, expectedVersion) is { } headerFailure) return headerFailure;
        if (emailOptions.Link("/activar", "x") is null)
            return ProvisioningResult.Failed(ProvisioningFailure.Invalid, GovernanceAccountIssues.InvitationsUnavailable);
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, ResendAction, new { accountId, expectedVersion }, null, async now =>
        {
            var target = await (from user in context.Users
                                join person in context.Persons on user.PersonId equals person.Id
                                where user.PublicId == accountId && user.Status == AccountLifecycleStatus.Active &&
                                      context.UserRoles.Any(link => link.UserId == user.Id && context.Roles.Any(role =>
                                          role.Id == link.RoleId && role.Portal == PortalKind.AirlinePortal))
                                select new { User = user, person.FirstName }).SingleOrDefaultAsync(cancellationToken);
            if (target is null) return ProvisioningResult.Failed(ProvisioningFailure.NotFound, "not_found");
            if (expectedVersion is not null && Convert.ToBase64String(target.User.RowVersion) != expectedVersion)
                return ProvisioningResult.Failed(ProvisioningFailure.Conflict, "version_conflict");
            if (target.User.InvitationStatus == InvitationStatus.Accepted)
                return ProvisioningResult.Failed(ProvisioningFailure.Conflict, GovernanceAccountIssues.InvitationAlreadyAccepted);
            var airline = await (from membership in context.OrganizationMemberships
                                 join organization in context.Organizations on membership.OrganizationId equals organization.Id
                                 where membership.AccountId == target.User.Id && membership.Status == MembershipStatus.Active
                                 select organization.DisplayName).FirstOrDefaultAsync(cancellationToken) ?? "su aerolínea";
            // The new link replaces the earlier ones, and their emails still in the queue are discarded (1-N09).
            await EfAccountEmailStore.RetireActivationAsync(context, target.User, EmailDeliveryReasons.Superseded, now,
                cancellationToken);
            if (!EfAccountEmailStore.AddActivation(context, emailOptions, target.User, target.FirstName, airline, now))
                return ProvisioningResult.Failed(ProvisioningFailure.Invalid, GovernanceAccountIssues.InvitationsUnavailable);
            target.User.InvitationStatus = InvitationStatus.Sent;
            target.User.UpdatedAt = now;
            Audit(actor, "commercial.airline_account.invitation_resent", target.User.PublicId, null, now, null);
            return ProvisioningResult.Success(target.User.PublicId);
        }, cancellationToken);
    }

    private sealed record RequestTarget(ServiceRequest? Request, string? AirlineName, long OrganizationId,
        ProvisioningResult? Failure);

    /// <summary>
    /// The request still waits for its portal account: approved, not provisioned, its airline and
    /// organization active and the contract it created still a draft (a discarded one closed it).
    /// </summary>
    private async Task<RequestTarget> AvailableRequestAsync(Guid requestId, string? expectedVersion,
        CancellationToken cancellationToken)
    {
        static RequestTarget Refused(ProvisioningFailure failure, string code) =>
            new(null, null, 0, ProvisioningResult.Failed(failure, code));
        var request = await context.ServiceRequests.SingleOrDefaultAsync(
            item => item.PublicId == requestId, cancellationToken);
        if (request is null) return Refused(ProvisioningFailure.NotFound, "not_found");
        if (expectedVersion is not null && Convert.ToBase64String(request.RowVersion) != expectedVersion)
            return Refused(ProvisioningFailure.Conflict, "version_conflict");
        if (request.Status != CommercialRequestStatus.Approved ||
            request.ProvisionedAccountId is not null || request.AirlineId is null ||
            !await context.Contracts.AnyAsync(contract => contract.OriginatingServiceRequestId == request.Id &&
                contract.Status == ContractStatus.Draft, cancellationToken))
            return Refused(ProvisioningFailure.Conflict, GovernanceAccountIssues.RequestUnavailable);
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == request.AirlineId && item.IsActive)
            .Select(item => new { item.Name, item.OrganizationId }).SingleOrDefaultAsync(cancellationToken);
        var organizationActive = airline is not null && await context.Organizations.AnyAsync(item =>
            item.Id == airline.OrganizationId && item.Status == OrganizationStatus.Active, cancellationToken);
        return organizationActive
            ? new RequestTarget(request, airline!.Name, airline.OrganizationId, null)
            : Refused(ProvisioningFailure.Conflict, GovernanceAccountIssues.RequestUnavailable);
    }

    /// <summary>The account that already uses the email, if any, and what it is (1-N13).</summary>
    private async Task<(ApplicationUser? Account, ExistingAccountFacts? Facts)> ExistingAccountAsync(string email,
        long organizationId, CancellationToken cancellationToken)
    {
        var normalized = email.ToUpperInvariant();
        var account = await context.Users.SingleOrDefaultAsync(item => item.NormalizedEmail == normalized,
            cancellationToken);
        if (account is null) return (null, null);
        var portals = await (from link in context.UserRoles
                             join role in context.Roles on link.RoleId equals role.Id
                             where link.UserId == account.Id
                             select role.Portal).ToArrayAsync(cancellationToken);
        var memberships = await context.OrganizationMemberships.AsNoTracking()
            .Where(item => item.AccountId == account.Id)
            .Select(item => new { item.OrganizationId, item.Kind, item.Status }).ToArrayAsync(cancellationToken);
        return (account, new ExistingAccountFacts(
            IsActive: account.Status == AccountLifecycleStatus.Active,
            IsInternal: portals.Any(portal => portal != PortalKind.AirlinePortal) ||
                memberships.Any(item => item.Kind == MembershipKind.InternalStaff),
            IsPortalAccount: portals.Contains(PortalKind.AirlinePortal),
            BelongsToOtherAirline: memberships.Any(item => item.Kind == MembershipKind.AirlineClient &&
                item.Status == MembershipStatus.Active && item.OrganizationId != organizationId)));
    }

    private void Audit(long actorDatabaseId, string action, Guid accountId, long? organizationId, DateTimeOffset now,
        string? reason, params AuditFieldChangeData[] changes) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = actorDatabaseId, Action = action, EntityType = "iam.accounts", EntityPublicId = accountId,
            OrganizationId = organizationId, Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            Reason = reason, MetadataJson = SafeAuditChanges.Serialize(changes),
        });

    /// <summary>A replayed temporary-password provisioning must carry the password the account has.</summary>
    private async Task<bool> PasswordMatchesAsync(Guid accountId, string password, CancellationToken cancellationToken)
    {
        var account = await context.Users.SingleOrDefaultAsync(item => item.PublicId == accountId, cancellationToken);
        return account is not null && await userManager.CheckPasswordAsync(account, password);
    }

    /// <summary>
    /// Runs one command serializable: the receipt of its Idempotency-Key is resolved before anything
    /// else (a legitimate retry sees the version already changed), the command applies its rules and
    /// changes, and the receipt is written in the same transaction. A failed rule rolls back.
    /// </summary>
    private async Task<ProvisioningResult> RunAsync(long actorDatabaseId, Guid? idempotencyKey, string action,
        object payload, Func<Guid, Task<bool>>? replayMatches, Func<DateTimeOffset, Task<ProvisioningResult>> command,
        CancellationToken cancellationToken)
    {
        var hash = CommercialCommandReceipts.Hash(payload);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await ReplayAsync(prior.ResultId, replayMatches);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return ProvisioningResult.Failed(ProvisioningFailure.Conflict, "idempotency_conflict");
                }
                var now = DateTimeOffset.UtcNow;
                var result = await command(now);
                if (!result.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorDatabaseId, action, hash,
                        result.AccountId!.Value, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return ProvisioningResult.Failed(ProvisioningFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await ReplayAsync(concurrent.ResultId, replayMatches)
                : ProvisioningResult.Failed(ProvisioningFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Another command took the email or linked the account meanwhile.
            context.ChangeTracker.Clear();
            return ProvisioningResult.Failed(ProvisioningFailure.Conflict, GovernanceAccountIssues.EmailHasAccount);
        }
    }

    private static async Task<ProvisioningResult> ReplayAsync(Guid accountId, Func<Guid, Task<bool>>? matches) =>
        matches is null || await matches(accountId)
            ? ProvisioningResult.Success(accountId)
            : ProvisioningResult.Failed(ProvisioningFailure.Conflict, "idempotency_conflict");

    private static ProvisioningResult? HeaderFailure(Guid idempotencyKey, string? expectedVersion) =>
        idempotencyKey == Guid.Empty
            ? ProvisioningResult.Failed(ProvisioningFailure.Invalid, "idempotency_key_required")
            : string.IsNullOrWhiteSpace(expectedVersion)
                ? ProvisioningResult.Failed(ProvisioningFailure.Invalid, "expected_version_required")
                : null;

    private Task<long> ActorDatabaseIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);

    private static bool ValidEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 256 &&
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
