using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Contract drafts (phase 1, block B): versioned and idempotent save and submission (1-D), discard
/// without deleting history (1-B), scope of services and stations (1-N04) with retired services kept
/// marked (1-N10), one base price everywhere (1-N06), packages kept in rule (1-N07), observations in
/// both directions (1-N15), the airline view without Finance internals (1-N05), the Finance reviewer
/// scope (1-N19) and the notices to Contratos (1-N14).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string RetireReason = "La aerolínea desistió de la afiliación.";

    /// <summary>A Draft contract of the seeded airline with one PUJ version and the given services.</summary>
    private static async Task<(Contract Contract, ContractVersion Version)> DraftContractAsync(ElevantDbContext context,
        string code, string? terms, bool confirmed, CancellationToken ct, params string[] serviceCodes)
    {
        var now = DateTimeOffset.UtcNow;
        var seeded = await context.Contracts.AsNoTracking().SingleAsync(item => item.ContractCode == "DEV-CONTRACT-0001", ct);
        var contract = new Contract
        {
            PublicId = Guid.CreateVersion7(), AirlineId = seeded.AirlineId, ContractCode = code, Status = ContractStatus.Draft,
            OriginatingServiceRequestId = seeded.OriginatingServiceRequestId, CreatedAt = now, UpdatedAt = now,
        };
        context.Contracts.Add(contract);
        await context.SaveChangesAsync(ct);
        var version = new ContractVersion
        {
            PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = 1, Status = ContractVersionStatus.Draft,
            ValidFrom = new DateOnly(2026, 12, 1), CurrencyCode = "USD", Terms = terms, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractVersions.Add(version);
        await context.SaveChangesAsync(ct);
        foreach (var serviceCode in serviceCodes)
        {
            var service = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == serviceCode, ct);
            context.ContractServiceRates.Add(new ContractServiceRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, ServiceDefinitionId = service.Id,
                BillingUnit = "operation", UnitPrice = 120m, MinimumQuantity = 1m, IsConfirmed = confirmed,
                CreatedAt = now, UpdatedAt = now,
            });
        }
        var station = await context.Stations.AsNoTracking().SingleAsync(item => item.Code == "PUJ", ct);
        context.Set<ContractVersionStation>().Add(new ContractVersionStation { ContractVersionId = version.Id, StationId = station.Id });
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        return (contract, version);
    }

    private static Task<long> AccountKeyAsync(ElevantDbContext context, Guid accountId, CancellationToken ct) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == accountId).Select(user => user.Id).SingleAsync(ct);

    private static async Task<Station> SecondStationAsync(ElevantDbContext context, CancellationToken ct)
    {
        var airport = await context.Airports.Where(item => item.IataCode == "MIA").Select(item => item.Id).SingleAsync(ct);
        var station = new Station
        {
            PublicId = Guid.CreateVersion7(), AirportId = airport, Code = "MIA", Name = "Synthetic second station",
            IanaTimeZone = "America/New_York", IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Stations.Add(station);
        await context.SaveChangesAsync(ct);
        return station;
    }

    private static async Task GrantStationAsync(ElevantDbContext context, Guid accountId, long stationId, CancellationToken ct)
    {
        context.AccountStationScopes.Add(new AccountStationScope
        {
            AccountId = await AccountKeyAsync(context, accountId, ct), StationId = stationId,
            GrantedAt = DateTimeOffset.UtcNow.AddMinutes(-1),
        });
        await context.SaveChangesAsync(ct);
    }

    [Fact]
    public async Task ContractDraftsSaveAndSubmitWithKeysAndVersionsAndDiscardKeepsTheirHistory()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var (contract, version) = await DraftContractAsync(context, "QA-DRAFT-SUBMIT", null, false, ct, "BAGGAGE");
        async Task<ContractDraftData> DraftAsync() =>
            Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!, item => item.Id == version.PublicId);

        // 1-D, 1-N14: every cause has its code, the same the submission answers.
        var readiness = (await drafts.GetReadinessAsync(ContractsAdministrator, version.PublicId, ct)).Data!;
        Assert.False(readiness.Ready);
        Assert.Equal("Active", readiness.PortalAccount);
        Assert.Equal(["terms_missing", "rates_unconfirmed"], readiness.Issues.Select(item => item.Code));
        Assert.Equal(ContractDraftFailure.Forbidden,
            (await drafts.GetReadinessAsync(PortalAirlineAccount, version.PublicId, ct)).Failure);
        Assert.Equal(ContractDraftFailure.NotFound,
            (await drafts.GetReadinessAsync(ContractsAdministrator, Guid.NewGuid(), ct)).Failure);
        var initial = await DraftAsync();
        Assert.Equal("terms_missing", (await drafts.ActivateAsync(ContractsAdministrator, version.PublicId,
            new SubmitContractDraftInput(initial.Version), Guid.NewGuid(), ct)).Code);

        // Saving with a key needs the version; the key replays its result and a stale editor loses nothing.
        var save = new UpdateContractDraftInput(initial.ValidFrom, null, "USD", "Condiciones de prueba.",
            initial.Rates.Select(rate => new UpdateDraftRateInput(rate.Id, rate.BillingUnit, 128m, 1m, true)).ToArray(),
            null, initial.Version);
        Assert.Equal("expected_version_required", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            save with { ExpectedVersion = null }, Guid.NewGuid(), ct)).Code);
        Assert.Equal("idempotency_key_required", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            save, Guid.Empty, ct)).Code);
        var saveKey = Guid.NewGuid();
        Assert.True((await drafts.UpdateAsync(ContractsAdministrator, version.PublicId, save, saveKey, ct)).IsSuccess);
        Assert.Equal(version.PublicId, (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId, save, saveKey, ct)).Id);
        Assert.Equal("idempotency_conflict", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            save with { Terms = "Otras condiciones." }, saveKey, ct)).Code);
        Assert.Equal("version_conflict", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId, save with
        {
            Rates = initial.Rates.Select(rate => new UpdateDraftRateInput(rate.Id, rate.BillingUnit, 90m, 1m, true)).ToArray(),
        }, Guid.NewGuid(), ct)).Code);
        var saved = await DraftAsync();
        Assert.Equal(128m, Assert.Single(saved.Rates).UnitPrice);
        Assert.True((await drafts.GetReadinessAsync(ContractsAdministrator, version.PublicId, ct)).Data!.Ready);

        // «Enviar a Finanzas» expects the version the reviewer saw and replays its key.
        Assert.Equal("version_conflict", (await drafts.ActivateAsync(ContractsAdministrator, version.PublicId,
            new SubmitContractDraftInput(initial.Version), Guid.NewGuid(), ct)).Code);
        var submitKey = Guid.NewGuid();
        Assert.Equal(contract.PublicId, (await drafts.ActivateAsync(ContractsAdministrator, version.PublicId,
            new SubmitContractDraftInput(saved.Version), submitKey, ct)).Id);
        Assert.Equal(contract.PublicId, (await drafts.ActivateAsync(ContractsAdministrator, version.PublicId,
            new SubmitContractDraftInput(saved.Version), submitKey, ct)).Id);
        var pending = await DraftAsync();
        Assert.Equal("PendingFinanceApproval", pending.VersionStatus);
        Assert.Equal("draft_in_finance_review", (await drafts.ActivateAsync(ContractsAdministrator, version.PublicId,
            new SubmitContractDraftInput(pending.Version), Guid.NewGuid(), ct)).Code);
        Assert.Equal("draft_in_finance_review", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            save with { ExpectedVersion = pending.Version }, Guid.NewGuid(), ct)).Code);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item =>
            item.Action == "commercial.contract.submitted_to_finance" && item.EntityPublicId == version.PublicId, ct));
        // 1-N19: the Finance reviewer that covers PUJ got the alert.
        var financeKey = await AccountKeyAsync(context, FinanceAccount, ct);
        Assert.True(await context.DepartmentNotifications.AnyAsync(item => item.Kind == "contract_approval" &&
            item.SourceId == version.PublicId && item.RecipientAccountId == financeKey, ct));
        Assert.Contains((await book.ListContractApprovalsAsync(FinanceAccount, true, ct))!,
            item => item.VersionId == version.PublicId);

        // 1-N15: the airline comments while Finance reviews; Contratos answers from Borradores.
        var airlineDraft = Assert.Single((await drafts.ListForAirlineAsync(PortalAirlineAccount, ct))!,
            item => item.Id == version.PublicId);
        var comment = new AirlineDraftCommentInput("¿El precio incluye la operación nocturna?", airlineDraft.Version);
        var commentKey = Guid.NewGuid();
        var commented = await drafts.AddAirlineCommentAsync(PortalAirlineAccount, version.PublicId, comment, commentKey, ct);
        Assert.True(commented.IsSuccess, commented.Code);
        Assert.Equal(commented.Id, (await drafts.AddAirlineCommentAsync(PortalAirlineAccount, version.PublicId, comment,
            commentKey, ct)).Id);
        Assert.Equal("comment_required", (await drafts.AddAirlineCommentAsync(PortalAirlineAccount, version.PublicId,
            comment with { Body = "   " }, Guid.NewGuid(), ct)).Code);
        Assert.Equal("expected_version_required", (await drafts.AddAirlineCommentAsync(PortalAirlineAccount,
            version.PublicId, comment with { ExpectedVersion = null }, Guid.NewGuid(), ct)).Code);
        Assert.Equal(ContractDraftFailure.Forbidden, (await drafts.ReplyAsync(PortalAirlineAccount, version.PublicId,
            Guid.NewGuid(), new ReplyContractDraftInput(pending.Version, "Sin permiso."), ct)).Failure);
        var replied = await drafts.ReplyAsync(ContractsAdministrator, version.PublicId, Guid.NewGuid(),
            new ReplyContractDraftInput(pending.Version, "No: el recargo nocturno se cobra aparte."), ct);
        Assert.True(replied.IsSuccess, replied.Code);
        var portalComments = Assert.Single((await drafts.ListForAirlineAsync(PortalAirlineAccount, ct))!,
            item => item.Id == version.PublicId).Comments;
        Assert.Equal(2, portalComments.Count);
        Assert.True(portalComments[0].IsAirline);
        Assert.Equal(("Contratos AVIAM", false), (portalComments[1].Author, portalComments[1].IsAirline));
        Assert.NotEqual("Contratos AVIAM", (await DraftAsync()).Comments[1].Author);

        // 1-B: discarding needs the permission, a reason and the version; nothing is deleted.
        var current = await DraftAsync();
        var discard = new DiscardContractDraftInput(current.Version, RetireReason);
        Assert.Equal(ContractDraftFailure.Forbidden, (await drafts.DiscardAsync(PortalAirlineAccount, version.PublicId,
            Guid.NewGuid(), discard, ct)).Failure);
        Assert.Equal("reason_required", (await drafts.DiscardAsync(ContractsAdministrator, version.PublicId,
            Guid.NewGuid(), discard with { Reason = "no" }, ct)).Code);
        var discardKey = Guid.NewGuid();
        Assert.True((await drafts.DiscardAsync(ContractsAdministrator, version.PublicId, discardKey, discard, ct)).IsSuccess);
        Assert.Equal(version.PublicId, (await drafts.DiscardAsync(ContractsAdministrator, version.PublicId, discardKey,
            discard, ct)).Id);
        var closedVersion = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.Id == version.Id, ct);
        var closedContract = await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contract.Id, ct);
        Assert.Equal(ContractVersionStatus.Rejected, closedVersion.Status);
        // It was the only live version of a contract that never activated: the contract closes too.
        Assert.Equal(ContractStatus.Terminated, closedContract.Status);
        Assert.NotNull(closedContract.TerminatedOn);
        Assert.Equal(1, await context.Set<ContractStatusEvent>().CountAsync(item => item.ContractId == contract.Id &&
            item.FromStatus == ContractStatus.Draft && item.ToStatus == ContractStatus.Terminated && item.Reason == RetireReason, ct));
        Assert.Equal(1, await context.ContractServiceRates.CountAsync(item => item.ContractVersionId == version.Id, ct));
        Assert.Equal(2, await context.ContractDraftComments.CountAsync(item => item.ContractVersionId == version.Id, ct));
        Assert.Equal(1, await context.AuditEntries.CountAsync(item =>
            item.Action == "commercial.draft.discarded" && item.EntityPublicId == version.PublicId, ct));
        Assert.DoesNotContain((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!, item => item.Id == version.PublicId);
        Assert.DoesNotContain((await drafts.ListForAirlineAsync(PortalAirlineAccount, ct))!, item => item.Id == version.PublicId);
        Assert.Equal(0, (await drafts.GetOverviewForContractsAsync(ContractsAdministrator, ct))!.Count);
        Assert.DoesNotContain((await book.ListContractApprovalsAsync(FinanceAccount, true, ct))!,
            item => item.VersionId == version.PublicId);
        Assert.Equal("draft_closed", (await drafts.DiscardAsync(ContractsAdministrator, version.PublicId, Guid.NewGuid(),
            discard with { ExpectedVersion = Convert.ToBase64String(closedVersion.RowVersion) }, ct)).Code);
        Assert.Equal("draft_closed", (await drafts.AddAirlineCommentAsync(PortalAirlineAccount, version.PublicId,
            new AirlineDraftCommentInput("Otra pregunta."), null, ct)).Code);
        var timeline = (await lifecycle.TimelineAsync(ContractsAdministrator, version.PublicId, ct))!;
        Assert.Contains(timeline.Entries, entry => entry.Title == "Contratos descartó la versión 1");
        Assert.Contains(timeline.Entries, entry => entry.Title == "Contrato descartado antes de activarse" &&
            entry.Detail == RetireReason);
    }

    [Fact]
    public async Task ContractDraftScopeChangesServicesAndStationsAndKeepsRetiredServicesMarked()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var (_, version) = await DraftContractAsync(context, "QA-DRAFT-SCOPE", "Condiciones.", true, ct, "BAGGAGE");
        var puj = await context.Stations.AsNoTracking().SingleAsync(item => item.Code == "PUJ", ct);
        var baggage = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == "BAGGAGE", ct);
        async Task<ContractDraftData> DraftAsync() =>
            Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!, item => item.Id == version.PublicId);
        async Task<ContractDraftScopeData> ScopeAsync() =>
            (await drafts.GetScopeAsync(ContractsAdministrator, version.PublicId, ct)).Data!;
        async Task<string[]> IssuesAsync() =>
            (await drafts.GetReadinessAsync(ContractsAdministrator, version.PublicId, ct)).Data!.Issues
            .Select(item => item.Code).ToArray();

        // 1-N06: a PUJ base price wins over the all-stations one, in the editor as in Finance.
        var tariff = await context.ServiceTariffVersions.AsNoTracking()
            .SingleAsync(item => item.CurrencyCode == "USD" && item.Status == TariffVersionStatus.Published, ct);
        context.ServiceTariffRates.Add(new ServiceTariffRate
        {
            PublicId = Guid.CreateVersion7(), ServiceTariffVersionId = tariff.Id, ServiceDefinitionId = baggage.Id,
            StationId = puj.Id, BillingUnit = "operation", UnitPrice = 150m, MinimumBillableQuantity = 1m,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(ct);
        Assert.Equal(150m, Assert.Single((await DraftAsync()).Rates).BasePrice);
        // 1-N05: the airline never receives the Finance base prices or base charge values.
        var airlineView = Assert.Single((await drafts.ListForAirlineAsync(PortalAirlineAccount, ct))!,
            item => item.Id == version.PublicId);
        Assert.Null(Assert.Single(airlineView.Rates).BasePrice);
        Assert.All(airlineView.Charges!, charge => Assert.Null(charge.BaseValue));

        // A published USD package covers baggage and is linked to the draft.
        var saved = await packages.SaveAsync(FinanceAccount, null, new SavePackageInput(Guid.NewGuid(), "QA-BAG",
            "Equipaje QA", "USD", 300m, "Turnaround", null, null, new DateOnly(2026, 1, 1), null,
            [new PackageComponentInput(baggage.PublicId, "operation", 1m, 1m, 50m)], null), ct);
        Assert.True(saved.IsSuccess, saved.Code);
        var packageRow = Assert.Single((await packages.ListAsync(FinanceAccount, ct))!, item => item.Id == saved.Id);
        Assert.True((await packages.PublishAsync(FinanceAccount, saved.Id!.Value,
            new PackageCommandInput(Guid.NewGuid(), packageRow.Version), ct)).IsSuccess);
        Assert.True((await packages.SetContractPackagesAsync(ContractsAdministrator, version.PublicId,
            new SetContractPackagesInput(Guid.NewGuid(), (await DraftAsync()).Version, [saved.Id.Value]), ct)).IsSuccess);

        var scoped = await ScopeAsync();
        var bag = Assert.Single(scoped.Services, item => item.Selected);
        Assert.Equal(("BAGGAGE", true, true), (bag.Code, bag.IsActive, bag.CoveredByPackage));
        Assert.NotNull(bag.RateId);
        var cargo = Assert.Single(scoped.Services, item => item.Code == "RAMP-CARGO");
        Assert.False(cargo.Selected);
        Assert.Equal("PUJ", Assert.Single(scoped.Stations, item => item.Selected).Code);
        Assert.Equal("scope_invalid", (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId, Guid.NewGuid(),
            new SetContractDraftScopeInput(scoped.Version, [], [puj.PublicId]), ct)).Code);
        Assert.Equal("service_not_found", (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId,
            Guid.NewGuid(), new SetContractDraftScopeInput(scoped.Version, [Guid.NewGuid()], [puj.PublicId]), ct)).Code);
        Assert.Equal("stations_invalid", (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId,
            Guid.NewGuid(), new SetContractDraftScopeInput(scoped.Version, [baggage.PublicId], [Guid.NewGuid()]), ct)).Code);
        // A service that a linked package covers cannot leave the draft.
        Assert.Equal("service_in_package", (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId,
            Guid.NewGuid(), new SetContractDraftScopeInput(scoped.Version, [cargo.ServiceId], [puj.PublicId]), ct)).Code);

        // 1-N04: a new service and a second station; the new rate starts from the base tariff, unconfirmed.
        var mia = await SecondStationAsync(context, ct);
        var widen = new SetContractDraftScopeInput(scoped.Version, [baggage.PublicId, cargo.ServiceId], [puj.PublicId, mia.PublicId]);
        var widenKey = Guid.NewGuid();
        Assert.True((await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId, widenKey, widen, ct)).IsSuccess);
        Assert.Equal(version.PublicId, (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId, widenKey,
            widen, ct)).Id);
        Assert.Equal("version_conflict", (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId,
            Guid.NewGuid(), widen, ct)).Code);
        var widened = await DraftAsync();
        Assert.Equal(2, widened.Stations.Count);
        var cargoRate = Assert.Single(widened.Rates, item => item.ServiceName == "Carga y descarga");
        // 1-E: the seed gives every public service a base price; the new rate starts from it, by unit code.
        Assert.Equal((85m, false, (decimal?)85m, "operation"),
            (cargoRate.UnitPrice, cargoRate.IsConfirmed, cargoRate.BasePrice, cargoRate.BillingUnit));
        // With two stations the base is the all-stations tariff, as Finance compares it.
        Assert.Equal(130m, Assert.Single(widened.Rates, item => item.ServiceName == "Baggage handling").BasePrice);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item =>
            item.Action == "commercial.draft.scope_changed" && item.EntityPublicId == version.PublicId, ct));

        // 1-N19: Finance must cover every station of the version before the draft is sent.
        Assert.Equal(["rates_unconfirmed", "finance_reviewer_missing"], await IssuesAsync());
        var financeKey = await AccountKeyAsync(context, FinanceAccount, ct);
        var contractsKey = await AccountKeyAsync(context, ContractsAdministrator, ct);
        Assert.Empty(await StationScopeCoverage.CoveringAsync(context, [financeKey, contractsKey], [puj.Id, mia.Id],
            DateTimeOffset.UtcNow, ct));
        await GrantStationAsync(context, FinanceAccount, mia.Id, ct);
        await GrantStationAsync(context, ContractsAdministrator, mia.Id, ct);
        Assert.Equal(new[] { contractsKey, financeKey }.Order(), (await StationScopeCoverage.CoveringAsync(context,
            [financeKey, contractsKey], [puj.Id, mia.Id], DateTimeOffset.UtcNow, ct)).Order());
        Assert.Equal(["rates_unconfirmed"], await IssuesAsync());

        // 1-N10: a retired service stays in the draft, marked, and blocks it until Contratos removes it.
        await context.ServiceDefinitions.Where(item => item.Code == "RAMP-CARGO" || item.Code == "RAMP-TOW")
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false), ct);
        var retired = (await drafts.GetReadinessAsync(ContractsAdministrator, version.PublicId, ct)).Data!;
        Assert.Equal(["RAMP-CARGO · Carga y descarga"], retired.Issues.Single(item => item.Code == "service_retired").Subjects);
        var withRetired = await ScopeAsync();
        Assert.Contains(withRetired.Services, item => item.Code == "RAMP-CARGO" && item.Selected && !item.IsActive);
        Assert.DoesNotContain(withRetired.Services, item => item.Code == "RAMP-TOW");
        var tow = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == "RAMP-TOW", ct);
        Assert.Equal("service_retired", (await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId,
            Guid.NewGuid(), new SetContractDraftScopeInput(withRetired.Version, [baggage.PublicId, cargo.ServiceId, tow.PublicId],
                [puj.PublicId, mia.PublicId]), ct)).Code);

        // 1-N07: a currency the linked package does not have is refused; changing it unconfirms every rate.
        var beforeCurrency = await DraftAsync();
        var confirmAll = new UpdateContractDraftInput(beforeCurrency.ValidFrom, null, "USD", "Condiciones.",
            beforeCurrency.Rates.Select(rate => new UpdateDraftRateInput(rate.Id, rate.BillingUnit, 100m, 1m, true)).ToArray(),
            null, beforeCurrency.Version);
        Assert.Equal("package_not_eligible", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            confirmAll with { CurrencyCode = "DOP" }, Guid.NewGuid(), ct)).Code);
        Assert.Equal("package_not_eligible", (await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            confirmAll with { ValidFrom = new DateOnly(2025, 12, 1) }, Guid.NewGuid(), ct)).Code);
        Assert.True((await packages.SetContractPackagesAsync(ContractsAdministrator, version.PublicId,
            new SetContractPackagesInput(Guid.NewGuid(), beforeCurrency.Version, []), ct)).IsSuccess);
        var unlinked = await DraftAsync();
        // Contratos negotiates charges in dollars: a fixed fee, a percentage and an exclusion.
        Guid ChargeId(string code) => unlinked.Charges!.Single(item => item.Code == code).ChargeId;
        UpdateDraftChargeInput[] negotiated =
            [new(ChargeId("ADMIN-FEE"), false, 50m), new(ChargeId("NIGHT"), false, 20m), new(ChargeId("DELAY"), true, null)];
        Assert.True((await drafts.UpdateAsync(ContractsAdministrator, version.PublicId,
            confirmAll with { ChargeRates = negotiated, ExpectedVersion = unlinked.Version }, Guid.NewGuid(), ct)).IsSuccess);
        var inDollars = await DraftAsync();
        Assert.Equal(50m, inDollars.Charges!.Single(item => item.Code == "ADMIN-FEE").Value);
        // The same charges saved with pesos: every rate is unconfirmed and the fee of 50 is not read as 50 pesos,
        // it goes back to the Finance base in pesos; the percentage and the exclusion do not depend on the currency.
        Assert.True((await drafts.UpdateAsync(ContractsAdministrator, version.PublicId, confirmAll with
        {
            CurrencyCode = "DOP", ChargeRates = negotiated, ExpectedVersion = inDollars.Version,
        }, Guid.NewGuid(), ct)).IsSuccess);
        var inPesos = await DraftAsync();
        Assert.Equal("DOP", inPesos.CurrencyCode);
        Assert.All(inPesos.Rates, rate => Assert.False(rate.IsConfirmed));
        var fee = inPesos.Charges!.Single(item => item.Code == "ADMIN-FEE");
        Assert.Equal(((decimal?)null, false, (decimal?)877.5m), (fee.Value, fee.IsExcluded, fee.BaseValue));
        Assert.Equal(20m, inPesos.Charges!.Single(item => item.Code == "NIGHT").Value);
        Assert.True(inPesos.Charges!.Single(item => item.Code == "DELAY").IsExcluded);
        Assert.Equal(2, await context.ContractChargeRates.CountAsync(item => item.ContractVersionId == version.Id, ct));

        // Removing the retired service clears the block; the remaining rates are confirmed again.
        Assert.True((await drafts.SetScopeAsync(ContractsAdministrator, version.PublicId, Guid.NewGuid(),
            new SetContractDraftScopeInput(inPesos.Version, [baggage.PublicId], [puj.PublicId, mia.PublicId]), ct)).IsSuccess);
        var trimmed = await DraftAsync();
        Assert.Equal("Baggage handling", Assert.Single(trimmed.Rates).ServiceName);
        Assert.True((await drafts.UpdateAsync(ContractsAdministrator, version.PublicId, new UpdateContractDraftInput(
            trimmed.ValidFrom, null, "DOP", "Condiciones.",
            trimmed.Rates.Select(rate => new UpdateDraftRateInput(rate.Id, rate.BillingUnit, 7000m, 1m, true)).ToArray(),
            null, trimmed.Version), Guid.NewGuid(), ct)).IsSuccess);
        Assert.Empty(await IssuesAsync());

        // 1-N07: a client that sends no charges changes the currency too. Amounts stored in pesos go back to the
        // base: a per-hour value, and a percentage with a minimum in pesos (an amendment copies both from the
        // approved version); the exclusion and the plain percentage stay.
        var stored = await context.ChargeDefinitions.AsNoTracking().Where(item => item.Code == "OVERTIME" || item.Code == "HOLIDAY")
            .ToDictionaryAsync(item => item.Code, item => item.Id, ct);
        var copiedAt = DateTimeOffset.UtcNow;
        context.ContractChargeRates.AddRange(
            new ContractChargeRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, ChargeDefinitionId = stored["OVERTIME"],
                Value = 2632.5m, MinimumAmount = 0m, CreatedAt = copiedAt, UpdatedAt = copiedAt,
            },
            new ContractChargeRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, ChargeDefinitionId = stored["HOLIDAY"],
                Value = 10m, MinimumAmount = 500m, CreatedAt = copiedAt, UpdatedAt = copiedAt,
            });
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        var withCopies = await DraftAsync();
        Assert.True((await drafts.UpdateAsync(ContractsAdministrator, version.PublicId, new UpdateContractDraftInput(
            withCopies.ValidFrom, null, "USD", "Condiciones.",
            withCopies.Rates.Select(rate => new UpdateDraftRateInput(rate.Id, rate.BillingUnit, 120m, 1m, true)).ToArray(),
            null, withCopies.Version), Guid.NewGuid(), ct)).IsSuccess);
        var backInDollars = await DraftAsync();
        Assert.Equal([("DELAY", true, (decimal?)null), ("NIGHT", false, (decimal?)20m)], backInDollars.Charges!
            .Where(item => item.IsExcluded || item.Value is not null).Select(item => (item.Code, item.IsExcluded, item.Value))
            .OrderBy(item => item.Code, StringComparer.Ordinal));
        Assert.Equal(["rates_unconfirmed"], await IssuesAsync());
    }

    [Fact]
    public async Task FinanceDecisionsCodeEachBlockingCauseReplayTheirKeyAndTellContratos()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var (_, version) = await DraftContractAsync(context, "QA-DRAFT-FINANCE", "Condiciones.", true, ct, "BAGGAGE", "RAMP-AC");
        async Task<ContractDraftData> DraftAsync() =>
            Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!, item => item.Id == version.PublicId);
        async Task<string> PendingVersionAsync() =>
            (await book.GetContractApprovalAsync(FinanceAccount, version.PublicId, ct))!.Summary.Version;
        async Task SubmitAsync() => Assert.True((await drafts.ActivateAsync(ContractsAdministrator, version.PublicId,
            new SubmitContractDraftInput((await DraftAsync()).Version), Guid.NewGuid(), ct)).IsSuccess);
        var contractsKey = await AccountKeyAsync(context, ContractsAdministrator, ct);
        await SubmitAsync();

        // Finance returns it with an internal reason; Contratos is told, the airline only sees the return (1-N05).
        const string reason = "Margen negativo; no bajar de 180 USD.";
        Assert.Equal("expected_version_required", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Returned", reason, ""), Guid.NewGuid(), ct)).Code);
        Assert.Equal("invalid_contract_decision", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Returned", null, await PendingVersionAsync()), Guid.NewGuid(), ct)).Code);
        Assert.True((await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Returned", reason, await PendingVersionAsync()), Guid.NewGuid(), ct)).IsSuccess);
        Assert.True(await context.DepartmentNotifications.AnyAsync(item => item.Kind == "contract_returned" &&
            item.SourceId == version.PublicId && item.RecipientAccountId == contractsKey, ct));
        var internalView = await DraftAsync();
        Assert.Equal(("Returned", reason), (internalView.FinanceDecision, internalView.FinanceReason));
        var airlineView = Assert.Single((await drafts.ListForAirlineAsync(PortalAirlineAccount, ct))!,
            item => item.Id == version.PublicId);
        Assert.Equal(("Returned", null), (airlineView.FinanceDecision, airlineView.FinanceReason));
        var returnedEntry = (await lifecycle.TimelineAsync(PortalAirlineAccount, version.PublicId, ct))!.Entries
            .Single(entry => entry.Title == "Finanzas devolvió la versión a Contratos");
        Assert.Null(returnedEntry.Detail);
        Assert.Null(returnedEntry.Actor);
        Assert.Equal(reason, (await lifecycle.TimelineAsync(ContractsAdministrator, version.PublicId, ct))!.Entries
            .Single(entry => entry.Title == "Finanzas devolvió la versión a Contratos").Detail);
        await SubmitAsync();

        // 1-N10: a service retired while Finance reviews blocks the approval with its code.
        await context.ServiceDefinitions.Where(item => item.Code == "RAMP-AC")
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false), ct);
        Assert.Equal("service_retired", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Approved", null, await PendingVersionAsync()), Guid.NewGuid(), ct)).Code);
        await context.ServiceDefinitions.Where(item => item.Code == "RAMP-AC")
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, true), ct);

        // 1-N07: a package outside the version's currency blocks it too, with its own code.
        var baggage = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == "BAGGAGE", ct);
        var saved = await packages.SaveAsync(FinanceAccount, null, new SavePackageInput(Guid.NewGuid(), "QA-DOP",
            "Paquete en pesos", "DOP", 9000m, "Turnaround", null, null, new DateOnly(2026, 1, 1), null,
            [new PackageComponentInput(baggage.PublicId, "operation", 1m, 1m, 500m)], null), ct);
        var packageRow = Assert.Single((await packages.ListAsync(FinanceAccount, ct))!, item => item.Id == saved.Id);
        Assert.True((await packages.PublishAsync(FinanceAccount, saved.Id!.Value,
            new PackageCommandInput(Guid.NewGuid(), packageRow.Version), ct)).IsSuccess);
        var packageKey = await context.Set<ServicePackageVersion>().AsNoTracking()
            .Where(item => item.PublicId == saved.Id).Select(item => item.Id).SingleAsync(ct);
        var link = new ContractServicePackage
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, PackageVersionId = packageKey,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Set<ContractServicePackage>().Add(link);
        await context.SaveChangesAsync(ct);
        Assert.Equal("package_not_eligible", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Approved", null, await PendingVersionAsync()), Guid.NewGuid(), ct)).Code);
        context.Set<ContractServicePackage>().Remove(link);
        await context.SaveChangesAsync(ct);

        // The approval replays its key; the key cannot carry another decision; Contratos is told.
        var approval = new DecideContractApprovalInput("Approved", null, await PendingVersionAsync());
        var key = Guid.NewGuid();
        var approved = await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId, approval, key, ct);
        Assert.True(approved.IsSuccess, approved.Code);
        Assert.Equal(version.PublicId, (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId, approval,
            key, ct)).Id);
        Assert.Equal("idempotency_conflict", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            approval with { Decision = "Returned", Reason = "Otro motivo." }, key, ct)).Code);
        Assert.Equal("version_conflict", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            approval, Guid.NewGuid(), ct)).Code);
        Assert.Equal(1, await context.ContractFinanceReviews.CountAsync(item =>
            item.ContractVersionId == version.Id && item.Decision == ContractFinanceDecision.Approved, ct));
        Assert.True(await context.DepartmentNotifications.AnyAsync(item => item.Kind == "contract_approved" &&
            item.SourceId == version.PublicId && item.RecipientAccountId == contractsKey, ct));
    }

    [Fact]
    public async Task DiscardingARenewalKeepsTheContractAndDiscardingANeverActiveContractClosesItsVersions()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);
        async Task<Contract> ContractAsync() => await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct);

        // A renewal draft that does not prosper is discarded; the contract stays active and can renew again.
        var renewal = await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion, new ContractLifecycleInput(
            "Renew", "Renovación anual", "Active", new DateOnly(2100, 1, 1), new DateOnly(2100, 12, 31)), Guid.NewGuid(), ct);
        Assert.NotNull(renewal.DraftVersionId);
        var renewalDraft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.Id == renewal.DraftVersionId);
        Assert.True((await drafts.DiscardAsync(ContractsAdministrator, renewalDraft.Id, Guid.NewGuid(),
            new DiscardContractDraftInput(renewalDraft.Version, "La aerolínea no renueva este año."), ct)).IsSuccess);
        Assert.Equal(ContractStatus.Active, (await ContractAsync()).Status);
        var again = await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion, new ContractLifecycleInput(
            "Renew", "Renovación acordada", "Active", new DateOnly(2100, 1, 1), null), null, ct);
        Assert.Null(again.Code);
        Assert.NotEqual(renewal.DraftVersionId, again.DraftVersionId);

        // «Descartar contrato»: a contract that never activated, with its approved version unsigned and a
        // version awaiting Finance, closes; the open version leaves the Finance inbox and nothing signs.
        await context.Contracts.Where(item => item.Id == contractId).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractStatus.Draft).SetProperty(item => item.SignedOn, (DateOnly?)null), ct);
        await context.ContractVersions.Where(item => item.PublicId == again.DraftVersionId).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractVersionStatus.PendingFinanceApproval), ct);
        Assert.Contains((await book.ListContractApprovalsAsync(FinanceAccount, true, ct))!,
            item => item.VersionId == again.DraftVersionId);
        var terminate = new ContractLifecycleInput("Terminate", RetireReason, "Draft");
        var terminateKey = Guid.NewGuid();
        Assert.Equal("expected_version_required", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            terminate with { ExpectedStatus = " " }, terminateKey, ct)).Code);
        Assert.Equal("idempotency_key_required", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            terminate, Guid.Empty, ct)).Code);
        Assert.Equal("Terminated", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion, terminate,
            terminateKey, ct)).Status);
        Assert.Equal("Terminated", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion, terminate,
            terminateKey, ct)).Status);
        Assert.Equal("idempotency_conflict", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            terminate with { Reason = "Otro motivo de cierre." }, terminateKey, ct)).Code);
        Assert.Equal("transition_not_allowed", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            terminate with { ExpectedStatus = "Terminated" }, Guid.NewGuid(), ct)).Code);
        Assert.Equal(ContractStatus.Terminated, (await ContractAsync()).Status);
        Assert.Equal(ContractVersionStatus.Rejected, await context.ContractVersions.AsNoTracking()
            .Where(item => item.PublicId == again.DraftVersionId).Select(item => item.Status).SingleAsync(ct));
        Assert.Equal(ContractVersionStatus.Approved, await context.ContractVersions.AsNoTracking()
            .Where(item => item.PublicId == SeededContractVersion).Select(item => item.Status).SingleAsync(ct));
        Assert.DoesNotContain((await book.ListContractApprovalsAsync(FinanceAccount, true, ct))!,
            item => item.VersionId == again.DraftVersionId);
        Assert.Equal(1, await context.Set<ContractStatusEvent>().CountAsync(item => item.ContractId == contractId &&
            item.FromStatus == ContractStatus.Draft && item.ToStatus == ContractStatus.Terminated, ct));
        var document = (await documents.ReadAsync(PortalAirlineAccount, SeededContractVersion, ct)).Document!;
        Assert.Null(document.SignableBy);
        var signed = await documents.SignAsync(PortalAirlineAccount, SeededContractVersion, new SignContractInput(
            Guid.NewGuid(), "Casey Airline", "Director", document.ContentSha256, true, SignaturePng), ct);
        Assert.Equal(("contract_terminated", ContractDocumentFailure.Conflict), (signed.Code, signed.Failure));
    }

    /// <summary>
    /// 1-B: «Descartar contrato» committed while Contratos confirms the validity, or while the airline signs, wins.
    /// Each command reads the contract before its checks and writes it, so its rowversion refuses the write with
    /// <c>contract_terminated</c> instead of confirming or signing a closed contract.
    /// </summary>
    [Fact]
    public async Task ATerminationCommittedWhileTheValidityOrASignatureIsWrittenRefusesTheWrite()
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
        var actors = scope.ServiceProvider.GetRequiredService<IActorContextResolver>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var version = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion, ct);
        async Task<Contract> ContractAsync() =>
            await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == version.ContractId, ct);
        // A contract that never activated: its approved version waits for the validity and both signatures.
        async Task ReopenAsync() => await context.Contracts.Where(item => item.Id == version.ContractId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, ContractStatus.Draft)
                .SetProperty(item => item.SignedOn, (DateOnly?)null).SetProperty(item => item.TerminatedOn, (DateOnly?)null), ct);
        // The command's save waits at the gate, after every check, while «Descartar contrato» commits.
        async Task<ContractDocumentResult> RaceAsync(Func<IContractDocumentStore, Task<ContractDocumentResult>> command)
        {
            var gate = new SavingChangesGate();
            await using var gated = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>()
                .UseSqlServer(database.ConnectionString, ElevantSqlServerOptions.Configure).AddInterceptors(gate).Options);
            var running = command(new EfContractDocumentStore(gated, actors, TimeProvider.System));
            await gate.Entered.WaitAsync(TimeSpan.FromSeconds(15), ct);
            try
            {
                Assert.Equal("Terminated", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
                    new ContractLifecycleInput("Terminate", RetireReason, "Draft"), Guid.NewGuid(), ct)).Status);
            }
            finally
            {
                gate.Release();
            }
            return await running;
        }

        // Contratos confirms the validity: nothing is confirmed and the final code is not assigned.
        await ReopenAsync();
        var draftCode = (await ContractAsync()).ContractCode;
        var unconfirmed = (await documents.ReadAsync(ContractsAdministrator, SeededContractVersion, ct)).Document!;
        var confirmation = await RaceAsync(store => store.SetValidityAsync(ContractsAdministrator, SeededContractVersion,
            new ContractValidityInput(today, today.AddYears(1).AddDays(-1), "Automatic", 12, 30, 60,
                "Incumplimiento grave de pago.", unconfirmed.ContentSha256), ct));
        Assert.Equal(("contract_terminated", ContractDocumentFailure.Conflict), (confirmation.Code, confirmation.Failure));
        Assert.Null((await context.ContractVersions.AsNoTracking().SingleAsync(item => item.Id == version.Id, ct))
            .ValidityConfirmedAt);
        Assert.Equal(draftCode, (await ContractAsync()).ContractCode);

        // The airline signs: no signature, no signing date, no audit and no notice to Contratos.
        await ReopenAsync();
        var hash = await ConfirmValidityAsync(documents, SeededContractVersion, today, ct);
        var signature = await RaceAsync(store => store.SignAsync(PortalAirlineAccount, SeededContractVersion,
            new SignContractInput(Guid.NewGuid(), "Casey Airline", "Director", hash, true, SignaturePng), ct));
        Assert.Equal(("contract_terminated", ContractDocumentFailure.Conflict), (signature.Code, signature.Failure));
        Assert.False(await context.ContractSignatures.AnyAsync(item => item.ContractVersionId == version.Id, ct));
        var closed = await ContractAsync();
        Assert.Equal((ContractStatus.Terminated, (DateOnly?)null), (closed.Status, closed.SignedOn));
        Assert.False(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.contract.signed" &&
            item.EntityPublicId == SeededContractVersion, ct));
        Assert.False(await context.DepartmentNotifications.AnyAsync(item => item.Kind == "contract_signed" &&
            item.SourceId == SeededContractVersion, ct));
    }
}
