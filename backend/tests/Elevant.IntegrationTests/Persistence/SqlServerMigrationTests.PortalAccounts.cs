using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Superadministración, portal accounts and emails (phase 1, block E): provisioning that links an
/// existing portal account (1-N13), the temporary password that closes a pending invitation (1-N12),
/// queued links and codes that expire or get replaced without keeping their secrets (1-N09), the
/// outbox with reasons and references (1-N22) and the identity of an operating airline (1-N20).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string PortalEmailAddress = "airline.client@dev.elevant.test";

    /// <summary>Seeded database with portal invitations enabled (the portal origin is configured).</summary>
    private static async Task<ServiceProvider> PortalAccountsProviderAsync(TemporaryDatabase database, CancellationToken ct)
    {
        (await SeededFinanceProviderAsync(database, ct)).Dispose();
        return new ServiceCollection().AddLogging()
            .AddSingleton(TimeProvider.System)
            .AddSingleton(new AccountEmailOptions { PublicWebBaseUrl = "https://portal.example.test" })
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
    }

    /// <summary>An airline with its organization and an approved request whose contract is still a draft.</summary>
    private static async Task<(Organization Organization, Airline Airline, ServiceRequest Request, Contract Contract)>
        ApprovedRequestAsync(ElevantDbContext context, string code, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var organization = new Organization
        {
            PublicId = Guid.CreateVersion7(), Code = $"QA-{code}", LegalName = $"{code} SYNTHETIC AIRLINE",
            DisplayName = $"{code} Airline", Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
            CreatedAt = now, UpdatedAt = now,
        };
        context.Organizations.Add(organization);
        await context.SaveChangesAsync(ct);
        var airline = new Airline
        {
            PublicId = Guid.CreateVersion7(), OrganizationId = organization.Id, IcaoCode = code, Name = $"{code} Airline",
            IsActive = true, CreatedAt = now, UpdatedAt = now,
        };
        context.Airlines.Add(airline);
        await context.SaveChangesAsync(ct);
        var request = new ServiceRequest
        {
            PublicId = Guid.CreateVersion7(), RequestCode = $"QA-REQ-{code}", AirlineId = airline.Id,
            RequestedAirlineName = airline.Name, Type = CommercialRequestType.Affiliation,
            Status = CommercialRequestStatus.Approved, ContactName = "Ana Rivera", ContactTitle = "Gerente comercial",
            ContactEmail = $"ana@{code.ToLowerInvariant()}.example.com", AuthorityDeclared = true,
            SubmittedAt = now.AddDays(-2), ReviewedAt = now.AddDays(-1), CreatedAt = now, UpdatedAt = now,
        };
        context.ServiceRequests.Add(request);
        await context.SaveChangesAsync(ct);
        var contract = new Contract
        {
            PublicId = Guid.CreateVersion7(), AirlineId = airline.Id, OriginatingServiceRequestId = request.Id,
            ContractCode = $"QA-CTR-{code}", Status = ContractStatus.Draft, CreatedAt = now, UpdatedAt = now,
        };
        context.Contracts.Add(contract);
        await context.SaveChangesAsync(ct);
        context.ContractVersions.Add(new ContractVersion
        {
            PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = 1,
            Status = ContractVersionStatus.Draft, ValidFrom = new DateOnly(2026, 12, 1), CurrencyCode = "USD",
            CreatedAt = now, UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        return (organization, airline, request, contract);
    }

    [Fact]
    public async Task ProvisioningLinksAnExistingPortalAccountOrSaysWhyItCannot()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await PortalAccountsProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var provisioning = scope.ServiceProvider.GetRequiredService<ICommercialProvisioningStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var (_, _, invited, _) = await ApprovedRequestAsync(context, "QAI", ct);
        var (organization, _, linked, _) = await ApprovedRequestAsync(context, "QAL", ct);
        var (_, _, discarded, discardedContract) = await ApprovedRequestAsync(context, "QAD", ct);
        async Task<ProvisioningTaskData?> TaskAsync(Guid requestId) =>
            (await provisioning.ListPendingAsync(SuperAdministratorAccount, ct))!.SingleOrDefault(item => item.RequestId == requestId);

        // The invitation with its key and the request version replays the same account, once.
        var task = (await TaskAsync(invited.PublicId))!;
        Assert.False(string.IsNullOrEmpty(task.Version));
        var key = Guid.NewGuid();
        var input = new ProvisionAirlineInput("ana@qai.example.com", null, task.Version);
        Assert.Equal("expected_version_required", (await provisioning.ProvisionAsync(SuperAdministratorAccount,
            invited.PublicId, input with { ExpectedVersion = null }, key, ct)).Code);
        Assert.Equal("idempotency_key_required", (await provisioning.ProvisionAsync(SuperAdministratorAccount,
            invited.PublicId, input, Guid.Empty, ct)).Code);
        var created = await provisioning.ProvisionAsync(SuperAdministratorAccount, invited.PublicId, input, key, ct);
        Assert.True(created.IsSuccess, created.Code);
        Assert.Equal(created.AccountId, (await provisioning.ProvisionAsync(SuperAdministratorAccount, invited.PublicId,
            input, key, ct)).AccountId);
        Assert.Equal("idempotency_conflict", (await provisioning.ProvisionAsync(SuperAdministratorAccount,
            invited.PublicId, input with { Email = "otra@qai.example.com" }, key, ct)).Code);
        Assert.Equal(1, await context.Users.CountAsync(user => user.Email == "ana@qai.example.com", ct));
        Assert.Equal(1, await context.Set<EmailOutboxMessage>().CountAsync(item =>
            item.Recipient == "ana@qai.example.com" && item.Purpose == EmailPurpose.Activation, ct));
        Assert.Null(await TaskAsync(invited.PublicId));

        // 1-N13: Clientes already created the representative; provisioning offers to link it instead.
        var clientUser = await governance.CreateClientUserAsync(SuperAdministratorAccount, organization.PublicId,
            new CreateClientUserInput("Luis", "Linares", "luis@qal.example.com", "Synthetic-Portal-Linked!2026"), null, ct);
        Assert.True(clientUser.IsSuccess, clientUser.Code);
        var passwordHash = await context.Users.AsNoTracking().Where(user => user.PublicId == clientUser.Id)
            .Select(user => user.PasswordHash).SingleAsync(ct);
        var version = (await TaskAsync(linked.PublicId))!.Version;
        Assert.Equal("email_has_account", (await provisioning.ProvisionAsync(SuperAdministratorAccount, linked.PublicId,
            new ProvisionAirlineInput("luis@qal.example.com", null, version), Guid.NewGuid(), ct)).Code);
        // The other refusals say why the email cannot be used.
        var internalEmail = await context.Users.AsNoTracking().Where(user => user.PublicId == ContractsAdministrator)
            .Select(user => user.Email!).SingleAsync(ct);
        Assert.Equal("email_in_use_internal", (await provisioning.ProvisionAsync(SuperAdministratorAccount, linked.PublicId,
            new ProvisionAirlineInput(internalEmail, null, version), Guid.NewGuid(), ct)).Code);
        Assert.Equal("email_in_use_other_airline", (await provisioning.LinkAccountAsync(SuperAdministratorAccount,
            linked.PublicId, Guid.NewGuid(), new LinkProvisioningAccountInput(PortalEmailAddress, version), ct)).Code);
        Assert.Equal("account_not_found", (await provisioning.LinkAccountAsync(SuperAdministratorAccount,
            linked.PublicId, Guid.NewGuid(), new LinkProvisioningAccountInput("nadie@qal.example.com", version), ct)).Code);
        await context.Users.Where(user => user.PublicId == clientUser.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(user => user.Status, AccountLifecycleStatus.Disabled), ct);
        Assert.Equal("account_disabled", (await provisioning.LinkAccountAsync(SuperAdministratorAccount,
            linked.PublicId, Guid.NewGuid(), new LinkProvisioningAccountInput("luis@qal.example.com", version), ct)).Code);
        await context.Users.Where(user => user.PublicId == clientUser.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(user => user.Status, AccountLifecycleStatus.Active), ct);
        Assert.Equal("version_conflict", (await provisioning.LinkAccountAsync(SuperAdministratorAccount,
            linked.PublicId, Guid.NewGuid(), new LinkProvisioningAccountInput("luis@qal.example.com", "AAAAAAAAAAA="), ct)).Code);
        Assert.Equal(ProvisioningFailure.Forbidden, (await provisioning.LinkAccountAsync(ContractsAdministrator,
            linked.PublicId, Guid.NewGuid(), new LinkProvisioningAccountInput("luis@qal.example.com", version), ct)).Failure);

        var linkKey = Guid.NewGuid();
        var link = new LinkProvisioningAccountInput("LUIS@qal.example.com", version);
        var linkedAccount = await provisioning.LinkAccountAsync(SuperAdministratorAccount, linked.PublicId, linkKey, link, ct);
        Assert.True(linkedAccount.IsSuccess, linkedAccount.Code);
        Assert.Equal(clientUser.Id, linkedAccount.AccountId);
        Assert.Equal(clientUser.Id, (await provisioning.LinkAccountAsync(SuperAdministratorAccount, linked.PublicId,
            linkKey, link, ct)).AccountId);
        context.ChangeTracker.Clear();
        var accountKey = await AccountKeyAsync(context, clientUser.Id!.Value, ct);
        Assert.Equal(accountKey, (await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.Id == linked.Id, ct))
            .ProvisionedAccountId);
        Assert.Null(await TaskAsync(linked.PublicId));
        // Credentials are not touched, and Contratos hears the portal account is ready.
        Assert.Equal(passwordHash, await context.Users.AsNoTracking().Where(user => user.PublicId == clientUser.Id)
            .Select(user => user.PasswordHash).SingleAsync(ct));
        Assert.True(await context.DepartmentNotifications.AsNoTracking().AnyAsync(item => item.Kind == "portal_account_ready", ct));
        Assert.Equal(1, await context.AuditEntries.CountAsync(entry => entry.Action == "commercial.airline_account.linked" &&
            entry.EntityPublicId == clientUser.Id && entry.OrganizationId == organization.Id, ct));
        Assert.Equal("request_unavailable", (await provisioning.LinkAccountAsync(SuperAdministratorAccount, linked.PublicId,
            Guid.NewGuid(), new LinkProvisioningAccountInput("luis@qal.example.com",
                Convert.ToBase64String((await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.Id == linked.Id, ct))
                    .RowVersion)), ct)).Code);

        // A request whose contract was discarded is no longer provisioned.
        var discardedVersion = (await TaskAsync(discarded.PublicId))!.Version;
        await context.Contracts.Where(item => item.Id == discardedContract.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, ContractStatus.Terminated), ct);
        Assert.Null(await TaskAsync(discarded.PublicId));
        Assert.Equal("request_unavailable", (await provisioning.ProvisionAsync(SuperAdministratorAccount, discarded.PublicId,
            new ProvisionAirlineInput("ana@qad.example.com", null, discardedVersion), Guid.NewGuid(), ct)).Code);
    }

    [Fact]
    public async Task ATemporaryPasswordClosesThePendingInvitationAndLetsTheUserSignIn()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await PortalAccountsProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var provisioning = scope.ServiceProvider.GetRequiredService<ICommercialProvisioningStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var credentials = scope.ServiceProvider.GetRequiredService<ICredentialVerifier>();
        var (organization, _, request, _) = await ApprovedRequestAsync(context, "QAP", ct);
        const string email = "ana@qap.example.com";
        var accountId = (await provisioning.ProvisionAsync(SuperAdministratorAccount, request.PublicId,
            new ProvisionAirlineInput(email), null, ct)).AccountId!.Value;
        async Task<ClientUserData> UserAsync() => (await governance.ListClientUsersAsync(SuperAdministratorAccount,
            organization.PublicId, ct))!.Single(item => item.Id == accountId);
        Task<EmailOutboxMessage[]> ActivationsAsync() => context.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Recipient == email && item.Purpose == EmailPurpose.Activation).OrderBy(item => item.Id)
            .ToArrayAsync(ct);

        // Resending replaces the queued link: the earlier email is discarded with its body (1-N09).
        var resendKey = Guid.NewGuid();
        var resend = new ResendInvitationInput((await UserAsync()).Version);
        Assert.Equal("expected_version_required", (await provisioning.ResendInvitationAsync(SuperAdministratorAccount,
            accountId, null, resendKey, ct)).Code);
        Assert.True((await provisioning.ResendInvitationAsync(SuperAdministratorAccount, accountId, resend, resendKey, ct))
            .IsSuccess);
        Assert.True((await provisioning.ResendInvitationAsync(SuperAdministratorAccount, accountId, resend, resendKey, ct))
            .IsSuccess);
        Assert.Equal("version_conflict", (await provisioning.ResendInvitationAsync(SuperAdministratorAccount, accountId,
            resend, Guid.NewGuid(), ct)).Code);
        var activations = await ActivationsAsync();
        Assert.Equal(2, activations.Length);
        Assert.Equal((EmailDeliveryStatus.Discarded, "superseded"), (activations[0].Status, activations[0].LastError));
        Assert.Null(activations[0].TextBody);
        Assert.Null(activations[0].HtmlBody);
        Assert.Equal(EmailDeliveryStatus.Pending, activations[1].Status);
        Assert.Null(await credentials.VerifyAsync(email, "Synthetic-Temporary-Close!2026", ct));

        // 1-N12: the temporary password accepts the invitation, retires its links and discards its email.
        var user = await UserAsync();
        Assert.True(user.InvitationPending);
        var key = Guid.NewGuid();
        var reset = new ResetClientUserPasswordInput("Synthetic-Temporary-Close!2026", user.Version);
        Assert.Equal("expected_version_required", (await governance.ResetClientUserPasswordAsync(SuperAdministratorAccount,
            organization.PublicId, accountId, reset with { ExpectedVersion = null }, key, ct)).Code);
        Assert.Equal("password_policy", (await governance.ResetClientUserPasswordAsync(SuperAdministratorAccount,
            organization.PublicId, accountId, reset with { TemporaryPassword = "short" }, Guid.NewGuid(), ct)).Code);
        var done = await governance.ResetClientUserPasswordAsync(SuperAdministratorAccount, organization.PublicId,
            accountId, reset, key, ct);
        Assert.True(done.IsSuccess, done.Code);
        Assert.Equal(accountId, (await governance.ResetClientUserPasswordAsync(SuperAdministratorAccount,
            organization.PublicId, accountId, reset, key, ct)).Id);
        // The same key never sets another password.
        Assert.Equal("idempotency_conflict", (await governance.ResetClientUserPasswordAsync(SuperAdministratorAccount,
            organization.PublicId, accountId, reset with { TemporaryPassword = "Synthetic-Temporary-Other!2026" }, key, ct)).Code);
        Assert.Equal("version_conflict", (await governance.ResetClientUserPasswordAsync(SuperAdministratorAccount,
            organization.PublicId, accountId, reset, Guid.NewGuid(), ct)).Code);

        context.ChangeTracker.Clear();
        var account = await context.Users.AsNoTracking().SingleAsync(item => item.PublicId == accountId, ct);
        Assert.Equal((InvitationStatus.Accepted, true, true), (account.InvitationStatus, account.EmailConfirmed,
            account.MustChangePassword));
        Assert.False((await UserAsync()).InvitationPending);
        Assert.False(await context.Set<AccountEmailToken>().AnyAsync(item => item.AccountId == account.Id &&
            item.Purpose == EmailPurpose.Activation && item.UsedAt == null, ct));
        var closed = (await ActivationsAsync())[^1];
        Assert.Equal((EmailDeliveryStatus.Discarded, "invitation_closed"), (closed.Status, closed.LastError));
        Assert.Null(closed.TextBody);
        var signedIn = await credentials.VerifyAsync(email, "Synthetic-Temporary-Close!2026", ct);
        Assert.Equal(accountId, signedIn?.AccountId);
        Assert.True(signedIn!.MustChangePassword);
        Assert.Equal("invitation_already_accepted", (await provisioning.ResendInvitationAsync(SuperAdministratorAccount,
            accountId, null, null, ct)).Code);
    }

    [Fact]
    public async Task QueuedLinksAndCodesExpireOrAreReplacedAndTheOutboxSaysWhyAndForWhom()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await PortalAccountsProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var emails = scope.ServiceProvider.GetRequiredService<IAccountEmailStore>();
        var outbox = scope.ServiceProvider.GetRequiredService<IEmailOutboxStore>();
        Task<EmailOutboxMessage[]> CodesAsync() => context.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.LoginCode).OrderBy(item => item.Id).ToArrayAsync(ct);

        // A new code discards the queued one: late, it would only burn attempts of the current code.
        var challenge = (await emails.IssueLoginCodeAsync(PortalAirlineAccount, ct))!;
        Assert.NotNull(await emails.ResendLoginCodeAsync(challenge.ChallengeId, ct));
        var codes = await CodesAsync();
        Assert.Equal(2, codes.Length);
        Assert.Equal((EmailDeliveryStatus.Discarded, "superseded"), (codes[0].Status, codes[0].LastError));
        Assert.Null(codes[0].TextBody);
        Assert.Equal(EmailDeliveryStatus.Pending, codes[1].Status);
        Assert.All(codes, item => Assert.Equal(AccountEmailTemplates.LoginCodeSubject, item.Subject));

        // A code past its lifetime is discarded even without SMTP, and the old subjects lose their code.
        await context.Set<EmailOutboxMessage>().Where(item => item.Id == codes[1].Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.CreatedAt, DateTimeOffset.UtcNow.AddMinutes(-11)), ct);
        var now = DateTimeOffset.UtcNow;
        context.Set<EmailOutboxMessage>().Add(new EmailOutboxMessage
        {
            PublicId = Guid.CreateVersion7(), Recipient = PortalEmailAddress, Subject = "Tu código de acceso ELEVANT: 482913",
            Purpose = EmailPurpose.LoginCode, Status = EmailDeliveryStatus.Sent, Attempts = 1, SentAt = now.AddDays(-3),
            NextAttemptAt = now.AddDays(-3), CreatedAt = now.AddDays(-3), UpdatedAt = now.AddDays(-3),
        });
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        Assert.Equal(1, await outbox.DiscardExpiredAsync(scrubHistory: true, ct));
        var expired = await context.Set<EmailOutboxMessage>().AsNoTracking().SingleAsync(item => item.Id == codes[1].Id, ct);
        Assert.Equal((EmailDeliveryStatus.Discarded, "expired"), (expired.Status, expired.LastError));
        Assert.Null(expired.HtmlBody);
        Assert.False(await context.Set<EmailOutboxMessage>().AnyAsync(item => item.Subject.Contains("482913"), ct));
        Assert.Empty((await outbox.ClaimDueAsync(100, ct)).Where(item => item.Id == codes[0].Id || item.Id == codes[1].Id));

        // A failure keeps only its normalized reason, never the provider's text.
        var test = (await outbox.EnqueueTestAsync(SuperAdministratorAccount, "probe@example.test", ct))!.Value;
        var claimed = (await outbox.ClaimDueAsync(100, ct)).Single(item => item.To == "probe@example.test");
        await outbox.MarkFailedAsync(claimed.Id, "SmtpException: 5.7.8 Username and Password not accepted", ct);
        Assert.Equal("send_failed", await context.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Id == claimed.Id).Select(item => item.LastError).SingleAsync(ct));
        await outbox.MarkFailedAsync(claimed.Id, EmailDeliveryReasons.SmtpAuthentication, ct);
        Assert.Equal("smtp_authentication", (await outbox.ListRecentAsync(SuperAdministratorAccount, 100, ct))!
            .Single(item => item.Id == test).LastError);

        // 1-N22: the outbox filters by status and says why and for whom each email was.
        var discardedPage = (await outbox.ListOutboxAsync(SuperAdministratorAccount, new EmailOutboxQuery("Discarded", 1, 50), ct))!;
        var superseded = Assert.Single(discardedPage.Entries, item => item.Id == codes[0].PublicId);
        Assert.Equal(("LoginCode", "Discarded", "superseded"), (superseded.Purpose, superseded.Status, superseded.Reason));
        Assert.Equal(("account", (Guid?)PortalAirlineAccount), (superseded.Reference!.Kind, superseded.Reference.Id));
        Assert.False(string.IsNullOrWhiteSpace(superseded.Reference.Label));
        Assert.All(discardedPage.Entries, item => Assert.Equal("Discarded", item.Status));
        var all = (await outbox.ListOutboxAsync(SuperAdministratorAccount, new EmailOutboxQuery("All", 1, 1), ct))!;
        Assert.True(all.HasMore);
        Assert.Single(all.Entries);
        Assert.Null(await outbox.ListOutboxAsync(PortalAirlineAccount, new EmailOutboxQuery("All", 1, 25), ct));
        Assert.Null(await outbox.ListOutboxAsync(SuperAdministratorAccount, new EmailOutboxQuery("Lost", 1, 25), ct));
    }

    [Fact]
    public async Task AnOperatingAirlineKeepsItsIdentityAndSavingWithoutChangesKeepsItsVerification()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ICommercialAirlineManagementStore>();
        var input = new ManagedAirlineInput("IDENTITY TEST", "Identity Air", "Identity Air S.R.L.", "Caribe", "DO", "Q9",
            "QNI", null, "https://identity.example.com", "https://aoc.example.gob.do/qni", IsVerified: true,
            IsPublished: true, Version: null);
        var created = (await store.SaveAsync(SuperAdministratorAccount, null, input, null, ct)).Airline!;
        Task<DateTimeOffset?> VerifiedAtAsync() => context.CommercialAirlineProfiles.AsNoTracking()
            .Where(item => item.PublicId == created.Id).Select(item => item.VerifiedAt).SingleAsync(ct);
        var verifiedAt = await VerifiedAtAsync();
        Assert.NotNull(verifiedAt);
        Assert.False(created.IdentityLocked);

        // Saving the verified profile again does not stamp a new verification.
        var saved = (await store.SaveAsync(SuperAdministratorAccount, created.Id, input with { Version = created.Version },
            Guid.NewGuid(), ct)).Airline!;
        Assert.Equal(verifiedAt, await VerifiedAtAsync());

        // Once the airline operates (its ref.airlines row), its legal name, codes and verification are fixed.
        var operating = await context.Airlines.AsNoTracking().Where(item => item.IcaoCode == "DZZ").Select(item => item.Id)
            .FirstAsync(ct);
        await context.CommercialAirlineProfiles.Where(item => item.PublicId == created.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.CanonicalAirlineId, operating), ct);
        var locked = (await store.ListAsync(SuperAdministratorAccount, ct))!.Single(item => item.Id == created.Id);
        Assert.True(locked.IdentityLocked);
        foreach (var change in new[]
                 {
                     input with { IataCode = "Q8" }, input with { IcaoCode = "QNJ" }, input with { LegalName = "Otra S.A." },
                     input with { IsVerified = false, IsPublished = false },
                 })
            Assert.Equal("airline_identity_locked", (await store.SaveAsync(SuperAdministratorAccount, created.Id,
                change with { Version = locked.Version }, Guid.NewGuid(), ct)).Code);

        // The display name, logo, publication and sources stay editable; the key replays the same save.
        var key = Guid.NewGuid();
        var edit = input with
        {
            DisplayName = "Identity Air Express", SourceUrl = "https://identity.example.com/es", IsPublished = false,
            Version = locked.Version,
        };
        Assert.Equal("expected_version_required", (await store.SaveAsync(SuperAdministratorAccount, created.Id,
            edit with { Version = null }, key, ct)).Code);
        var edited = await store.SaveAsync(SuperAdministratorAccount, created.Id, edit, key, ct);
        Assert.Null(edited.Failure);
        Assert.Equal(("Identity Air Express", false, true), (edited.Airline!.DisplayName, edited.Airline.IsPublished,
            edited.Airline.IdentityLocked));
        Assert.Equal(edited.Airline.Version, (await store.SaveAsync(SuperAdministratorAccount, created.Id, edit, key, ct))
            .Airline!.Version);
        Assert.Equal("idempotency_conflict", (await store.SaveAsync(SuperAdministratorAccount, created.Id,
            edit with { DisplayName = "Otro nombre" }, key, ct)).Code);
        Assert.Equal(CatalogMutationFailure.Conflict, (await store.SaveAsync(SuperAdministratorAccount, created.Id,
            edit with { DisplayName = "Otro nombre" }, Guid.NewGuid(), ct)).Failure);
        Assert.Equal(verifiedAt, await VerifiedAtAsync());
        Assert.NotEqual(saved.Version, edited.Airline.Version);
    }
}
