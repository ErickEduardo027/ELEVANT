using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// N31: a requested service has the unit its contract draft is billed with, the one rule of the draft: the unit of
/// Finance's base rate in USD on AVIAM's business day or, without one, the catalog unit. An open request shows the
/// unit its draft would be born with today; the approval fixes the one the draft was born with; a decided request
/// keeps its copy.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task ARequestShowsTheUnitItsDraftIsBornWithAndKeepsItOnceDecided()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var services = await context.ServiceDefinitions.AsNoTracking()
            .Where(item => item.Code == "RAMP-AC" || item.Code == "RAMP-GPU" || item.Code == "RAMP-TOW")
            .ToDictionaryAsync(item => item.Code, ct);
        var (airConditioning, groundPower, towing) = (services["RAMP-AC"], services["RAMP-GPU"], services["RAMP-TOW"]);
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        var stationId = await context.Stations.Where(item => item.PublicId == station.Id).Select(item => item.Id)
            .SingleAsync(ct);
        var usd = await context.ServiceTariffVersions.AsNoTracking()
            .SingleAsync(item => item.CurrencyCode == "USD" && item.Status == TariffVersionStatus.Published, ct);
        Task BaseUnitAsync(ServiceDefinition service, string unit) => context.ServiceTariffRates
            .Where(rate => rate.ServiceTariffVersionId == usd.Id && rate.ServiceDefinitionId == service.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(rate => rate.BillingUnit, unit), ct);
        Task CatalogUnitAsync(ServiceDefinition service, string unit) => context.ServiceDefinitions
            .Where(item => item.Id == service.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.DefaultBillingUnit, unit), ct);
        string Line(IEnumerable<(long ServiceId, string? Unit)> units) => string.Join(", ", units
            .Select(item => $"{services.Values.Single(service => service.Id == item.ServiceId).Code}={item.Unit}")
            .Order(StringComparer.Ordinal));
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await workflow.ListInboxAsync(ContractsAdministrator,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!
            .Requests.Single(item => item.Id == id);
        // What «Servicios solicitados» shows, and what the request stored.
        async Task<string> ShownAsync(Guid id) => Line((await ItemAsync(id)).Services.Select(item =>
            (services.Values.Single(service => service.PublicId == item.ServiceId).Id, (string?)item.Unit)));
        async Task<string> StoredAsync(Guid id) => Line((await (from item in context.Set<ServiceRequestItem>().AsNoTracking()
                join request in context.ServiceRequests.AsNoTracking() on item.ServiceRequestId equals request.Id
                where request.PublicId == id
                select new { ServiceId = item.ServiceDefinitionId!.Value, item.RequestedUnit }).ToArrayAsync(ct))
            .Select(item => (item.ServiceId, (string?)item.RequestedUnit)));
        Task<CommercialSubmissionResult> SubmitAsync(Guid id, Guid profileId, string email) => intake.HandleAsync(
            CommercialApplication(id, profileId, airConditioning.PublicId, email) with
            {
                ServiceIds = [airConditioning.PublicId, groundPower.PublicId, towing.PublicId],
            }, ct);

        // The Development VPS on 16 November: the catalog bills air conditioning per operation, while Finance's
        // base rate bills it per hour. Towing has no USD base rate and its catalog unit is a legacy name; ground
        // power has a PUJ rate per minute besides the all-stations one per operation.
        Assert.Equal("operation", airConditioning.DefaultBillingUnit);
        await BaseUnitAsync(airConditioning, "hour");
        await context.ServiceTariffRates.Where(rate => rate.ServiceDefinitionId == towing.Id &&
            context.ServiceTariffVersions.Any(version => version.Id == rate.ServiceTariffVersionId &&
                version.CurrencyCode == "USD")).ExecuteDeleteAsync(ct);
        await CatalogUnitAsync(towing, "Día");
        context.ServiceTariffRates.Add(new ServiceTariffRate
        {
            PublicId = Guid.CreateVersion7(), ServiceTariffVersionId = usd.Id, ServiceDefinitionId = groundPower.Id,
            StationId = stationId, BillingUnit = "minute", UnitPrice = 2m, MinimumBillableQuantity = 30m,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(ct);

        // A request shows, and keeps, the unit its draft would be born with: the base rate's or, without one, the
        // catalog unit as a code. A request has no stations yet, so the all-stations rate applies.
        var profile = catalog.Airlines.First(item => !item.IsVerified);
        var approvedId = Guid.NewGuid();
        var rejectedId = Guid.NewGuid();
        Assert.True((await SubmitAsync(approvedId, profile.Id, "ana.units@carrier.example.com")).IsSuccess);
        Assert.True((await SubmitAsync(rejectedId, profile.Id, "luis.units@carrier.example.com")).IsSuccess);
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=operation, RAMP-TOW=day", await ShownAsync(approvedId));
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=operation, RAMP-TOW=day", await StoredAsync(approvedId));
        Assert.True((await workflow.DecideAsync(ContractsAdministrator, rejectedId, new ReviewCommercialInput(false,
            "La aerolínea no opera en las estaciones de AVIAM.", [], (await ItemAsync(rejectedId)).Version),
            Guid.NewGuid(), ct)).IsSuccess);

        // A request received before N31 kept the catalog unit. While it is open it shows the unit of a draft born
        // today, so a change of the catalog shows too.
        await context.Set<ServiceRequestItem>()
            .Where(item => item.ServiceDefinitionId == airConditioning.Id &&
                context.ServiceRequests.Any(request => request.Id == item.ServiceRequestId && request.PublicId == approvedId))
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.RequestedUnit, "operation"), ct);
        await CatalogUnitAsync(towing, "ton");
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=operation, RAMP-TOW=ton", await ShownAsync(approvedId));
        Assert.Equal("RAMP-AC=operation, RAMP-GPU=operation, RAMP-TOW=day", await StoredAsync(approvedId));
        // A decided request shows its copy.
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=operation, RAMP-TOW=day", await ShownAsync(rejectedId));

        // The approval bills each service with the unit of its base rate for the chosen station (PUJ's rate wins) or
        // its catalog unit, and the request keeps that unit in the same transaction: the request and its draft agree.
        Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, approvedId, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput((await ItemAsync(approvedId)).Version,
                "Llamada a la central de la aerolínea: confirmó la gerencia comercial."), ct)).IsSuccess);
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, approvedId, Guid.NewGuid(),
            new VerifyRequestAirlineInput((await ItemAsync(approvedId)).Version, null, "Carrier Units S.A.", "DO", "Q8",
                "QQU", "https://registry.example.test/q8"), ct)).IsSuccess);
        var approved = await workflow.DecideAsync(ContractsAdministrator, approvedId,
            new ReviewCommercialInput(true, null, [station.Id], (await ItemAsync(approvedId)).Version), Guid.NewGuid(), ct);
        Assert.True(approved.IsSuccess, approved.Code);
        var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.ContractId == approved.ResourceId);
        Assert.Equal("USD", draft.CurrencyCode);
        Assert.Equal("Aire acondicionado=hour·95, Remolque de aeronaves=ton·0, Unidad generadora de energía=minute·2",
            string.Join(", ", draft.Rates.Select(rate => $"{rate.ServiceName}={rate.BillingUnit}·{rate.UnitPrice:0.##}")
                .Order(StringComparer.Ordinal)));
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=minute, RAMP-TOW=ton", await StoredAsync(approvedId));
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=minute, RAMP-TOW=ton", await ShownAsync(approvedId));

        // Once decided, a request keeps its copy whatever Finance or the catalog change afterwards.
        await BaseUnitAsync(airConditioning, "operation");
        await CatalogUnitAsync(towing, "operation");
        await context.ServiceTariffRates.Where(rate => rate.ServiceDefinitionId == groundPower.Id && rate.StationId != null)
            .ExecuteDeleteAsync(ct);
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=minute, RAMP-TOW=ton", await ShownAsync(approvedId));
        Assert.Equal("RAMP-AC=hour, RAMP-GPU=operation, RAMP-TOW=day", await ShownAsync(rejectedId));
    }
}
