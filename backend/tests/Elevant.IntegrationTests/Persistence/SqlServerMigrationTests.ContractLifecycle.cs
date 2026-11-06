using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private const string LifecycleMigration = "20261102163828_AddAirlinePermitsAndContractLifecycle";
    private static readonly Guid SeededContractVersion = Guid.Parse("60000000-0000-7000-8000-000000000003");
    private static readonly Guid PortalAirlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
    private static readonly Guid ContractsAdministrator = Guid.Parse("40000000-0000-7000-8000-000000000005");

    // 1×1 PNG standing in for a drawn signature (ADR-0025).
    private const string SignaturePng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    /// <summary>Contratos confirms a year of validity with automatic renewal and returns the hash to sign.</summary>
    private static async Task<string> ConfirmValidityAsync(IContractDocumentStore documents, Guid versionId, DateOnly from,
        CancellationToken ct)
    {
        var current = (await documents.ReadAsync(ContractsAdministrator, versionId, ct)).Document!;
        var result = await documents.SetValidityAsync(ContractsAdministrator, versionId, new ContractValidityInput(
            from, from.AddYears(1).AddDays(-1), "Automatic", 12, 30, 60, "Incumplimiento grave de pago.",
            current.ContentSha256), null, ct);
        Assert.Null(result.Code);
        Assert.Null(result.Failure);
        return result.Document!.ContentSha256;
    }

    [Fact]
    public async Task ContractsBecomeActiveAfterFinanceSignaturesAndAPermitAndFollowTheirDatedLifecycle()
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
        // 2-F: contract and permit days are AVIAM's business days, whatever the hour of the run.
        var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);
        async Task<Contract> ContractAsync() => await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct);

        // A legacy active contract without permits is never suspended by the sweep (expand phase).
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).Suspended);
        Assert.Equal(ContractStatus.Active, (await ContractAsync()).Status);

        // Start from an approved, unsigned contract.
        await context.Contracts.Where(item => item.Id == contractId).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractStatus.Draft).SetProperty(item => item.SignedOn, (DateOnly?)null), ct);
        var unconfirmed = (await documents.ReadAsync(ContractsAdministrator, SeededContractVersion, ct)).Document!;
        // ADR-0025: nobody signs before Contratos confirms validity and renewal.
        Assert.Equal(ContractDocumentFailure.ValidityPending, (await documents.SignAsync(PortalAirlineAccount,
            SeededContractVersion, new SignContractInput(Guid.NewGuid(), "Casey Airline", "Director",
                unconfirmed.ContentSha256, true, SignaturePng), ct)).Failure);
        var hash = await ConfirmValidityAsync(documents, SeededContractVersion, today, ct);
        Assert.Null((await documents.SignAsync(PortalAirlineAccount, SeededContractVersion,
            new SignContractInput(Guid.NewGuid(), "Casey Airline", "Director", hash, true, SignaturePng), ct)).Failure);
        Assert.Null((await documents.SignAsync(ContractsAdministrator, SeededContractVersion,
            new SignContractInput(Guid.NewGuid(), "Ana Pérez", "Gerente comercial", hash, true, SignaturePng), ct)).Failure);
        // Signed by both but without a verified operating permit: still a draft.
        Assert.Equal(ContractStatus.Draft, (await ContractAsync()).Status);

        // The airline submits its permit; Contratos verifies it and the contract activates at once.
        Assert.Null(await permits.ListForAirlineAsync(ContractsAdministrator, ct));
        Assert.Equal("permit_expired", (await permits.SubmitAsync(PortalAirlineAccount,
            new SubmitAirlinePermitInput("OperatingPermit", "JAC-2026-001", "JAC", today.AddDays(-400), today.AddDays(-1), null), null, ct)).Code);
        var submitted = (await permits.SubmitAsync(PortalAirlineAccount,
            new SubmitAirlinePermitInput("OperatingPermit", "JAC-2026-002", "Junta de Aviación Civil", today.AddDays(-30), today.AddDays(20), null), null, ct)).Permit!;
        Assert.Equal(("Submitted", "Expiring"), (submitted.Review, submitted.Validity));
        Assert.Equal(AirlinePermitFailure.Forbidden, (await permits.ReviewAsync(PortalAirlineAccount, submitted.Id,
            new ReviewAirlinePermitInput(true, null, submitted.Version), null, ct)).Failure);
        Assert.Equal("review_note_required", (await permits.ReviewAsync(ContractsAdministrator, submitted.Id,
            new ReviewAirlinePermitInput(false, null, submitted.Version), null, ct)).Code);
        Assert.Contains((await permits.ListForContractsAsync(ContractsAdministrator, "Submitted", ct))!, item => item.Id == submitted.Id);
        Assert.Equal("Verified", (await permits.ReviewAsync(ContractsAdministrator, submitted.Id,
            new ReviewAirlinePermitInput(true, "Vigente según la JAC.", submitted.Version), null, ct)).Permit!.Review);
        var active = await ContractAsync();
        Assert.Equal(ContractStatus.Active, active.Status);
        Assert.NotNull(active.SignedOn);
        // ADR-0025: the final code was assigned with the validity, and activation queued the signed PDF.
        Assert.False(Elevant.Application.Commercial.ContractValidity.IsDraftCode(active.ContractCode));
        var emails = await context.EmailOutbox.AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.ContractActivated).ToArrayAsync(ct);
        Assert.NotEmpty(emails);
        Assert.All(emails, item => Assert.Equal("contract-version:" + SeededContractVersion, item.AttachmentReference));
        var resolver = new EfContractAttachmentResolver(
            scope.ServiceProvider.GetRequiredService<EfContractDocumentStore>(),
            new Elevant.Infrastructure.Commercial.ContractPdfRenderer());
        var pdf = (await resolver.ResolveAsync(emails[0].AttachmentReference!, ct))!;
        Assert.Equal("application/pdf", pdf.ContentType);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf.Content[..4]));
        Assert.Null(await resolver.ResolveAsync("contract-version:" + Guid.NewGuid(), ct));

        // The 30-day notice of the permit goes out once.
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).PermitNotices);
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).PermitNotices);

        // Manual actions need a reason, the expected state and the lifecycle permission.
        Assert.Equal(ContractLifecycleFailure.Forbidden, (await lifecycle.ApplyAsync(PortalAirlineAccount, SeededContractVersion,
            new ContractLifecycleInput("Suspend", "Prueba de permisos", "Active"), null, ct)).Failure);
        Assert.Equal("reason_required", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Suspend", "no", "Active"), null, ct)).Code);
        Assert.Equal("status_changed", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Suspend", "Auditoría de seguridad", "Suspended"), null, ct)).Code);
        Assert.Equal("Suspended", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Suspend", "Auditoría de seguridad", "Active"), null, ct)).Status);
        Assert.Equal("Active", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Reactivate", "Auditoría cerrada", "Suspended"), null, ct)).Status);

        // An expired permit suspends the contract; reactivating by hand needs a usable permit,
        // and verifying a new one resumes it.
        await context.AirlinePermits.Where(item => item.PublicId == submitted.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiresOn, today.AddDays(-1)), ct);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).Suspended);
        Assert.Equal(ContractStatus.Suspended, (await ContractAsync()).Status);
        Assert.Equal("permit_required", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Reactivate", "Intento sin permiso", "Suspended"), null, ct)).Code);
        var renewed = (await permits.SubmitAsync(PortalAirlineAccount,
            new SubmitAirlinePermitInput("OperatingPermit", "JAC-2027-001", "Junta de Aviación Civil", today, today.AddYears(1), null), null, ct)).Permit!;
        await permits.ReviewAsync(ContractsAdministrator, renewed.Id, new ReviewAirlinePermitInput(true, null, renewed.Version), null, ct);
        Assert.Equal(ContractStatus.Active, (await ContractAsync()).Status);

        // Renewal copies the version in force into a draft for Finance; only one at a time.
        var renewal = await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Renew", "Renovación anual", "Active", new DateOnly(2100, 1, 1), new DateOnly(2100, 12, 31)), null, ct);
        var draft = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == renewal.DraftVersionId, ct);
        Assert.Equal((ContractVersionStatus.Draft, 2), (draft.Status, draft.VersionNumber));
        var sourceVersionId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion).Select(item => item.Id).SingleAsync(ct);
        Assert.Equal(await context.ContractServiceRates.CountAsync(item => item.ContractVersionId == sourceVersionId, ct),
            await context.ContractServiceRates.CountAsync(item => item.ContractVersionId == draft.Id, ct));
        Assert.Equal("draft_in_progress", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Renew", "Otra renovación", "Active", new DateOnly(2101, 1, 1), null), null, ct)).Code);

        // Past its last approved validity the contract expires; it can still be terminated.
        await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ValidFrom, today.AddDays(-30))
                .SetProperty(item => item.ValidTo, today.AddDays(-1)), ct);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).Expired);
        Assert.Equal("Terminated", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Terminate", "Fin de la relación comercial", "Expired"), null, ct)).Status);
        Assert.NotNull((await ContractAsync()).TerminatedOn);
        // 1-B: the renewal draft in progress closes with the contract; nothing is deleted.
        Assert.Equal(ContractVersionStatus.Rejected, await context.ContractVersions.AsNoTracking()
            .Where(item => item.Id == draft.Id).Select(item => item.Status).SingleAsync(ct));

        // Timeline: the airline reads the same history, without internal names.
        var internalView = (await lifecycle.TimelineAsync(ContractsAdministrator, SeededContractVersion, ct))!;
        var airlineView = (await lifecycle.TimelineAsync(PortalAirlineAccount, SeededContractVersion, ct))!;
        Assert.Equal(internalView.Entries.Count, airlineView.Entries.Count);
        Assert.Equal(internalView.Entries.Select(item => item.At), internalView.Entries.Select(item => item.At).Order());
        foreach (var title in new[] { "Firma de la aerolínea", "Contratos verificó permiso de operación", "Contrato activo",
                     "Contrato suspendido", "Borrador de la versión 2", "Contrato vencido", "Contrato terminado" })
            Assert.Contains(airlineView.Entries, item => item.Title == title);
        Assert.Contains(internalView.Entries, item => item.Title == "Contrato suspendido" && item.Actor is not null && item.Actor != "Sistema");
        Assert.DoesNotContain(airlineView.Entries, item => item.Actor is not null && item.Actor != "Sistema" && item.Kind == "status");
        Assert.Equal("Terminated", airlineView.Status);

        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, LifecycleMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52333, failure.Number);
    }
}

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task AutomaticRenewalStartsItsDraftOnceWithinTheNoticeWindow()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        // 2-F: contract and permit days are AVIAM's business days, whatever the hour of the run.
        var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);

        // The seeded active contract gets validity with automatic renewal (12 months, 30 days' notice).
        await ConfirmValidityAsync(documents, SeededContractVersion, today, ct);
        Assert.Equal(0, await context.ContractVersions.CountAsync(item => item.ContractId == contractId &&
            item.Status == ContractVersionStatus.Draft, ct));

        // Outside the notice window nothing happens; inside it, one renewal draft starts and only once.
        await lifecycle.SweepAsync(ct);
        Assert.Equal(0, await context.ContractVersions.CountAsync(item => item.ContractId == contractId &&
            item.Status == ContractVersionStatus.Draft, ct));
        await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ValidTo, today.AddDays(10)), ct);
        context.ChangeTracker.Clear();
        await lifecycle.SweepAsync(ct);
        await lifecycle.SweepAsync(ct);
        var drafts = await context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == contractId && item.Status == ContractVersionStatus.Draft).ToArrayAsync(ct);
        var draft = Assert.Single(drafts);
        Assert.Equal((today.AddDays(11), today.AddDays(11).AddMonths(12).AddDays(-1)), (draft.ValidFrom, draft.ValidTo));
        Assert.Null(draft.ValidityConfirmedAt);
        Assert.NotNull((await context.ContractVersions.AsNoTracking()
            .SingleAsync(item => item.PublicId == SeededContractVersion, ct)).RenewalStartedAt);
    }
}
