using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 1, block C: contract amendments (1-C), unit codes and the seeded base tariff (1-E), coded
/// Finance failures with the Idempotency-Key of the tariff books and the discard and retirement of
/// packages (1-N27), through the stores only.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task ContractAmendmentNeedsTheStationScopeOfTheApprovedVersionItCopies()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var contract = await context.Contracts.AsNoTracking().SingleAsync(item => item.ContractCode == "DEV-CONTRACT-0001", ct);
        var original = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.ContractId == contract.Id, ct);
        var puj = await context.Stations.AsNoTracking().SingleAsync(item => item.Code == "PUJ", ct);
        var second = await SecondStationAsync(context, ct);

        // A renewal added a second station: v1 (PUJ only) was replaced by the approved and signed v2 (PUJ and MIA).
        var renewalStart = new DateOnly(2026, 9, 1);
        var now = DateTimeOffset.UtcNow;
        var renewal = new ContractVersion
        {
            PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = original.VersionNumber + 1,
            Status = ContractVersionStatus.Approved, CurrencyCode = original.CurrencyCode, ValidFrom = renewalStart,
            ValidTo = original.ValidTo, Terms = original.Terms, ApprovedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractVersions.Add(renewal);
        await context.SaveChangesAsync(ct);
        context.Set<ContractVersionStation>().AddRange(
            new ContractVersionStation { ContractVersionId = renewal.Id, StationId = puj.Id },
            new ContractVersionStation { ContractVersionId = renewal.Id, StationId = second.Id });
        await context.SaveChangesAsync(ct);
        // 2-C: the renewal governs because both parties signed it over the same content.
        var signer = await context.Users.AsNoTracking().OrderBy(user => user.Id).Select(user => user.Id).FirstAsync(ct);
        var content = new string('a', 64);
        context.ContractSignatures.AddRange(
            new ContractSignature
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = renewal.Id, Party = ContractSignatureParty.Airline,
                SignerAccountId = signer, SignerName = "Casey Airline", SignerTitle = "Director", SignedAt = now,
                DocumentSha256 = content, RequestId = Guid.NewGuid(), CreatedAt = now, UpdatedAt = now,
            },
            new ContractSignature
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = renewal.Id, Party = ContractSignatureParty.Aviam,
                SignerAccountId = signer, SignerName = "AVIAM Contratos", SignerTitle = "Gerente", SignedAt = now,
                DocumentSha256 = content, RequestId = Guid.NewGuid(), CreatedAt = now, UpdatedAt = now,
            });
        await context.SaveChangesAsync(ct);
        await context.ContractVersions.Where(item => item.Id == original.Id).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractVersionStatus.Superseded)
            .SetProperty(item => item.ValidTo, renewalStart.AddDays(-1)), ct);
        context.ChangeTracker.Clear();
        var amendment = new CreateAmendmentInput("Active", renewalStart.AddDays(30));

        // Contratos covers PUJ only: the old version in the route is in its scope, the approved one copied is not.
        Assert.Equal("not_found",
            (await packages.CreateAmendmentAsync(ContractsAccount, original.PublicId, Guid.NewGuid(), amendment, ct)).Code);
        Assert.Equal("not_found",
            (await packages.CreateAmendmentAsync(ContractsAccount, renewal.PublicId, Guid.NewGuid(), amendment, ct)).Code);
        // Not even the state of the contract is answered, and nothing was created or announced.
        Assert.Equal("not_found", (await packages.CreateAmendmentAsync(ContractsAccount, original.PublicId, Guid.NewGuid(),
            amendment with { ExpectedStatus = "Suspended" }, ct)).Code);
        Assert.Equal(2, await context.ContractVersions.CountAsync(item => item.ContractId == contract.Id, ct));
        Assert.False(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.contract.amendment_created", ct));

        // With both stations in scope the amendment starts from v2 and keeps its two stations.
        await GrantStationAsync(context, ContractsAccount, second.Id, ct);
        var created = await packages.CreateAmendmentAsync(ContractsAccount, original.PublicId, Guid.NewGuid(), amendment, ct);
        Assert.True(created.IsSuccess, created.Code);
        var copied = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                            join version in context.ContractVersions.AsNoTracking() on link.ContractVersionId equals version.Id
                            where version.PublicId == created.Id
                            select link.StationId).ToArrayAsync(ct);
        Assert.Equal(new[] { puj.Id, second.Id }.Order(), copied.Order());
    }

    [Fact]
    public async Task ContractAmendmentStartsAfterTheApprovedVersionAndFinanceApprovesIt()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var contract = await context.Contracts.AsNoTracking().SingleAsync(item => item.ContractCode == "DEV-CONTRACT-0001", ct);
        var original = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.ContractId == contract.Id, ct);
        Assert.Equal((ContractStatus.Active, ContractVersionStatus.Approved), (contract.Status, original.Status));
        // 2-N03: the version in force exempts the night surcharge, negotiated before Finance approved it, and carries the
        // overtime value Finance only inherited from the base tariff at that approval. The package store clears the
        // change tracker, so these rows are saved before the first command.
        var night = await context.ChargeDefinitions.AsNoTracking().SingleAsync(item => item.Code == "NIGHT", ct);
        var overtime = await context.ChargeDefinitions.AsNoTracking().SingleAsync(item => item.Code == "OVERTIME", ct);
        var approvedAt = original.ApprovedAt!.Value;
        context.ContractChargeRates.AddRange(
            new ContractChargeRate { PublicId = Guid.NewGuid(), ContractVersionId = original.Id, ChargeDefinitionId = night.Id,
                IsExcluded = true, CreatedAt = approvedAt.AddDays(-1), UpdatedAt = approvedAt.AddDays(-1) },
            new ContractChargeRate { PublicId = Guid.NewGuid(), ContractVersionId = original.Id, ChargeDefinitionId = overtime.Id,
                Value = 45m, MinimumAmount = 0m, CreatedAt = approvedAt, UpdatedAt = approvedAt });
        await context.SaveChangesAsync(ct);
        async Task<ContractChargeRate[]> ChargesAsync(Guid versionId) => await (
            from rate in context.ContractChargeRates.AsNoTracking()
            join version in context.ContractVersions.AsNoTracking() on rate.ContractVersionId equals version.Id
            where version.PublicId == versionId
            select rate).ToArrayAsync(ct);
        var start = new DateOnly(2026, 9, 1);
        var amendment = new CreateAmendmentInput("Active", start);
        Task<PackageWriteResult> AmendAsync(Guid actor, Guid key, CreateAmendmentInput input, Guid? versionId = null) =>
            packages.CreateAmendmentAsync(actor, versionId ?? original.PublicId, key, input, ct);

        // Only Contratos amends, with its key and the contract status it saw.
        Assert.Equal("forbidden", (await AmendAsync(FinanceAccount, Guid.NewGuid(), amendment)).Code);
        Assert.Equal("idempotency_key_required", (await AmendAsync(ContractsAccount, Guid.Empty, amendment)).Code);
        Assert.Equal("expected_version_required",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ExpectedStatus = " " })).Code);
        Assert.Equal("invalid_amendment",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ExpectedStatus = "Unknown" })).Code);
        Assert.Equal("version_conflict",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ExpectedStatus = "Suspended" })).Code);
        Assert.Equal("not_found", (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment, Guid.NewGuid())).Code);
        // 1-C: «Vigente desde» falls after the start of the approved version and not after its end.
        Assert.Equal("valid_from_not_after_current",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ValidFrom = original.ValidFrom })).Code);
        Assert.Equal("valid_from_after_current_end", (await AmendAsync(ContractsAccount, Guid.NewGuid(),
            amendment with { ValidFrom = original.ValidTo!.Value.AddDays(1) })).Code);

        var key = Guid.NewGuid();
        var created = await AmendAsync(ContractsAccount, key, amendment);
        Assert.True(created.IsSuccess, created.Code);
        Assert.Equal(created.Id, (await AmendAsync(ContractsAccount, key, amendment)).Id);
        Assert.Equal("idempotency_conflict",
            (await AmendAsync(ContractsAccount, key, amendment with { ValidFrom = start.AddDays(1) })).Code);
        Assert.Equal("draft_in_progress",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ValidFrom = start.AddDays(1) })).Code);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item =>
            item.Action == "commercial.contract.amendment_created" && item.EntityPublicId == created.Id, ct));
        // 2-N03: the amendment copies the negotiated exemption, not the value Finance only inherited.
        var copiedCharge = Assert.Single(await ChargesAsync(created.Id!.Value));
        Assert.Equal((night.Id, true, (decimal?)null), (copiedCharge.ChargeDefinitionId, copiedCharge.IsExcluded,
            copiedCharge.Value));

        // The draft inherits the end, the stations, the terms and the prices, unconfirmed and by unit code.
        var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAccount, ct))!, item => item.Id == created.Id);
        Assert.Equal((start, original.ValidTo, "Draft", original.CurrencyCode, original.Terms),
            (draft.ValidFrom, draft.ValidTo, draft.VersionStatus, draft.CurrencyCode, draft.Terms));
        var originalPrices = await context.ContractServiceRates.AsNoTracking()
            .Where(item => item.ContractVersionId == original.Id).Select(item => item.UnitPrice).ToArrayAsync(ct);
        Assert.Equal(originalPrices.Order(), draft.Rates.Select(rate => rate.UnitPrice).Order());
        Assert.All(draft.Rates, rate => Assert.Equal(("operation", false), (rate.BillingUnit, rate.IsConfirmed)));
        Assert.Equal(["PUJ · AVIAM PUJ Development"], draft.Stations);
        Assert.Equal(["rates_unconfirmed"],
            (await drafts.GetReadinessAsync(ContractsAccount, draft.Id, ct)).Data!.Issues.Select(item => item.Code));

        // Contratos confirms the new prices and submits it; Finance approves it as it is.
        Assert.True((await drafts.UpdateAsync(ContractsAccount, draft.Id, new UpdateContractDraftInput(draft.ValidFrom,
            draft.ValidTo, draft.CurrencyCode, draft.Terms!, draft.Rates.Select(rate => new UpdateDraftRateInput(rate.Id,
                rate.BillingUnit, rate.UnitPrice + 5m, rate.MinimumQuantity, true)).ToArray(), null, draft.Version),
            Guid.NewGuid(), ct)).IsSuccess);
        var confirmed = Assert.Single((await drafts.ListForContractsAsync(ContractsAccount, ct))!, item => item.Id == created.Id);
        var submitted = await drafts.ActivateAsync(ContractsAccount, draft.Id, new SubmitContractDraftInput(confirmed.Version),
            Guid.NewGuid(), ct);
        Assert.True(submitted.IsSuccess, submitted.Code);
        var pending = (await book.GetContractApprovalAsync(FinanceAccount, draft.Id, ct))!;
        // 1-F: Finance sees that the contract is already active, so approving replaces the version in force.
        Assert.Equal(("PendingFinanceApproval", "Active"), (pending.Summary.Status, pending.Summary.ContractStatus));
        Assert.Equal("Active", Assert.Single((await book.ListContractApprovalsAsync(FinanceAccount, true, ct))!,
            item => item.VersionId == draft.Id).ContractStatus);
        var decided = await book.DecideContractApprovalAsync(FinanceAccount, draft.Id,
            new DecideContractApprovalInput("Approved", null, pending.Summary.Version), Guid.NewGuid(), ct);
        Assert.True(decided.IsSuccess, decided.Code);
        context.ChangeTracker.Clear();
        // 2-C: Finance approval alone replaces nothing; the version in force keeps its end until both sign.
        var kept = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.Id == original.Id, ct);
        Assert.Equal((ContractVersionStatus.Approved, original.ValidTo), (kept.Status, kept.ValidTo));
        Assert.Equal(ContractVersionStatus.Approved,
            (await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == created.Id, ct)).Status);
        // 2-N01: no other amendment starts while one approved version waits for both signatures.
        Assert.Equal("version_awaiting_signatures",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ValidFrom = start.AddDays(5) })).Code);
        await SignByBothAsync(scope.ServiceProvider.GetRequiredService<IContractDocumentStore>(), created.Id!.Value, ct);
        context.ChangeTracker.Clear();
        var replaced = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.Id == original.Id, ct);
        Assert.Equal((ContractVersionStatus.Superseded, (DateOnly?)start.AddDays(-1)), (replaced.Status, replaced.ValidTo));

        // The next amendment starts from the version just signed; an expired contract is renewed instead.
        Assert.Equal("valid_from_not_after_current",
            (await AmendAsync(ContractsAccount, Guid.NewGuid(), amendment with { ValidFrom = start })).Code);
        await context.Contracts.Where(item => item.Id == contract.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, ContractStatus.Expired), ct);
        Assert.Equal("contract_not_amendable", (await AmendAsync(ContractsAccount, Guid.NewGuid(),
            new CreateAmendmentInput("Expired", start.AddDays(10)))).Code);

        // 2-N03: approving the amendment froze the base overtime value of its own start, still as inherited, so a
        // renewal from it copies the exemption and never takes that base value as negotiated.
        Assert.Contains(await ChargesAsync(created.Id!.Value), rate => rate.ChargeDefinitionId == overtime.Id && !rate.IsExcluded);
        var renewal = await scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>().ApplyAsync(ContractsAccount,
            created.Id!.Value, new ContractLifecycleInput("Renew", "Renovación después de la enmienda", "Expired",
                new DateOnly(2027, 1, 1), new DateOnly(2027, 12, 31)), Guid.NewGuid(), ct);
        Assert.Null(renewal.Code);
        var renewed = Assert.Single(await ChargesAsync(renewal.DraftVersionId!.Value));
        Assert.Equal((night.Id, true), (renewed.ChargeDefinitionId, renewed.IsExcluded));
    }

    [Fact]
    public async Task FinanceDiscardsOrRetiresPackagesWithAReasonAndARetiredOneBlocksTheDraft()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var baggage = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == "BAGGAGE", ct);
        async Task<PackageData> PackageAsync(Guid id) =>
            Assert.Single((await packages.ListAsync(FinanceAccount, ct))!, item => item.Id == id);
        static PackageLifecycleInput Reason(PackageData package) => new(package.Version, "Precio publicado por error.");
        SavePackageInput Draft(string code, string unit = "Operación") => new(Guid.NewGuid(), code, "Equipaje QA", "USD", 300m,
            "Turnaround", null, null, new DateOnly(2026, 1, 1), null, [new PackageComponentInput(baggage.PublicId, unit, 1m, 1m, 50m)],
            null);
        async Task<Guid> PublishedAsync(string code)
        {
            var saved = await packages.SaveAsync(FinanceAccount, null, Draft(code), ct);
            Assert.True(saved.IsSuccess, saved.Code);
            var row = await PackageAsync(saved.Id!.Value);
            Assert.True((await packages.PublishAsync(FinanceAccount, row.Id, new PackageCommandInput(Guid.NewGuid(), row.Version),
                ct)).IsSuccess);
            return row.Id;
        }

        // 1-E: a unit name is saved as its code; an unknown unit has its own code.
        var first = await packages.SaveAsync(FinanceAccount, null, Draft("QA-RETIRE"), ct);
        Assert.True(first.IsSuccess, first.Code);
        var draft = await PackageAsync(first.Id!.Value);
        Assert.Equal("operation", Assert.Single(draft.Components).BillingUnit);
        Assert.Equal("billing_unit_unknown", (await packages.SaveAsync(FinanceAccount, null, Draft("QA-UNIT", "galón"), ct)).Code);

        // 1-N27: a draft is discarded once, with a reason and a key; nothing is deleted.
        Assert.Equal("forbidden", (await packages.DiscardAsync(ContractsAccount, draft.Id, Guid.NewGuid(), Reason(draft), ct)).Code);
        Assert.Equal("idempotency_key_required",
            (await packages.DiscardAsync(FinanceAccount, draft.Id, Guid.Empty, Reason(draft), ct)).Code);
        Assert.Equal("expected_version_required", (await packages.DiscardAsync(FinanceAccount, draft.Id, Guid.NewGuid(),
            Reason(draft) with { ExpectedVersion = "" }, ct)).Code);
        Assert.Equal("reason_required", (await packages.DiscardAsync(FinanceAccount, draft.Id, Guid.NewGuid(),
            Reason(draft) with { Reason = "no" }, ct)).Code);
        Assert.Equal("package_not_published",
            (await packages.RetireAsync(FinanceAccount, draft.Id, Guid.NewGuid(), Reason(draft), ct)).Code);
        var discardKey = Guid.NewGuid();
        Assert.True((await packages.DiscardAsync(FinanceAccount, draft.Id, discardKey, Reason(draft), ct)).IsSuccess);
        Assert.Equal(draft.Id, (await packages.DiscardAsync(FinanceAccount, draft.Id, discardKey, Reason(draft), ct)).Id);
        Assert.Equal("idempotency_conflict", (await packages.DiscardAsync(FinanceAccount, draft.Id, discardKey,
            Reason(draft) with { Reason = "Otro motivo para descartarlo." }, ct)).Code);
        Assert.Equal("version_conflict",
            (await packages.DiscardAsync(FinanceAccount, draft.Id, Guid.NewGuid(), Reason(draft), ct)).Code);
        var discarded = await PackageAsync(draft.Id);
        Assert.Equal("Discarded", discarded.Status);
        Assert.Equal("package_not_draft",
            (await packages.DiscardAsync(FinanceAccount, draft.Id, Guid.NewGuid(), Reason(discarded), ct)).Code);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item => item.Action == "finance.package.discarded" &&
            item.EntityPublicId == draft.Id && item.Reason == "Precio publicado por error.", ct));

        // The code is free again: the next version is published and Contratos links it to a draft contract.
        var retiring = await PublishedAsync("QA-RETIRE");
        Assert.Equal(2, (await PackageAsync(retiring)).VersionNumber);
        var (_, version) = await DraftContractAsync(context, "QA-PACKAGE-RETIRE", "Condiciones.", true, ct, "BAGGAGE");
        async Task<string> DraftVersionAsync() =>
            Assert.Single((await drafts.ListForContractsAsync(ContractsAccount, ct))!, item => item.Id == version.PublicId).Version;
        Assert.True((await packages.SetContractPackagesAsync(ContractsAccount, version.PublicId,
            new SetContractPackagesInput(Guid.NewGuid(), await DraftVersionAsync(), [retiring]), ct)).IsSuccess);

        // Retiring keeps the link and the frozen definition, but the draft is blocked until it is unlinked.
        var published = await PackageAsync(retiring);
        var retireKey = Guid.NewGuid();
        Assert.Equal("forbidden",
            (await packages.RetireAsync(ContractsAccount, published.Id, Guid.NewGuid(), Reason(published), ct)).Code);
        Assert.True((await packages.RetireAsync(FinanceAccount, published.Id, retireKey, Reason(published), ct)).IsSuccess);
        Assert.Equal(published.Id, (await packages.RetireAsync(FinanceAccount, published.Id, retireKey, Reason(published), ct)).Id);
        var retired = await PackageAsync(published.Id);
        Assert.Equal("Retired", retired.Status);
        Assert.Equal("package_not_published",
            (await packages.RetireAsync(FinanceAccount, retired.Id, Guid.NewGuid(), Reason(retired), ct)).Code);
        Assert.Equal(retired.Id, Assert.Single((await packages.ListForContractAsync(ContractsAccount, version.PublicId, ct))!).Id);
        var readiness = (await drafts.GetReadinessAsync(ContractsAccount, version.PublicId, ct)).Data!;
        Assert.Equal(["QA-RETIRE v2"], readiness.Issues.Single(item => item.Code == "package_retired").Subjects);
        Assert.DoesNotContain(readiness.Issues, item => item.Code == "package_not_eligible");
        Assert.Equal("package_retired", (await packages.SetContractPackagesAsync(ContractsAccount, version.PublicId,
            new SetContractPackagesInput(Guid.NewGuid(), await DraftVersionAsync(), [retired.Id]), ct)).Code);

        // Retiring the current publication never revives the one it replaced.
        var older = await PublishedAsync("QA-HISTORY");
        var newer = await PublishedAsync("QA-HISTORY");
        Assert.Equal("Superseded", (await PackageAsync(older)).Status);
        Assert.True((await packages.RetireAsync(FinanceAccount, newer, Guid.NewGuid(), Reason(await PackageAsync(newer)), ct))
            .IsSuccess);
        Assert.Equal("Superseded", (await PackageAsync(older)).Status);
        Assert.Equal("package_not_eligible", (await packages.SetContractPackagesAsync(ContractsAccount, version.PublicId,
            new SetContractPackagesInput(Guid.NewGuid(), await DraftVersionAsync(), [older]), ct)).Code);

        // Finance never approves a version that still links a retired package.
        await context.ContractVersions.Where(item => item.Id == version.Id).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.Status, ContractVersionStatus.PendingFinanceApproval), ct);
        var pending = (await book.GetContractApprovalAsync(FinanceAccount, version.PublicId, ct))!;
        Assert.Equal("package_retired", (await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Approved", null, pending.Summary.Version), Guid.NewGuid(), ct)).Code);
    }

    [Fact]
    public async Task PublicServicesHaveASeededBaseTariffAndTheCycleKeepsUnitCodes()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();

        // 1-E: a clean seed prices every public service per operation, in USD and in DOP.
        var publicServices = await context.ServiceDefinitions.AsNoTracking().Where(item => item.IsPublic).ToArrayAsync(ct);
        Assert.Equal(7, publicServices.Length);
        Assert.All(publicServices, service => Assert.Equal("operation", service.DefaultBillingUnit));
        var cargo = publicServices.Single(item => item.Code == "RAMP-CARGO");
        var tow = publicServices.Single(item => item.Code == "RAMP-TOW");
        foreach (var (currency, cargoPrice) in new[] { ("USD", 85m), ("DOP", 85m * 58.5m) })
        {
            var tariff = Assert.Single((await book.ListServiceTariffsAsync(FinanceAccount, currency, ct))!);
            var rates = (await book.GetServiceTariffAsync(FinanceAccount, tariff.Id, ct))!.Rates;
            Assert.Equal(9, rates.Count);
            Assert.All(publicServices, service => Assert.Contains(rates, rate =>
                rate.ServiceId == service.PublicId && rate.BillingUnit == "operation" && rate.UnitPrice > 0));
            Assert.Equal(cargoPrice, rates.Single(rate => rate.ServiceId == cargo.PublicId).UnitPrice);
        }

        // A legacy unit name stored by the catalog is read as its code, and so is the request line.
        await context.ServiceDefinitions.Where(item => item.Id == tow.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.DefaultBillingUnit, "Operación"), ct);
        Assert.Equal("operation", Assert.Single((await book.ListServicesAsync(FinanceAccount, ct))!,
            item => item.Code == "RAMP-TOW").DefaultBillingUnit);
        await context.ServiceTariffRates.Where(rate => rate.ServiceDefinitionId == tow.Id).ExecuteDeleteAsync(ct);
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        var profile = catalog.Airlines.First(item => !item.IsVerified);
        var requestId = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(new SubmitCommercialRequestCommand(requestId, profile.Id,
            [cargo.PublicId, tow.PublicId], "Ana Rivera", "Gerente comercial", "ana.units@carrier.example.com",
            "+1 809 555 0142", true, RepresentativeDocumentType: "NationalId",
            RepresentativeDocumentNumber: "00112345673"), ct)).IsSuccess);
        var requestRow = await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.PublicId == requestId, ct);
        Assert.All(await context.Set<ServiceRequestItem>().AsNoTracking().Where(item => item.ServiceRequestId == requestRow.Id)
            .Select(item => item.RequestedUnit).ToArrayAsync(ct), unit => Assert.Equal("operation", unit));
        async Task<string> RequestVersionAsync() => (await workflow.ListInboxAsync(ContractsAdministrator,
            new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!.Requests.Single(item => item.Id == requestId).Version;
        Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput(await RequestVersionAsync(),
                "Llamada a la central de la aerolínea: confirmó la gerencia comercial."), ct)).IsSuccess);
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, requestId, Guid.NewGuid(),
            new VerifyRequestAirlineInput(await RequestVersionAsync(), null, "Carrier Units S.A.", "DO", "Q9", "QQV",
                "https://registry.example.test/q9"), ct)).IsSuccess);
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        var approved = await workflow.DecideAsync(ContractsAdministrator, requestId,
            new ReviewCommercialInput(true, null, [station.Id], await RequestVersionAsync()), Guid.NewGuid(), ct);
        Assert.True(approved.IsSuccess, approved.Code);

        // The draft starts from the base price by unit code; a service without base price is unpriced, still by code.
        var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.ContractId == approved.ResourceId);
        var cargoRate = Assert.Single(draft.Rates, rate => rate.ServiceName == cargo.Name);
        Assert.Equal(("operation", 85m, (decimal?)85m), (cargoRate.BillingUnit, cargoRate.UnitPrice, cargoRate.BasePrice));
        var towRate = Assert.Single(draft.Rates, rate => rate.ServiceName == tow.Name);
        Assert.Equal(("operation", 0m, (decimal?)null), (towRate.BillingUnit, towRate.UnitPrice, towRate.BasePrice));
        UpdateContractDraftInput Save(string unit) => new(draft.ValidFrom, null, "USD", "Condiciones.",
            draft.Rates.Select(rate => new UpdateDraftRateInput(rate.Id, unit, 90m, 1m, true)).ToArray(), null, draft.Version);
        Assert.Equal("billing_unit_unknown",
            (await drafts.UpdateAsync(ContractsAdministrator, draft.Id, Save("galón"), Guid.NewGuid(), ct)).Code);
        Assert.True((await drafts.UpdateAsync(ContractsAdministrator, draft.Id, Save("Operación"), Guid.NewGuid(), ct)).IsSuccess);
        var saved = await (from rate in context.ContractServiceRates.AsNoTracking()
                           join contractVersion in context.ContractVersions.AsNoTracking() on rate.ContractVersionId equals contractVersion.Id
                           where contractVersion.PublicId == draft.Id
                           select rate.BillingUnit).ToArrayAsync(ct);
        Assert.All(saved, unit => Assert.Equal("operation", unit));

        // Finance tariffs: a unit name is saved as its code and every failure answers its own code.
        var usd = Assert.Single((await book.ListServiceTariffsAsync(FinanceAccount, "USD", ct))!);
        var created = await book.CreateServiceTariffDraftAsync(FinanceAccount,
            new CreateTariffDraftInput("USD", new DateOnly(2027, 1, 1), null, usd.Id), null, ct);
        Assert.True(created.IsSuccess, created.Code);
        Assert.Equal("tariff_draft_exists", (await book.CreateServiceTariffDraftAsync(FinanceAccount,
            new CreateTariffDraftInput("USD", new DateOnly(2027, 2, 1), null), null, ct)).Code);
        Assert.Equal("Invalid:tariff_not_found", Failure(await book.CreateServiceTariffDraftAsync(
            FinanceAccount, new CreateTariffDraftInput("DOP", new DateOnly(2027, 1, 1), null, Guid.NewGuid()), null, ct)));
        var copy = (await book.GetServiceTariffAsync(FinanceAccount, created.Id!.Value, ct))!;
        SaveServiceTariffDraftInput Rates(string unit, DateOnly from, Guid? service = null) => new(from, null, null,
            copy.Rates.Select(rate => new ServiceTariffRateInput(service ?? rate.ServiceId, null, unit, rate.UnitPrice, 1))
                .Take(service is null ? copy.Rates.Count : 1).ToArray(), copy.Summary.Version);
        Assert.Equal("Invalid:billing_unit_unknown", Failure(await book.SaveServiceTariffDraftAsync(
            FinanceAccount, copy.Summary.Id, Rates("free-text-unit", new DateOnly(2027, 1, 1)), null, ct)));
        Assert.Equal("service_not_found", (await book.SaveServiceTariffDraftAsync(FinanceAccount, copy.Summary.Id,
            Rates("operation", new DateOnly(2027, 1, 1), Guid.NewGuid()), null, ct)).Code);
        Assert.True((await book.SaveServiceTariffDraftAsync(FinanceAccount, copy.Summary.Id,
            Rates("Operación", new DateOnly(2025, 12, 1)), null, ct)).IsSuccess);
        var early = (await book.GetServiceTariffAsync(FinanceAccount, copy.Summary.Id, ct))!;
        Assert.All(early.Rates, rate => Assert.Equal("operation", rate.BillingUnit));
        Assert.Equal("Conflict:tariff_start_not_after_current", Failure(
            await book.PublishServiceTariffAsync(FinanceAccount, early.Summary.Id, early.Summary.Version, null, ct)));
        Assert.Equal("version_conflict",
            (await book.PublishServiceTariffAsync(FinanceAccount, early.Summary.Id, copy.Summary.Version, null, ct)).Code);

        // Charges, units and exchange rates.
        var perUnit = new SaveChargeDefinitionInput("QA-PER-UNIT", "Cargo por unidad", null, "AdditionalCharge", "PerUnit",
            "One", 0, 0, true, null, true, true, true, null);
        Assert.Equal("billing_unit_required", (await book.SaveChargeAsync(FinanceAccount, null, perUnit, null, ct)).Code);
        Assert.Equal("billing_unit_unknown",
            (await book.SaveChargeAsync(FinanceAccount, null, perUnit with { BillingUnit = "galón" }, null, ct)).Code);
        var charge = await book.SaveChargeAsync(FinanceAccount, null, perUnit with { BillingUnit = "Hora" }, null, ct);
        Assert.True(charge.IsSuccess, charge.Code);
        Assert.Equal("hour", Assert.Single((await book.ListChargesAsync(FinanceAccount, ct))!, item => item.Id == charge.Id).BillingUnit);
        Assert.Equal("charge_code_exists",
            (await book.SaveChargeAsync(FinanceAccount, null, perUnit with { BillingUnit = "hour" }, null, ct)).Code);
        Assert.Equal("billing_unit_exists",
            (await book.SaveBillingUnitAsync(FinanceAccount, null, new SaveBillingUnitInput("operation", "Operación", 0, true), null, ct)).Code);
        Assert.Equal("exchange_rate_exists", (await book.RecordExchangeRateAsync(FinanceAccount,
            new RecordExchangeRateInput(new DateOnly(2026, 8, 18), "USD", "DOP", 59m, "Duplicada"), null, ct)).Code);
    }

    [Fact]
    public async Task TariffBookCommandsReplayTheirIdempotencyKeyAfterALostAnswer()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        Task<int> AuditsAsync(string action, Guid? id) =>
            context.AuditEntries.CountAsync(item => item.Action == action && item.EntityPublicId == id, ct);
        var keys = new List<Guid>();
        Guid Key() { var key = Guid.NewGuid(); keys.Add(key); return key; }

        // The service tariff: an empty key is refused; a retry with the same key and body replays the draft
        // instead of tariff_draft_exists, and the same key with another body is a conflict.
        var usd = Assert.Single((await book.ListServiceTariffsAsync(FinanceAccount, "USD", ct))!);
        var create = new CreateTariffDraftInput("USD", new DateOnly(2027, 1, 1), "Tarifa 2027", usd.Id);
        Assert.Equal("idempotency_key_required",
            (await book.CreateServiceTariffDraftAsync(FinanceAccount, create, Guid.Empty, ct)).Code);
        var createKey = Key();
        var draft = await book.CreateServiceTariffDraftAsync(FinanceAccount, create, createKey, ct);
        Assert.True(draft.IsSuccess, draft.Code);
        Assert.Equal(draft.Id, (await book.CreateServiceTariffDraftAsync(FinanceAccount, create, createKey, ct)).Id);
        Assert.Equal("idempotency_conflict", (await book.CreateServiceTariffDraftAsync(FinanceAccount,
            create with { ValidFrom = new DateOnly(2027, 2, 1) }, createKey, ct)).Code);
        Assert.Equal("tariff_draft_exists",
            (await book.CreateServiceTariffDraftAsync(FinanceAccount, create, Guid.NewGuid(), ct)).Code);
        Assert.Equal(1, await AuditsAsync("finance.service_tariff.draft_created", draft.Id));

        // Save and publish committed but their answer was lost: the rowversion already changed, and the retry
        // with the same key still replays; a new key with the stale version is the version conflict.
        var copy = (await book.GetServiceTariffAsync(FinanceAccount, draft.Id!.Value, ct))!;
        var save = new SaveServiceTariffDraftInput(new DateOnly(2027, 1, 1), null, "Tarifa 2027", copy.Rates.Select(rate =>
            new ServiceTariffRateInput(rate.ServiceId, rate.StationId, rate.BillingUnit, rate.UnitPrice + 1m,
                rate.MinimumBillableQuantity)).ToArray(), copy.Summary.Version);
        var saveKey = Key();
        Assert.True((await book.SaveServiceTariffDraftAsync(FinanceAccount, copy.Summary.Id, save, saveKey, ct)).IsSuccess);
        Assert.Equal(copy.Summary.Id, (await book.SaveServiceTariffDraftAsync(FinanceAccount, copy.Summary.Id, save, saveKey, ct)).Id);
        Assert.Equal("version_conflict",
            (await book.SaveServiceTariffDraftAsync(FinanceAccount, copy.Summary.Id, save, Guid.NewGuid(), ct)).Code);
        var saved = (await book.GetServiceTariffAsync(FinanceAccount, copy.Summary.Id, ct))!;
        var publishKey = Key();
        Assert.True((await book.PublishServiceTariffAsync(FinanceAccount, saved.Summary.Id, saved.Summary.Version, publishKey,
            ct)).IsSuccess);
        Assert.Equal(saved.Summary.Id, (await book.PublishServiceTariffAsync(FinanceAccount, saved.Summary.Id,
            saved.Summary.Version, publishKey, ct)).Id);
        Assert.Equal("version_conflict", (await book.PublishServiceTariffAsync(FinanceAccount, saved.Summary.Id,
            saved.Summary.Version, Guid.NewGuid(), ct)).Code);
        // A key belongs to one command: the key of the save does not publish.
        Assert.Equal("idempotency_conflict", (await book.PublishServiceTariffAsync(FinanceAccount, saved.Summary.Id,
            saved.Summary.Version, saveKey, ct)).Code);
        Assert.Equal(1, await AuditsAsync("finance.service_tariff.published", saved.Summary.Id));
        Assert.Equal("Published", (await book.GetServiceTariffAsync(FinanceAccount, saved.Summary.Id, ct))!.Summary.Status);

        // A deleted draft: the replay answers the draft the first attempt deleted.
        var dop = await book.CreateServiceTariffDraftAsync(FinanceAccount, new CreateTariffDraftInput("DOP",
            new DateOnly(2027, 1, 1), null), null, ct);
        var dopDraft = (await book.GetServiceTariffAsync(FinanceAccount, dop.Id!.Value, ct))!;
        var deleteKey = Key();
        Assert.True((await book.DeleteServiceTariffDraftAsync(FinanceAccount, dopDraft.Summary.Id, dopDraft.Summary.Version,
            deleteKey, ct)).IsSuccess);
        Assert.Equal(dopDraft.Summary.Id, (await book.DeleteServiceTariffDraftAsync(FinanceAccount, dopDraft.Summary.Id,
            dopDraft.Summary.Version, deleteKey, ct)).Id);
        Assert.Equal("not_found", (await book.DeleteServiceTariffDraftAsync(FinanceAccount, dopDraft.Summary.Id,
            dopDraft.Summary.Version, Guid.NewGuid(), ct)).Code);

        // A billing unit and a charge: the replay answers the created row instead of *_exists.
        var unit = new SaveBillingUnitInput("gallon", "Galón", 2, true);
        var unitKey = Key();
        var unitCreated = await book.SaveBillingUnitAsync(FinanceAccount, null, unit, unitKey, ct);
        Assert.True(unitCreated.IsSuccess, unitCreated.Code);
        Assert.Equal(unitCreated.Id, (await book.SaveBillingUnitAsync(FinanceAccount, null, unit, unitKey, ct)).Id);
        Assert.Equal("billing_unit_exists", (await book.SaveBillingUnitAsync(FinanceAccount, null, unit, Guid.NewGuid(), ct)).Code);
        var charge = new SaveChargeDefinitionInput("qa-keyed", "Cargo con clave", null, "AdditionalCharge", "FixedAmount",
            "One", 0, 0, true, null, false, true, true, null);
        var chargeKey = Key();
        var chargeCreated = await book.SaveChargeAsync(FinanceAccount, null, charge, chargeKey, ct);
        Assert.True(chargeCreated.IsSuccess, chargeCreated.Code);
        Assert.Equal(chargeCreated.Id, (await book.SaveChargeAsync(FinanceAccount, null, charge, chargeKey, ct)).Id);
        Assert.Equal("charge_code_exists", (await book.SaveChargeAsync(FinanceAccount, null, charge, Guid.NewGuid(), ct)).Code);
        Assert.Equal(1, await context.ChargeDefinitions.CountAsync(item => item.Code == "QA-KEYED", ct));
        Assert.Equal(1, await AuditsAsync("finance.charge.created", chargeCreated.Id));

        // The charge tariff: create, save and publish replay with their keys.
        var chargeCreate = new CreateTariffDraftInput("USD", new DateOnly(2027, 1, 1), null);
        var chargeDraftKey = Key();
        var chargeDraft = await book.CreateChargeTariffDraftAsync(FinanceAccount, chargeCreate, chargeDraftKey, ct);
        Assert.True(chargeDraft.IsSuccess, chargeDraft.Code);
        Assert.Equal(chargeDraft.Id, (await book.CreateChargeTariffDraftAsync(FinanceAccount, chargeCreate, chargeDraftKey, ct)).Id);
        var chargeVersion = (await book.GetChargeTariffAsync(FinanceAccount, chargeDraft.Id!.Value, ct))!;
        var chargeSave = new SaveChargeTariffDraftInput(new DateOnly(2027, 1, 1), null, null,
            [new ChargeRateInput(chargeCreated.Id!.Value, 25m, 0m)], chargeVersion.Summary.Version);
        var chargeSaveKey = Key();
        Assert.True((await book.SaveChargeTariffDraftAsync(FinanceAccount, chargeVersion.Summary.Id, chargeSave, chargeSaveKey,
            ct)).IsSuccess);
        Assert.Equal(chargeVersion.Summary.Id, (await book.SaveChargeTariffDraftAsync(FinanceAccount, chargeVersion.Summary.Id,
            chargeSave, chargeSaveKey, ct)).Id);
        var chargeSaved = (await book.GetChargeTariffAsync(FinanceAccount, chargeVersion.Summary.Id, ct))!;
        var chargePublishKey = Key();
        Assert.True((await book.PublishChargeTariffAsync(FinanceAccount, chargeSaved.Summary.Id, chargeSaved.Summary.Version,
            chargePublishKey, ct)).IsSuccess);
        Assert.Equal(chargeSaved.Summary.Id, (await book.PublishChargeTariffAsync(FinanceAccount, chargeSaved.Summary.Id,
            chargeSaved.Summary.Version, chargePublishKey, ct)).Id);
        Assert.Equal(1, await AuditsAsync("finance.charge_tariff.published", chargeSaved.Summary.Id));

        // Exchange rates: the replay answers the recorded rate instead of exchange_rate_exists, and the correction
        // is applied once.
        var record = new RecordExchangeRateInput(new DateOnly(2026, 8, 19), "USD", "DOP", 59.3m, "Banco Central RD");
        var rateKey = Key();
        var recorded = await book.RecordExchangeRateAsync(FinanceAccount, record, rateKey, ct);
        Assert.True(recorded.IsSuccess, recorded.Code);
        Assert.Equal(recorded.Id, (await book.RecordExchangeRateAsync(FinanceAccount, record, rateKey, ct)).Id);
        Assert.Equal("exchange_rate_exists", (await book.RecordExchangeRateAsync(FinanceAccount, record, Guid.NewGuid(), ct)).Code);
        var current = Assert.Single((await book.ListExchangeRatesAsync(FinanceAccount, record.RateDate, record.RateDate, false,
            ct))!);
        var correction = new CorrectExchangeRateInput(59.4m, "Banco Central RD", current.Version);
        var correctKey = Key();
        var corrected = await book.CorrectExchangeRateAsync(FinanceAccount, current.Id, correction, correctKey, ct);
        Assert.True(corrected.IsSuccess, corrected.Code);
        Assert.Equal(corrected.Id, (await book.CorrectExchangeRateAsync(FinanceAccount, current.Id, correction, correctKey, ct)).Id);
        Assert.Equal(2, (await book.ListExchangeRatesAsync(FinanceAccount, record.RateDate, record.RateDate, true, ct))!.Count);

        // Each key kept one receipt, written with its command.
        Assert.Equal(keys.Count, await context.Set<FinancePricingCommand>().AsNoTracking()
            .CountAsync(item => keys.Contains(item.RequestId), ct));
    }

    private static string Failure(FinanceCatalogResult result) => $"{result.Failure}:{result.Code}";
}
