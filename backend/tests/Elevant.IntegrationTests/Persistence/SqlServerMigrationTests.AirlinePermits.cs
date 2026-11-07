using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 2, block B: the JAC permit commands (2-N09, 2-N37), the airline's emails (2-N12, 2-N13) and its
/// portal standing (2-N32, 2-N35), against SQL Server.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly DateOnly BusinessToday = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);

    private static async Task<long> SeededContractIdAsync(ElevantDbContext context, CancellationToken ct) =>
        await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);

    private static async Task<int> EmailsAsync(ElevantDbContext context, EmailPurpose purpose, CancellationToken ct) =>
        await context.EmailOutbox.AsNoTracking().CountAsync(item => item.Purpose == purpose, ct);

    /// <summary>The organization of the airline of a contract: the tenant of its portal standing.</summary>
    private static async Task<Guid> OrganizationOfContractAsync(ElevantDbContext context, long contractId,
        CancellationToken ct) =>
        await (from contract in context.Contracts
               join airline in context.Airlines on contract.AirlineId equals airline.Id
               join item in context.Organizations on airline.OrganizationId equals item.Id
               where contract.Id == contractId
               select item.PublicId).SingleAsync(ct);

    /// <summary>
    /// A second version of the seeded contract Finance approved from <paramref name="start"/>, with the stations of the
    /// version in force and <paramref name="stations"/>; nobody signed it yet.
    /// </summary>
    private static async Task<Guid> ApprovedAmendmentAsync(ElevantDbContext context, DateOnly start, CancellationToken ct,
        params long[] stations)
    {
        var inForce = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion, ct);
        var now = DateTimeOffset.UtcNow;
        var version = new ContractVersion
        {
            PublicId = Guid.NewGuid(), ContractId = inForce.ContractId, VersionNumber = 2,
            Status = ContractVersionStatus.Approved, ValidFrom = start, ValidTo = start.AddYears(1),
            CurrencyCode = inForce.CurrencyCode, Terms = inForce.Terms, ApprovedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractVersions.Add(version);
        await context.SaveChangesAsync(ct);
        var current = await context.Set<ContractVersionStation>().AsNoTracking()
            .Where(item => item.ContractVersionId == inForce.Id).Select(item => item.StationId).ToArrayAsync(ct);
        context.Set<ContractVersionStation>().AddRange(current.Concat(stations).Select(station =>
            new ContractVersionStation { ContractVersionId = version.Id, StationId = station }));
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        return version.PublicId;
    }

    [Fact]
    public async Task APermitSubmissionRetriedAfterItsDayOrItsScanWindowEndedAnswersThePermitItCreated()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        // 21:00 on 5 November in Santo Domingo: the last hours of the business day.
        var clock = new MovableTimeProvider(EveningInSantoDomingo);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var permits = scope.ServiceProvider.GetRequiredService<IAirlinePermitStore>();
        var portalAccount = await context.Users.Where(user => user.PublicId == PortalAirlineAccount).Select(user => user.Id)
            .SingleAsync(ct);

        // A permit current until today, with a scan uploaded almost six days ago: the submission is accepted.
        var scan = new MediaAsset
        {
            PublicId = Guid.CreateVersion7(), Purpose = "airline-permit", ObjectKey = $"airline-permit/{Guid.NewGuid():N}",
            ContentType = "application/pdf", Length = 8, Sha256 = new string('b', 64), UploadedByAccountId = portalAccount,
            CreatedAt = clock.Now.AddDays(-6).AddHours(1),
        };
        context.MediaAssets.Add(scan);
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        var input = new SubmitAirlinePermitInput("OperatingPermit", "JAC-B-RETRY", "Junta de Aviación Civil",
            SantoDomingoToday.AddDays(-300), SantoDomingoToday, $"/api/v1/media/{scan.PublicId}");
        var key = Guid.NewGuid();
        var first = await permits.SubmitAsync(PortalAirlineAccount, input, key, ct);
        Assert.Null(first.Code);

        // 2-N09: the answer is lost and the retry comes four hours later, when the permit expired yesterday and the scan
        // is past the link window (2-N37): the same key and body answer the permit already created, created once.
        clock.Now = clock.Now.AddHours(4);
        var replay = await permits.SubmitAsync(PortalAirlineAccount, input, key, ct);
        Assert.Null(replay.Code);
        Assert.Equal(first.Permit!.Id, replay.Permit!.Id);
        Assert.Equal(1, await context.AirlinePermits.CountAsync(item => item.Number == "JAC-B-RETRY", ct));
        Assert.Equal(1, await context.DepartmentNotifications.CountAsync(item => item.Kind == "permit_submitted" &&
            item.SourceId == first.Permit.Id, ct));
        // A new submission is checked against the clock; the key with another body is still a conflict.
        Assert.Equal(AirlinePermitIssues.Expired, (await permits.SubmitAsync(PortalAirlineAccount, input, Guid.NewGuid(), ct)).Code);
        var renewed = input with { ExpiresOn = SantoDomingoToday.AddYears(1) };
        Assert.Equal(AirlinePermitIssues.DocumentExpired, (await permits.SubmitAsync(PortalAirlineAccount, renewed,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("idempotency_conflict", (await permits.SubmitAsync(PortalAirlineAccount, renewed, key, ct)).Code);
        Assert.Equal(1, await context.AirlinePermits.CountAsync(item => item.Number == "JAC-B-RETRY", ct));
    }

    [Fact]
    public async Task TheExpiryNoticeRestartsOnlyWhenTheEndOfTheCoverageMoves()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var clock = new MovableTimeProvider(EveningInSantoDomingo);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var contractId = await SeededContractIdAsync(context, ct);
        var day = SantoDomingoToday;
        async Task<DateTimeOffset?> NoticeSentAsync() => await context.Contracts.AsNoTracking()
            .Where(item => item.Id == contractId).Select(item => item.ExpiryNoticeSentAt).SingleAsync(ct);
        async Task ConfirmAsync(Guid versionId, DateOnly from, DateOnly to, int noticeDays)
        {
            var current = (await documents.ReadAsync(ContractsAdministrator, versionId, ct)).Document!;
            Assert.Null((await documents.SetValidityAsync(ContractsAdministrator, versionId, new ContractValidityInput(from, to,
                "Manual", null, noticeDays, 0, null, current.ContentSha256), Guid.NewGuid(), ct)).Code);
        }
        // An amendment of the contract from a day, through Finance, its validity and both signatures.
        async Task AmendAsync(DateOnly from, DateOnly to, int noticeDays)
        {
            var created = await packages.CreateAmendmentAsync(ContractsAdministrator, SeededContractVersion, Guid.NewGuid(),
                new CreateAmendmentInput("Active", from), ct);
            Assert.True(created.IsSuccess, created.Code);
            var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
                item => item.Id == created.Id);
            Assert.True((await drafts.UpdateAsync(ContractsAdministrator, draft.Id, new UpdateContractDraftInput(draft.ValidFrom,
                draft.ValidTo, draft.CurrencyCode, draft.Terms!, draft.Rates.Select(rate => new UpdateDraftRateInput(rate.Id,
                    rate.BillingUnit, rate.UnitPrice, rate.MinimumQuantity, true)).ToArray(), null, draft.Version),
                Guid.NewGuid(), ct)).IsSuccess);
            draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!, item => item.Id == draft.Id);
            var submitted = await drafts.ActivateAsync(ContractsAdministrator, draft.Id,
                new SubmitContractDraftInput(draft.Version), Guid.NewGuid(), ct);
            Assert.True(submitted.IsSuccess, submitted.Code);
            var pending = (await book.GetContractApprovalAsync(FinanceAccount, draft.Id, ct))!;
            Assert.True((await book.DecideContractApprovalAsync(FinanceAccount, draft.Id,
                new DecideContractApprovalInput("Approved", null, pending.Summary.Version), Guid.NewGuid(), ct)).IsSuccess);
            await ConfirmAsync(draft.Id, from, to, noticeDays);
            await SignByBothAsync(documents, draft.Id, ct);
            context.ChangeTracker.Clear();
        }

        // The legacy version in force ends in 40 days and signs 35 days of notice: the end is announced on day 5.
        var end = day.AddDays(40);
        await ConfirmAsync(SeededContractVersion, day, end, 35);
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).ContractNotices);
        clock.Now = clock.Now.AddDays(5);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).ContractNotices);
        var sent = await EmailsAsync(context, EmailPurpose.ContractExpiring, ct);
        Assert.NotEqual(0, sent);

        // 2-N12: its validity confirmed again with the same end and 20 days of notice: that end is not announced twice
        // when the 20 days fall due.
        await ConfirmAsync(SeededContractVersion, day.AddDays(5), end, 20);
        Assert.NotNull(await NoticeSentAsync());
        clock.Now = clock.Now.AddDays(15);
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).ContractNotices);

        // An amendment signed after the notice keeps that end: nobody is told about it again.
        await AmendAsync(day.AddDays(10), end, 25);
        Assert.NotNull(await NoticeSentAsync());
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).ContractNotices);
        Assert.Equal(sent, await EmailsAsync(context, EmailPurpose.ContractExpiring, ct));

        // One that moves the end restarts the notice, and the new end is announced.
        var moved = end.AddDays(5);
        await AmendAsync(day.AddDays(15), moved, 25);
        Assert.Null(await NoticeSentAsync());
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).ContractNotices);
        Assert.True(await EmailsAsync(context, EmailPurpose.ContractExpiring, ct) > sent);
        var latest = await context.EmailOutbox.AsNoTracking().Where(item => item.Purpose == EmailPurpose.ContractExpiring)
            .OrderByDescending(item => item.Id).FirstAsync(ct);
        Assert.Contains(moved.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture), latest.Subject);
    }

    [Fact]
    public async Task PermitCommandsAreIdempotentReviewOnlySubmittedPermitsAndARevocationSuspendsAndResumes()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var permits = scope.ServiceProvider.GetRequiredService<IAirlinePermitStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var contractId = await SeededContractIdAsync(context, ct);
        async Task<Contract> ContractAsync() => await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct);
        var portalAccount = await context.Users.Where(user => user.PublicId == PortalAirlineAccount).Select(user => user.Id)
            .SingleAsync(ct);
        Assert.Equal(ContractStatus.Active, (await ContractAsync()).Status);

        // 2-N09: the submission replays with the same key and body, and refuses another body for that key.
        var input = new SubmitAirlinePermitInput("OperatingPermit", "JAC-B-001", "Junta de Aviación Civil",
            BusinessToday.AddDays(-30), BusinessToday.AddYears(1), null);
        var key = Guid.NewGuid();
        var first = await permits.SubmitAsync(PortalAirlineAccount, input, key, ct);
        var replay = await permits.SubmitAsync(PortalAirlineAccount, input, key, ct);
        Assert.Equal(first.Permit!.Id, replay.Permit!.Id);
        Assert.Equal(1, await context.AirlinePermits.CountAsync(item => item.Number == "JAC-B-001", ct));
        Assert.Equal(1, await context.DepartmentNotifications.CountAsync(item => item.Kind == "permit_submitted" &&
            item.SourceId == first.Permit.Id, ct));
        Assert.Equal("idempotency_conflict", (await permits.SubmitAsync(PortalAirlineAccount,
            input with { Number = "JAC-B-OTRO" }, key, ct)).Code);
        Assert.Equal("idempotency_key_required", (await permits.SubmitAsync(PortalAirlineAccount, input, Guid.Empty, ct)).Code);
        Assert.Equal("invalid_permit", (await permits.SubmitAsync(PortalAirlineAccount, input with { Issuer = " " }, null, ct)).Code);

        // 2-N37: a scan uploaded before the link window is refused with its own code; a fresh one links.
        MediaAsset Upload(int ageDays, string purpose = "airline-permit")
        {
            var id = Guid.CreateVersion7();
            return new MediaAsset
            {
                PublicId = id, Purpose = purpose, ObjectKey = $"{purpose}/{id:N}", ContentType = "application/pdf", Length = 8,
                Sha256 = new string('b', 64), UploadedByAccountId = portalAccount, CreatedAt = DateTimeOffset.UtcNow.AddDays(-ageDays),
            };
        }
        var (stale, fresh, other) = (Upload(7), Upload(0), Upload(0, "service-image"));
        context.MediaAssets.AddRange(stale, fresh, other);
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        Assert.Equal("document_expired", (await permits.SubmitAsync(PortalAirlineAccount,
            input with { Number = "JAC-B-SCAN", DocumentUrl = $"/api/v1/media/{stale.PublicId}" }, null, ct)).Code);
        Assert.Equal("document_invalid", (await permits.SubmitAsync(PortalAirlineAccount,
            input with { Number = "JAC-B-SCAN", DocumentUrl = $"/api/v1/media/{other.PublicId}" }, null, ct)).Code);
        Assert.Null((await permits.SubmitAsync(PortalAirlineAccount,
            input with { Number = "JAC-B-SCAN", DocumentUrl = $"/api/v1/media/{fresh.PublicId}" }, null, ct)).Code);

        // Verifying needs the version on screen; the legacy active contract changes nothing.
        var submitted = first.Permit;
        Assert.Equal("expected_version_required", (await permits.ReviewAsync(ContractsAdministrator, submitted.Id,
            new ReviewAirlinePermitInput(true, null, " "), null, ct)).Code);
        var verified = Assert.IsType<AirlinePermitDecisionData>((await permits.ReviewAsync(ContractsAdministrator, submitted.Id,
            new ReviewAirlinePermitInput(true, "Vigente según la JAC.", submitted.Version), Guid.NewGuid(), ct)).Permit);
        Assert.Equal("Verified", verified.Review);
        Assert.Empty(verified.Contracts);
        // Only a submitted permit is reviewed: a verified one is never rejected by the API.
        Assert.Equal(AirlinePermitIssues.ReviewClosed, (await permits.ReviewAsync(ContractsAdministrator, submitted.Id,
            new ReviewAirlinePermitInput(false, "Rechazo tardío por API.", verified.Version), null, ct)).Code);

        // 2-N13: a rejection queues the email with the note for the airline.
        var rejectedEmails = await EmailsAsync(context, EmailPurpose.PermitRejected, ct);
        var insurance = (await permits.SubmitAsync(PortalAirlineAccount, new SubmitAirlinePermitInput("Insurance", "POL-B-1",
            "Aseguradora", BusinessToday.AddDays(-5), BusinessToday.AddYears(1), null), null, ct)).Permit!;
        Assert.Equal("Rejected", (await permits.ReviewAsync(ContractsAdministrator, insurance.Id,
            new ReviewAirlinePermitInput(false, "El documento no es legible.", insurance.Version), null, ct)).Permit!.Review);
        Assert.True(await EmailsAsync(context, EmailPurpose.PermitRejected, ct) > rejectedEmails);
        Assert.Contains(await context.EmailOutbox.AsNoTracking().Where(item => item.Purpose == EmailPurpose.PermitRejected)
            .Select(item => item.TextBody).ToArrayAsync(ct), body => body!.Contains("El documento no es legible."));

        // 2-N09: revoking the only verified operating permit suspends the active contract in the same step.
        Assert.Equal("reason_required", (await permits.RevokeAsync(ContractsAdministrator, submitted.Id,
            new RevokeAirlinePermitInput("no", verified.Version), Guid.NewGuid(), ct)).Code);
        Assert.Equal("version_conflict", (await permits.RevokeAsync(ContractsAdministrator, submitted.Id,
            new RevokeAirlinePermitInput("Se verificó por error.", "AAAAAAAAAAA="), Guid.NewGuid(), ct)).Code);
        Assert.Equal(AirlinePermitFailure.Forbidden, (await permits.RevokeAsync(PortalAirlineAccount, submitted.Id,
            new RevokeAirlinePermitInput("Se verificó por error.", verified.Version), Guid.NewGuid(), ct)).Failure);
        var revokeKey = Guid.NewGuid();
        var revoked = Assert.IsType<AirlinePermitDecisionData>((await permits.RevokeAsync(ContractsAdministrator, submitted.Id,
            new RevokeAirlinePermitInput("Se verificó por error otra matrícula.", verified.Version), revokeKey, ct)).Permit);
        var contract = await ContractAsync();
        Assert.Equal(ContractStatus.Suspended, contract.Status);
        Assert.Equal(("Revoked", "Se verificó por error otra matrícula."), (revoked.Review, revoked.RevocationReason));
        Assert.NotNull(revoked.RevokedAt);
        // The original verification stays on the row.
        Assert.Equal(("Vigente según la JAC.", verified.ReviewedAt), (revoked.ReviewNote, revoked.ReviewedAt));
        Assert.Equal((contract.PublicId, "Suspended"), (Assert.Single(revoked.Contracts).ContractId, revoked.Contracts[0].Status));
        var suspension = await context.Set<ContractStatusEvent>().AsNoTracking().Where(item => item.ContractId == contractId)
            .OrderByDescending(item => item.Id).FirstAsync(ct);
        Assert.Equal((ContractStatus.Suspended, (long?)null, ContractActivation.PermitRevokedSuspensionReason),
            (suspension.ToStatus, suspension.ActorAccountId, suspension.Reason));
        Assert.True(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.permit.revoked" &&
            item.EntityPublicId == submitted.Id && item.Reason == "Se verificó por error otra matrícula.", ct));
        var (revokedEmails, suspendedEmails) = (await EmailsAsync(context, EmailPurpose.PermitRevoked, ct),
            await EmailsAsync(context, EmailPurpose.ContractSuspended, ct));
        Assert.True(revokedEmails > 0 && suspendedEmails > 0);

        // A replay answers the same contracts and repeats nothing; the permit can no longer be revoked.
        var replayed = Assert.IsType<AirlinePermitDecisionData>((await permits.RevokeAsync(ContractsAdministrator, submitted.Id,
            new RevokeAirlinePermitInput("Se verificó por error otra matrícula.", verified.Version), revokeKey, ct)).Permit);
        Assert.Equal(revoked.Contracts, replayed.Contracts);
        Assert.Equal((revokedEmails, suspendedEmails), (await EmailsAsync(context, EmailPurpose.PermitRevoked, ct),
            await EmailsAsync(context, EmailPurpose.ContractSuspended, ct)));
        Assert.Equal(AirlinePermitIssues.NotVerified, (await permits.RevokeAsync(ContractsAdministrator, submitted.Id,
            new RevokeAirlinePermitInput("Otra revocación.", revoked.Version), Guid.NewGuid(), ct)).Code);
        Assert.Equal("Revoked", (await permits.ListForAirlineAsync(PortalAirlineAccount, ct))!
            .Single(item => item.Id == submitted.Id).Review);

        // Contratos cannot reactivate by hand without a usable permit; verifying a new one resumes the contract.
        Assert.Equal("permit_required", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Reactivate", "Intento sin permiso", "Suspended"), null, ct)).Code);
        var renewed = (await permits.SubmitAsync(PortalAirlineAccount, input with { Number = "JAC-B-002" }, Guid.NewGuid(), ct)).Permit!;
        var resumed = Assert.IsType<AirlinePermitDecisionData>((await permits.ReviewAsync(ContractsAdministrator, renewed.Id,
            new ReviewAirlinePermitInput(true, null, renewed.Version), Guid.NewGuid(), ct)).Permit);
        Assert.Equal("Active", Assert.Single(resumed.Contracts).Status);
        Assert.Equal(ContractStatus.Active, (await ContractAsync()).Status);

        // The history reads the revocation with its reason, for Contratos and the airline.
        var timeline = (await lifecycle.TimelineAsync(PortalAirlineAccount, SeededContractVersion, ct))!;
        Assert.Contains(timeline.Entries, item => item.Title == "Contratos revocó la verificación: permiso de operación" &&
            item.Detail == "Se verificó por error otra matrícula.");
        Assert.Contains(timeline.Entries, item => item.Title == "Contratos verificó permiso de operación");
    }

    [Fact]
    public async Task TheAirlineIsEmailedWhenItsContractCanBeSignedExpiresOrIsSuspendedWithTheSignedNoticeDays()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var permits = scope.ServiceProvider.GetRequiredService<IAirlinePermitStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var contractId = await SeededContractIdAsync(context, ct);

        // 2-N13: «listo para firmar» is queued when Contratos confirms the validity, for the airline's accounts.
        var current = (await documents.ReadAsync(ContractsAdministrator, SeededContractVersion, ct)).Document!;
        Assert.Equal(0, await EmailsAsync(context, EmailPurpose.ContractReadyToSign, ct));
        var confirmed = await documents.SetValidityAsync(ContractsAdministrator, SeededContractVersion, new ContractValidityInput(
            BusinessToday, BusinessToday.AddDays(70), "Manual", null, 60, 30, "Incumplimiento grave de pago.",
            current.ContentSha256), null, ct);
        Assert.Null(confirmed.Code);
        var ready = await context.EmailOutbox.AsNoTracking().Where(item => item.Purpose == EmailPurpose.ContractReadyToSign)
            .ToArrayAsync(ct);
        Assert.NotEmpty(ready);
        Assert.All(ready, item => Assert.Contains("listo para firmar", item.Subject));
        // Superadmin reads what the notice is about: the airline account it went to.
        var outbox = scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Messaging.IEmailOutboxStore>();
        var listed = (await outbox.ListOutboxAsync(SuperAdministratorAccount,
            new Elevant.Application.Abstractions.Messaging.EmailOutboxQuery("Pending", 1, 50), ct))!;
        var notice = Assert.Single(listed.Entries, item => item.Purpose == "ContractReadyToSign" &&
            item.Reference?.Id == PortalAirlineAccount);
        Assert.Equal("account", notice.Reference!.Kind);

        // 2-N12: the expiry notice follows the 60 days the version signed, not a fixed 30, and goes out once.
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).ContractNotices);
        await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ValidTo, BusinessToday.AddDays(45)), ct);
        context.ChangeTracker.Clear();
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).ContractNotices);
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).ContractNotices);
        var expiring = await context.EmailOutbox.AsNoTracking().Where(item => item.Purpose == EmailPurpose.ContractExpiring)
            .ToArrayAsync(ct);
        Assert.NotEmpty(expiring);
        Assert.All(expiring, item => Assert.Contains(
            BusinessToday.AddDays(45).ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture), item.Subject));

        // The 30-day permit notice reaches the airline by email too.
        var permit = (await permits.SubmitAsync(PortalAirlineAccount, new SubmitAirlinePermitInput("OperatingPermit",
            "JAC-B-030", "Junta de Aviación Civil", BusinessToday.AddDays(-300), BusinessToday.AddDays(20), null), null, ct)).Permit!;
        await permits.ReviewAsync(ContractsAdministrator, permit.Id, new ReviewAirlinePermitInput(true, null, permit.Version), null, ct);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).PermitNotices);
        Assert.NotEqual(0, await EmailsAsync(context, EmailPurpose.PermitExpiring, ct));

        // A suspension for the expired permit, and a manual one, are emailed without the internal reason.
        await context.AirlinePermits.Where(item => item.PublicId == permit.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiresOn, BusinessToday.AddDays(-1)), ct);
        context.ChangeTracker.Clear();
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).Suspended);
        var afterSweep = await EmailsAsync(context, EmailPurpose.ContractSuspended, ct);
        Assert.NotEqual(0, afterSweep);
        var renewed = (await permits.SubmitAsync(PortalAirlineAccount, new SubmitAirlinePermitInput("OperatingPermit",
            "JAC-B-031", "Junta de Aviación Civil", BusinessToday, BusinessToday.AddYears(1), null), null, ct)).Permit!;
        await permits.ReviewAsync(ContractsAdministrator, renewed.Id, new ReviewAirlinePermitInput(true, null, renewed.Version), null, ct);
        Assert.Equal(ContractStatus.Active, await context.Contracts.AsNoTracking().Where(item => item.Id == contractId)
            .Select(item => item.Status).SingleAsync(ct));
        Assert.Equal("Suspended", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Suspend", "Deuda vencida con Finanzas interna", "Active"), null, ct)).Status);
        var manual = await context.EmailOutbox.AsNoTracking().Where(item => item.Purpose == EmailPurpose.ContractSuspended)
            .OrderByDescending(item => item.Id).FirstAsync(ct);
        Assert.True(await EmailsAsync(context, EmailPurpose.ContractSuspended, ct) > afterSweep);
        Assert.DoesNotContain("Deuda vencida", manual.TextBody);
    }

    [Fact]
    public async Task ThePortalStandingKeepsTheHistoricalStationsAndTellsWhatAContractWaitsFor()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var standing = scope.ServiceProvider.GetRequiredService<IAirlinePortalStandingStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var contractId = await SeededContractIdAsync(context, ct);
        var organization = await OrganizationOfContractAsync(context, contractId, ct);

        var active = (await standing.GetStandingAsync(organization, BusinessToday, ct))!;
        Assert.Equal((AirlinePortalStandings.Active, false), (active.Status, active.ReadOnly));
        Assert.NotEmpty(active.Stations);
        Assert.Contains(active.Stations, station => station.Current);
        Assert.Null(Assert.Single(active.Contracts).PendingReason);
        Assert.Null(await standing.GetStandingAsync(Guid.NewGuid(), BusinessToday, ct));

        // 2-N32: an amendment Finance approved adds MIA but waits for both signatures. No contract in force ever covered
        // MIA, so it is no history, not even from the day the amendment would start.
        var mia = await SecondStationAsync(context, ct);
        var amendment = await ApprovedAmendmentAsync(context, BusinessToday.AddDays(10), ct, mia.Id);
        foreach (var onDate in new[] { BusinessToday, BusinessToday.AddDays(10) })
        {
            var awaiting = (await standing.GetStandingAsync(organization, onDate, ct))!;
            Assert.Equal(active.Stations.Select(station => (station.Code, station.Current)),
                awaiting.Stations.Select(station => (station.Code, station.Current)));
            Assert.Contains(amendment, Assert.Single(awaiting.Contracts).VersionsAwaitingSignatures);
        }

        // 2-N32: suspended, nothing is in force, but the stations of its history stay listed.
        await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Suspend", "Auditoría de seguridad", "Active"), null, ct);
        var suspended = (await standing.GetStandingAsync(organization, BusinessToday, ct))!;
        Assert.Equal((AirlinePortalStandings.Suspended, true), (suspended.Status, suspended.ReadOnly));
        Assert.Equal(active.Stations.Select(station => station.Code), suspended.Stations.Select(station => station.Code));
        Assert.DoesNotContain(suspended.Stations, station => station.Current);

        // 2-N35: a contract that never activated waits for both signatures of its approved version.
        await context.Contracts.Where(item => item.Id == contractId).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractStatus.Draft).SetProperty(item => item.SignedOn, (DateOnly?)null), ct);
        var pending = (await standing.GetStandingAsync(organization, BusinessToday, ct))!;
        var row = Assert.Single(pending.Contracts);
        Assert.Equal((AirlinePortalStandings.Pending, AirlinePortalStandings.PendingSignatures),
            (pending.Status, row.PendingReason));
        Assert.Contains(SeededContractVersion, row.VersionsAwaitingSignatures);
        // It was never in force, so none of its stations is history.
        Assert.Empty(pending.Stations);
        Assert.True(pending.ReadOnly);
    }

    [Fact]
    public async Task AStationOfASignedVersionIsNoHistoryBeforeTheVersionStarts()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var standing = scope.ServiceProvider.GetRequiredService<IAirlinePortalStandingStore>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var organization = await OrganizationOfContractAsync(context, await SeededContractIdAsync(context, ct), ct);

        // 2-N32: both parties sign an amendment that adds MIA from day 10. Until then the version in force covers PUJ
        // and MIA is neither current nor history; from that day the amendment covers both.
        var mia = await SecondStationAsync(context, ct);
        var start = BusinessToday.AddDays(10);
        await SignByBothAsync(documents, await ApprovedAmendmentAsync(context, start, ct, mia.Id), ct);
        var today = (await standing.GetStandingAsync(organization, BusinessToday, ct))!;
        Assert.Equal(new[] { (Code: "PUJ", Current: true) },
            today.Stations.Select(station => (station.Code, station.Current)));
        var started = (await standing.GetStandingAsync(organization, start, ct))!;
        Assert.Equal(new[] { (Code: "MIA", Current: true), (Code: "PUJ", Current: true) },
            started.Stations.Select(station => (station.Code, station.Current)));
    }
}
