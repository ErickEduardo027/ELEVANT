using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid FinanceAccount = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid ContractsAccount = Guid.Parse("40000000-0000-7000-8000-000000000005");

    [Fact]
    public async Task FinanceTariffBookPublishesVersionsAndKeepsHistory()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();

        // Only Finance manages tariffs; Contracts may read billing units.
        Assert.NotNull(await book.ListBillingUnitsAsync(ContractsAccount, cancellationToken));
        Assert.Null(await book.ListServiceTariffsAsync(ContractsAccount, null, cancellationToken));
        var usd = Assert.Single((await book.ListServiceTariffsAsync(FinanceAccount, "USD", cancellationToken))!);
        Assert.Equal("Published", usd.Status);
        Assert.Equal(FinanceCatalogFailure.Forbidden, (await book.CreateServiceTariffDraftAsync(ContractsAccount,
            new CreateTariffDraftInput("USD", new DateOnly(2027, 1, 1), null), null, cancellationToken)).Failure);

        // A copied draft is edited and published; the previous version ends the day before.
        var draft = await book.CreateServiceTariffDraftAsync(FinanceAccount,
            new CreateTariffDraftInput("USD", new DateOnly(2027, 1, 1), "Tarifa 2027", usd.Id), null, cancellationToken);
        Assert.True(draft.IsSuccess);
        Assert.Equal(FinanceCatalogFailure.Conflict, (await book.CreateServiceTariffDraftAsync(FinanceAccount,
            new CreateTariffDraftInput("USD", new DateOnly(2027, 2, 1), null), null, cancellationToken)).Failure);
        var copied = (await book.GetServiceTariffAsync(FinanceAccount, draft.Id!.Value, cancellationToken))!;
        // 1-E: the seeded base tariff prices the 7 public catalog services besides the two operational ones.
        Assert.Equal(9, copied.Rates.Count);
        Assert.Equal(FinanceCatalogFailure.Invalid, (await book.SaveServiceTariffDraftAsync(FinanceAccount, draft.Id.Value,
            new SaveServiceTariffDraftInput(new DateOnly(2027, 1, 1), null, null,
                copied.Rates.Select(rate => new ServiceTariffRateInput(rate.ServiceId, null, "free-text-unit",
                    rate.UnitPrice, 1)).ToArray(), copied.Summary.Version), null, cancellationToken)).Failure);
        Assert.True((await book.SaveServiceTariffDraftAsync(FinanceAccount, draft.Id.Value,
            new SaveServiceTariffDraftInput(new DateOnly(2027, 1, 1), null, "Tarifa 2027",
                copied.Rates.Select(rate => new ServiceTariffRateInput(rate.ServiceId, null, rate.BillingUnit,
                    rate.UnitPrice * 1.1m, 1)).ToArray(), copied.Summary.Version), null, cancellationToken)).IsSuccess);
        var saved = (await book.GetServiceTariffAsync(FinanceAccount, draft.Id.Value, cancellationToken))!;
        Assert.Equal(FinanceCatalogFailure.Conflict, (await book.PublishServiceTariffAsync(FinanceAccount, draft.Id.Value,
            copied.Summary.Version, null, cancellationToken)).Failure);
        Assert.True((await book.PublishServiceTariffAsync(FinanceAccount, draft.Id.Value, saved.Summary.Version,
            null, cancellationToken)).IsSuccess);
        var versions = (await book.ListServiceTariffsAsync(FinanceAccount, "USD", cancellationToken))!;
        Assert.Equal(["Published", "Superseded"], versions.Select(version => version.Status));
        Assert.Equal(new DateOnly(2026, 12, 31), versions[1].ValidTo);

        // Charges: shapes are validated and the catalog is CRUD-editable.
        Assert.Equal(FinanceCatalogFailure.Invalid, (await book.SaveChargeAsync(FinanceAccount, null,
            new SaveChargeDefinitionInput("BAD", "Mal", null, "Surcharge", "PerHour", "One", 0, 0, true, null, false,
                true, true, null), null, cancellationToken)).Failure);
        var created = await book.SaveChargeAsync(FinanceAccount, null,
            new SaveChargeDefinitionInput("PUSHBACK-EXTRA", "Remolque adicional", null, "AdditionalCharge", "PerUnit",
                "One", 0, 0, true, null, true, true, true, "unit"), null, cancellationToken);
        Assert.True(created.IsSuccess);
        Assert.Equal(FinanceCatalogFailure.Conflict, (await book.SaveChargeAsync(FinanceAccount, null,
            new SaveChargeDefinitionInput("pushback-extra", "Duplicado", null, "AdditionalCharge", "FixedAmount", "One",
                0, 0, true, null, false, true, true, null), null, cancellationToken)).Failure);
        var charge = Assert.Single((await book.ListChargesAsync(FinanceAccount, cancellationToken))!,
            item => item.Id == created.Id);
        Assert.True((await book.SaveChargeAsync(FinanceAccount, charge.Id, new SaveChargeDefinitionInput(charge.Code,
            charge.Name, "Desactivado", charge.Category, charge.Method, charge.QuantityRule, 0, 0, true, null, true,
            false, false, "unit", charge.Version), null, cancellationToken)).IsSuccess);

        // Exchange rates: one current rate per date; a correction keeps the history.
        Assert.Equal(FinanceCatalogFailure.Conflict, (await book.RecordExchangeRateAsync(FinanceAccount,
            new RecordExchangeRateInput(new DateOnly(2026, 8, 18), "DOP", "USD", 0.017m, "Duplicada"),
            null, cancellationToken)).Failure);
        var current = Assert.Single((await book.ListExchangeRatesAsync(FinanceAccount, new DateOnly(2026, 8, 1),
            new DateOnly(2026, 8, 31), false, cancellationToken))!);
        Assert.True((await book.CorrectExchangeRateAsync(FinanceAccount, current.Id,
            new CorrectExchangeRateInput(58.75m, "Banco Central", current.Version), null, cancellationToken)).IsSuccess);
        var history = (await book.ListExchangeRatesAsync(FinanceAccount, new DateOnly(2026, 8, 1),
            new DateOnly(2026, 8, 31), true, cancellationToken))!;
        Assert.Equal(2, history.Count);
        Assert.Equal(58.75m, Assert.Single(history, rate => rate.IsCurrent).Rate);
        Assert.Equal(current.Id, Assert.Single(history, rate => rate.IsCurrent).SupersedesId);
        Assert.Equal(58.75m, await FinanceTariffLookupProbe.RateAsync(context, "USD", "DOP", new DateOnly(2026, 9, 1),
            cancellationToken));
    }

    [Fact]
    public async Task FinanceMustApproveAContractBeforeItBecomesActive()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();

        // A second synthetic draft for the seeded airline, pending Finance.
        var seeded = await context.Contracts.AsNoTracking().SingleAsync(item => item.ContractCode == "DEV-CONTRACT-0001",
            cancellationToken);
        var service = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == "BAGGAGE",
            cancellationToken);
        var contract = new Contract
        {
            PublicId = Guid.CreateVersion7(), AirlineId = seeded.AirlineId, ContractCode = "QA-FIN-APPROVAL",
            Status = ContractStatus.Draft, OriginatingServiceRequestId = seeded.OriginatingServiceRequestId,
        };
        context.Contracts.Add(contract);
        await context.SaveChangesAsync(cancellationToken);
        var version = new ContractVersion
        {
            PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = 1,
            Status = ContractVersionStatus.PendingFinanceApproval, ValidFrom = new DateOnly(2026, 9, 1), CurrencyCode = "USD",
            Terms = "QA",
        };
        context.ContractVersions.Add(version);
        await context.SaveChangesAsync(cancellationToken);
        context.ContractServiceRates.Add(new ContractServiceRate
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, ServiceDefinitionId = service.Id,
            BillingUnit = "operation", UnitPrice = 104m, MinimumQuantity = 1m, IsConfirmed = true,
        });
        await context.SaveChangesAsync(cancellationToken);

        Assert.Null(await book.GetContractApprovalAsync(FinanceAccount, version.PublicId, cancellationToken));
        var stationId = await context.Stations.Where(station => station.Code == "PUJ").Select(station => station.Id).SingleAsync(cancellationToken);
        context.Set<ContractVersionStation>().Add(new() { ContractVersionId = version.Id, StationId = stationId });
        await context.SaveChangesAsync(cancellationToken);
        Assert.Null(await book.ListContractApprovalsAsync(ContractsAccount, true, cancellationToken));
        var detail = (await book.GetContractApprovalAsync(FinanceAccount, version.PublicId, cancellationToken))!;
        // 1-F: a contract that never activated still needs the validity, the signatures and the permit.
        Assert.Equal("Draft", detail.Summary.ContractStatus);
        var rate = Assert.Single(detail.Rates);
        Assert.Equal(130m, rate.BasePrice);
        Assert.Equal(-20m, rate.DifferencePercent);
        Assert.Equal(1, detail.Summary.RatesBelowBase);
        Assert.Contains(detail.Charges, item => item.ChargeCode == "NIGHT" && item.BaseValue == 15m);

        // Returning needs a reason and sends the draft back to Contracts with it.
        Assert.Equal(FinanceCatalogFailure.Invalid, (await book.DecideContractApprovalAsync(FinanceAccount,
            version.PublicId, new DecideContractApprovalInput("Returned", null, detail.Summary.Version), null,
            cancellationToken)).Failure);
        Assert.True((await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Returned", "Precio por debajo de la tarifa base sin justificación.",
                detail.Summary.Version), null, cancellationToken)).IsSuccess);
        var returned = Assert.Single((await drafts.ListForContractsAsync(ContractsAccount, cancellationToken))!,
            item => item.Id == version.PublicId);
        Assert.Equal("Draft", returned.VersionStatus);
        Assert.Equal("Returned", returned.FinanceDecision);
        Assert.Equal(130m, Assert.Single(returned.Rates).BasePrice);

        // Contracts negotiates a charge and resubmits; Finance approves and the contract awaits the signatures.
        var night = Assert.Single(returned.Charges!, item => item.Code == "NIGHT");
        Assert.True((await drafts.UpdateAsync(ContractsAccount, version.PublicId, new UpdateContractDraftInput(
            returned.ValidFrom, null, "USD", "QA revisado",
            returned.Rates.Select(item => new UpdateDraftRateInput(item.Id, item.BillingUnit, 125m, 1m, true)).ToArray(),
            [new UpdateDraftChargeInput(night.ChargeId, false, 20m)]), null, cancellationToken)).IsSuccess);
        Assert.True((await drafts.ActivateAsync(ContractsAccount, version.PublicId, null, null, cancellationToken)).IsSuccess);
        var pending = (await book.GetContractApprovalAsync(FinanceAccount, version.PublicId, cancellationToken))!;
        Assert.Equal(20m, Assert.Single(pending.Charges, item => item.ChargeCode == "NIGHT").ContractValue);
        Assert.True((await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
            new DecideContractApprovalInput("Approved", null, pending.Summary.Version), null, cancellationToken)).IsSuccess);
        Assert.Equal(ContractStatus.Draft, (await context.Contracts.AsNoTracking()
            .SingleAsync(item => item.Id == contract.Id, cancellationToken)).Status);
        Assert.Equal(2, (await book.GetContractApprovalAsync(FinanceAccount, version.PublicId, cancellationToken))!
            .History.Count);
    }

    private static async Task<ServiceProvider> SeededFinanceProviderAsync(TemporaryDatabase database,
        CancellationToken cancellationToken, TimeProvider? clock = null)
    {
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!789"), cancellationToken);
        return new ServiceCollection().AddLogging()
            .AddSingleton(clock ?? TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
    }

    private static class FinanceTariffLookupProbe
    {
        public static async Task<decimal?> RateAsync(ElevantDbContext context, string from, string to, DateOnly date,
            CancellationToken cancellationToken) =>
            await context.ExchangeRates.AsNoTracking()
                .Where(item => item.IsCurrent && item.RateDate <= date && item.FromCurrency == from && item.ToCurrency == to)
                .OrderByDescending(item => item.RateDate).Select(item => (decimal?)item.Rate)
                .FirstOrDefaultAsync(cancellationToken);
    }
}
