using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 1, block D: «Ocultar del catálogo público» keeps a service operable and «Dar de baja» is refused
/// while a contract keeps it in force, as a rate or inside a package (1-N03); a closure is approved on a
/// hidden or retired service and a retired service is reactivated before it is republished (1-N11).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid CatalogOccAccount = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private const string RetirementReason = "AVIAM deja de prestar este servicio en sus estaciones.";

    [Fact]
    public async Task RetiringAServiceIsRefusedWhileAContractKeepsItInForce()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var catalog = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        async Task<ManagedServiceData> ServiceAsync(string code) =>
            (await catalog.ListAsync(ContractsAccount, ct))!.Single(item => item.Code == code);
        Task<CatalogMutationResult> RetireAsync(ManagedServiceData service, Guid? key = null,
            string reason = RetirementReason) =>
            catalog.RetireAsync(ContractsAccount, service.Id, key ?? Guid.NewGuid(),
                new RetireServiceInput(service.Version, reason), ct);

        // DEV-CONTRACT-0001 is active and its approved version, with PASSENGER-BRIDGE, runs to 2099.
        var bridge = await ServiceAsync("PASSENGER-BRIDGE");
        Assert.Equal("service_in_active_contract", (await RetireAsync(bridge)).Code);
        // The deprecated DELETE applies the same check.
        var deleted = await catalog.DeleteAsync(ContractsAccount, bridge.Id, bridge.Version, null, ct);
        Assert.Equal((CatalogMutationFailure.Conflict, "service_in_active_contract"), (deleted.Failure!.Value, deleted.Code));
        Assert.True((await ServiceAsync("PASSENGER-BRIDGE")).IsActive);
        // Only Contratos retires, with its key, the version on screen and a reason.
        Assert.Equal(CatalogMutationFailure.Forbidden, (await catalog.RetireAsync(FinanceAccount, bridge.Id,
            Guid.NewGuid(), new RetireServiceInput(bridge.Version, RetirementReason), ct)).Failure);
        Assert.Equal("idempotency_key_required", (await catalog.RetireAsync(ContractsAccount, bridge.Id, Guid.Empty,
            new RetireServiceInput(bridge.Version, RetirementReason), ct)).Code);
        Assert.Equal("expected_version_required", (await catalog.RetireAsync(ContractsAccount, bridge.Id,
            Guid.NewGuid(), new RetireServiceInput(null, RetirementReason), ct)).Code);
        Assert.Equal("reason_required", (await RetireAsync(bridge, reason: "corto")).Code);
        Assert.Equal("not_found", (await catalog.RetireAsync(ContractsAccount, Guid.NewGuid(), Guid.NewGuid(),
            new RetireServiceInput(bridge.Version, RetirementReason), ct)).Code);
        Assert.Equal("version_conflict", (await catalog.RetireAsync(ContractsAccount, bridge.Id, Guid.NewGuid(),
            new RetireServiceInput("AAAAAAAAAAA=", RetirementReason), ct)).Code);

        // 1-N03: the form never deactivates; it hides the service from the public catalog and keeps it operable.
        var stairs = await ServiceAsync("RAMP-STAIRS");
        Assert.True(stairs.IsPublic && stairs.IsActive);
        var refused = await catalog.SaveAsync(ContractsAccount, stairs.Id, Input(stairs) with { IsActive = false },
            Guid.NewGuid(), ct);
        Assert.Equal((CatalogMutationFailure.Invalid, "retirement_command_required"), (refused.Failure!.Value, refused.Code));
        var hideKey = Guid.NewGuid();
        var hidden = await catalog.SaveAsync(ContractsAccount, stairs.Id, Input(stairs) with { IsPublic = false },
            hideKey, ct);
        Assert.Null(hidden.Failure);
        Assert.Equal((false, true), (hidden.Service!.IsPublic, hidden.Service.IsActive));
        // A retry with the same key replays the current service and audits nothing new.
        Assert.Equal(hidden.Service, (await catalog.SaveAsync(ContractsAccount, stairs.Id,
            Input(stairs) with { IsPublic = false }, hideKey, ct)).Service);
        Assert.Equal("idempotency_conflict", (await catalog.SaveAsync(ContractsAccount, stairs.Id,
            Input(stairs) with { IsPublic = false, Name = "Escaleras" }, hideKey, ct)).Code);
        Assert.Equal(1, await context.AuditEntries.AsNoTracking().CountAsync(item =>
            item.Action == "commercial.catalog.updated" && item.EntityPublicId == stairs.Id, ct));

        // A version Finance is approving keeps its services; discarded, it no longer does.
        var (_, pending) = await DraftContractAsync(context, "QA-RETIRE-PENDING", "Condiciones.", true, ct, "RAMP-STAIRS");
        await context.ContractVersions.Where(item => item.Id == pending.Id).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.Status, ContractVersionStatus.PendingFinanceApproval), ct);
        stairs = await ServiceAsync("RAMP-STAIRS");
        Assert.Equal("service_in_active_contract", (await RetireAsync(stairs)).Code);
        await context.ContractVersions.Where(item => item.Id == pending.Id).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.Status, ContractVersionStatus.Rejected), ct);

        // A service inside a package of the version in force is kept too, even without its own rate.
        var tow = await ServiceAsync("RAMP-TOW");
        var package = await packages.SaveAsync(FinanceAccount, null, new SavePackageInput(Guid.NewGuid(), "QA-TOW",
            "Paquete de remolque", "USD", 500m, "Turnaround", null, null, new DateOnly(2026, 1, 1), null,
            [new PackageComponentInput(tow.Id, "operation", 1m, 1m, 100m)], null), ct);
        Assert.True(package.IsSuccess, package.Code);
        var packageRow = Assert.Single((await packages.ListAsync(FinanceAccount, ct))!, item => item.Id == package.Id);
        Assert.True((await packages.PublishAsync(FinanceAccount, package.Id!.Value,
            new PackageCommandInput(Guid.NewGuid(), packageRow.Version), ct)).IsSuccess);
        var now = DateTimeOffset.UtcNow;
        context.Set<ContractServicePackage>().Add(new ContractServicePackage
        {
            PublicId = Guid.CreateVersion7(),
            ContractVersionId = await context.ContractVersions.AsNoTracking()
                .Where(item => item.PublicId == SeededContractVersion).Select(item => item.Id).SingleAsync(ct),
            PackageVersionId = await context.Set<ServicePackageVersion>().AsNoTracking()
                .Where(item => item.PublicId == package.Id).Select(item => item.Id).SingleAsync(ct),
            CreatedAt = now, UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        Assert.Equal("service_in_active_contract", (await RetireAsync(tow)).Code);

        // A draft keeps a retired service marked (1-N10), so it does not block the retirement.
        var (_, draft) = await DraftContractAsync(context, "QA-RETIRE-DRAFT", null, false, ct, "RAMP-STAIRS");
        var retireKey = Guid.NewGuid();
        var retired = await RetireAsync(stairs, retireKey);
        Assert.Null(retired.Failure);
        Assert.Equal((false, false), (retired.Service!.IsActive, retired.Service.IsPublic));
        // The same key replays; another reason with it is a conflict; a retired service is not retired again.
        Assert.Equal(retired.Service, (await RetireAsync(stairs, retireKey)).Service);
        Assert.Equal("idempotency_conflict",
            (await RetireAsync(stairs, retireKey, "Otro motivo distinto para la misma clave.")).Code);
        Assert.Equal("service_retired", (await RetireAsync(retired.Service)).Code);
        var audit = await context.AuditEntries.AsNoTracking().SingleAsync(item =>
            item.Action == "commercial.catalog.retired" && item.EntityPublicId == stairs.Id, ct);
        Assert.Equal(RetirementReason, audit.Reason);
        // Contratos re-reads the open draft that keeps it: its readiness now reports service_retired.
        var hints = (await context.OutboxMessages.AsNoTracking()
                .Where(item => item.EventType == "account.changed.v1").ToArrayAsync(ct))
            .Select(AccountChangeOutboxWriter.Decode).ToArray();
        Assert.Contains(hints, item => item.Resource == "contract_drafts" && item.ResourceId == draft.PublicId);

        // A retired service is not published by the form: it is reactivated first, still hidden.
        var current = await ServiceAsync("RAMP-STAIRS");
        Assert.Equal("service_retired", (await catalog.SaveAsync(ContractsAccount, current.Id,
            Input(current) with { IsPublic = true }, Guid.NewGuid(), ct)).Code);
        var reactivated = await catalog.SaveAsync(ContractsAccount, current.Id, Input(current) with { IsActive = true },
            Guid.NewGuid(), ct);
        Assert.Null(reactivated.Failure);
        Assert.Equal((true, false), (reactivated.Service!.IsActive, reactivated.Service.IsPublic));
    }

    [Fact]
    public async Task ClosuresAreDecidedOnHiddenOrRetiredServicesAndARetiredServiceIsReactivatedFirst()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var catalog = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        var closures = scope.ServiceProvider.GetRequiredService<IServiceClosureStore>();
        async Task<ManagedServiceData> ServiceAsync() =>
            (await catalog.ListAsync(ContractsAccount, ct))!.Single(item => item.Code == "RAMP-GPU");
        const string reason = "La unidad generadora de energía está fuera de servicio.";
        const string reopenReason = "La unidad generadora volvió a estar disponible.";

        // OCC reports a published service once; the codes explain every refusal.
        var gpu = await ServiceAsync();
        var pending = (await closures.RequestAsync(CatalogOccAccount, Guid.CreateVersion7(), gpu.Id, reason, ct)).Request!;
        Assert.Equal("closure_pending",
            (await closures.RequestAsync(CatalogOccAccount, Guid.CreateVersion7(), gpu.Id, reason, ct)).Code);
        Assert.Equal("service_not_found",
            (await closures.RequestAsync(CatalogOccAccount, Guid.CreateVersion7(), Guid.NewGuid(), reason, ct)).Code);
        Assert.Equal("reason_required",
            (await closures.RequestAsync(CatalogOccAccount, Guid.CreateVersion7(), gpu.Id, "corto", ct)).Code);
        // Four eyes: whoever reported a closure cannot decide it, and the failure says why. The report is
        // attributed to Contratos here, since no seeded account both reports and decides.
        var parking = (await catalog.ListAsync(ContractsAccount, ct))!.Single(item => item.Code == "RAMP-PARKING");
        var own = (await closures.RequestAsync(CatalogOccAccount, Guid.CreateVersion7(), parking.Id, reason, ct)).Request!;
        var contractsKey = await AccountKeyAsync(context, ContractsAccount, ct);
        await context.ServiceClosureRequests.Where(item => item.PublicId == own.Id).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.RequestedByAccountId, contractsKey), ct);
        var ownVersion = Convert.ToBase64String(await context.ServiceClosureRequests.AsNoTracking()
            .Where(item => item.PublicId == own.Id).Select(item => item.RowVersion).SingleAsync(ct));
        var self = await closures.DecideAsync(ContractsAccount, own.Id, true, null, ownVersion, Guid.NewGuid(), ct);
        Assert.Equal((ServiceClosureFailure.Forbidden, "closure_self_decision"), (self.Failure!.Value, self.Code));

        // 1-N11: Contratos hides it from the form first; the pending closure is still approved.
        var hidden = await catalog.SaveAsync(ContractsAccount, gpu.Id, Input(gpu) with { IsPublic = false }, Guid.NewGuid(), ct);
        Assert.Null(hidden.Failure);
        Assert.Equal("service_not_published",
            (await closures.RequestAsync(CatalogOccAccount, Guid.CreateVersion7(), gpu.Id, reason, ct)).Code);
        var decideKey = Guid.NewGuid();
        var approved = await closures.DecideAsync(ContractsAccount, pending.Id, true, null, pending.Version, decideKey, ct);
        Assert.Null(approved.Failure);
        Assert.Equal(("Approved", false, true),
            (approved.Request!.Status, approved.Request.IsCurrentlyPublic, approved.Request.IsServiceActive));
        // The same key replays; another decision with it is a conflict; a stale version is a version conflict.
        Assert.Equal(approved.Request, (await closures.DecideAsync(ContractsAccount, pending.Id, true, null,
            pending.Version, decideKey, ct)).Request);
        Assert.Equal("idempotency_conflict", (await closures.DecideAsync(ContractsAccount, pending.Id, false,
            "Otra decisión con la misma clave.", pending.Version, decideKey, ct)).Code);
        Assert.Equal("version_conflict", (await closures.DecideAsync(ContractsAccount, pending.Id, false,
            "La clausura ya se había decidido.", pending.Version, null, ct)).Code);
        Assert.Equal("closure_not_pending", (await closures.DecideAsync(ContractsAccount, pending.Id, false,
            "La clausura ya se había decidido.", approved.Request.Version, null, ct)).Code);

        // The form does not republish what an approved closure hid.
        var current = await ServiceAsync();
        Assert.Equal("closure_requires_reopen", (await catalog.SaveAsync(ContractsAccount, current.Id,
            Input(current) with { IsPublic = true }, Guid.NewGuid(), ct)).Code);

        // Retired (no contract uses it), it cannot be republished until it is reactivated.
        var retired = await catalog.RetireAsync(ContractsAccount, current.Id, Guid.NewGuid(),
            new RetireServiceInput(current.Version, RetirementReason), ct);
        Assert.Null(retired.Failure);
        var listed = Assert.Single((await closures.ListAsync(ContractsAccount, "Approved", 1, 25, ct))!.Items,
            item => item.Id == pending.Id);
        Assert.Equal((false, false), (listed.IsServiceActive, listed.IsCurrentlyPublic));
        Assert.Equal("service_retired", (await closures.ReopenAsync(ContractsAccount, gpu.Id, reopenReason,
            listed.ServiceVersion, Guid.NewGuid(), ct)).Code);

        // Reactivated, still hidden, it is republished from its closure with a reason.
        current = await ServiceAsync();
        var reactivated = await catalog.SaveAsync(ContractsAccount, current.Id, Input(current) with { IsActive = true },
            Guid.NewGuid(), ct);
        Assert.Equal((true, false), (reactivated.Service!.IsActive, reactivated.Service.IsPublic));
        Assert.Equal("version_conflict", (await closures.ReopenAsync(ContractsAccount, gpu.Id, reopenReason,
            listed.ServiceVersion, Guid.NewGuid(), ct)).Code);
        var reopenKey = Guid.NewGuid();
        var reopened = await closures.ReopenAsync(ContractsAccount, gpu.Id, reopenReason,
            reactivated.Service.Version, reopenKey, ct);
        Assert.Null(reopened.Failure);
        Assert.True(reopened.Request!.IsCurrentlyPublic);
        Assert.Equal(reopened.Request, (await closures.ReopenAsync(ContractsAccount, gpu.Id, reopenReason,
            reactivated.Service.Version, reopenKey, ct)).Request);
        Assert.Equal("service_already_public", (await closures.ReopenAsync(ContractsAccount, gpu.Id, reopenReason,
            reopened.Request.ServiceVersion, Guid.NewGuid(), ct)).Code);
        Assert.True((await ServiceAsync()).IsPublic);
    }

    private static ManagedServiceInput Input(ManagedServiceData service) => new(service.Code, service.Name,
        service.Description, service.BillingUnit, service.ImageUrl, service.VideoUrl, service.DisplayOrder,
        service.IsPublic, service.IsActive, service.Version);
}
