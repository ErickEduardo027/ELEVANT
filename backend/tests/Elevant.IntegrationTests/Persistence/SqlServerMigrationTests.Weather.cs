using Elevant.Application.Abstractions.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// ADR-0043 (contracts 1.4), against SQL Server: the OCC's weather is read by the ICAO code of the station's airport, which
/// the store takes from the active station joined to its airport. No migration: the columns already exist.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task TheWeatherReadsTheIcaoOfTheStationAirport()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);

        async Task<string?> IcaoCodeAsync(Guid stationId)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IOccStationAirportStore>().FindIcaoCodeAsync(stationId, ct);
        }

        // The seeded Punta Cana station reads its airport, MDPC; a station nobody created reads nothing.
        Assert.Equal("MDPC", await IcaoCodeAsync(SeededPujStation));
        Assert.Null(await IcaoCodeAsync(Guid.Parse("20000000-0000-7000-8000-0000000000ff")));

        await using var context = CreateContext(database.ConnectionString);
        var airportId = await context.Stations.AsNoTracking().Where(item => item.PublicId == SeededPujStation)
            .Select(item => item.AirportId).SingleAsync(ct);

        // The code is answered in upper case however the airport's row writes it.
        Assert.Equal(1, await context.Airports.Where(item => item.Id == airportId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IcaoCode, "mdpc"), ct));
        Assert.Equal("MDPC", await IcaoCodeAsync(SeededPujStation));

        // A deactivated station has no weather to read.
        Assert.Equal(1, await context.Stations.Where(item => item.PublicId == SeededPujStation)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false), ct));
        Assert.Null(await IcaoCodeAsync(SeededPujStation));
    }
}
