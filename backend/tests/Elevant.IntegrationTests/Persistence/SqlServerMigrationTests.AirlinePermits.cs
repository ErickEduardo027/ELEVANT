using Elevant.Application.Abstractions.Commercial;
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
        var organization = await (from contract in context.Contracts
                                  join airline in context.Airlines on contract.AirlineId equals airline.Id
                                  join item in context.Organizations on airline.OrganizationId equals item.Id
                                  where contract.Id == contractId
                                  select item.PublicId).SingleAsync(ct);

        var active = (await standing.GetStandingAsync(organization, BusinessToday, ct))!;
        Assert.Equal((AirlinePortalStandings.Active, false), (active.Status, active.ReadOnly));
        Assert.NotEmpty(active.Stations);
        Assert.Contains(active.Stations, station => station.Current);
        Assert.Null(Assert.Single(active.Contracts).PendingReason);
        Assert.Null(await standing.GetStandingAsync(Guid.NewGuid(), BusinessToday, ct));

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
    }
}
