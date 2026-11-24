using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// CN-28: the review preselects, with its source, the type the airline flew most of a generic model's family at the
    /// station in the last 90 days, the type the provider's model names, the stand of a real flight's gate («1» in
    /// terminal B is B01) and otherwise a free stand of the announced terminal, never the same one for two overlapping
    /// arrivals. Without an air picture nothing comes from the live traffic.
    /// </summary>
    [Fact]
    public async Task FlightFeedReviewSuggestsTypeAndStandWithTheirSources()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var seeded = await SeededFinanceProviderAsync(database, ct);
        await using var provider = FeedProvider(database, new DisabledFeed());
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var sync = scope.ServiceProvider.GetRequiredService<IFlightFeedSyncStore>();
        var occ = scope.ServiceProvider.GetRequiredService<IOccFlightFeedStore>();
        var now = DateTimeOffset.UtcNow;
        var station = Assert.Single(await sync.ListStationsAsync(now, ct), item => item.StationPublicId == SeededPujStation);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZoneId);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).Date).AddDays(1);
        DateTimeOffset At(int hour, int minute = 0) =>
            new(TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(new TimeOnly(hour, minute)), zone));

        // The catalog has two 737s; the airline flew B738 three times and B38M once at PUJ lately, and B38M twice
        // more than 90 days ago, which no longer count.
        var stationId = await context.Stations.Where(item => item.PublicId == SeededPujStation).Select(item => item.Id).SingleAsync(ct);
        var airlineId = await context.Airlines.Where(item => item.IataCode == "ZZ").Select(item => item.Id).SingleAsync(ct);
        AircraftType Type(string icao, string model) => new()
        {
            PublicId = Guid.CreateVersion7(), IcaoCode = icao, Manufacturer = "Boeing", Model = model, IsActive = true,
            SizeCategory = AircraftSizeCategory.Narrowbody, CreatedAt = now, UpdatedAt = now,
        };
        var b738 = Type("B738", "737-800");
        var b38M = Type("B38M", "737 MAX 8");
        context.AircraftTypes.AddRange(b738, b38M);
        await context.SaveChangesAsync(ct);
        var flown = new (AircraftType Type, int DaysAgo)[] { (b738, 3), (b738, 10), (b738, 40), (b38M, 20), (b38M, 95), (b38M, 120) };
        context.Turnarounds.AddRange(flown.Select((item, index) => new Turnaround
        {
            PublicId = Guid.CreateVersion7(), OperationCode = $"CN28-HIST-{index}", AirlineId = airlineId, StationId = stationId,
            OperationDate = day.AddDays(-item.DaysAgo), AircraftTypeId = item.Type.Id, CurrentStatus = TurnaroundStatus.Completed,
            Source = OperationalDataSource.Internal, CreatedAt = now, UpdatedAt = now,
        }));
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();

        var origin = new FeedAirport("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", "America/Santo_Domingo", 18.5m, -69.5m);
        FeedFlight Leg(FlightDirection direction, string number, DateTimeOffset at, string model, string? terminal, string? gate) =>
            new(direction, number, new FeedAirline("Demo Airlines", "ZZ", null), origin, at, null, null, "Expected", null, model,
                terminal, gate, false, "IsOperator");
        var call = new FlightFeedCall("AeroDataBox", station, day.ToDateTime(new TimeOnly(6, 0)),
            day.ToDateTime(new TimeOnly(18, 0)), ProviderCallTrigger.Manual, null, now);
        await sync.RecordAsync(call, new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
        [
            Leg(FlightDirection.Arrival, "ZZ181", At(10), "Boeing 737", "B", "1"),
            Leg(FlightDirection.Departure, "ZZ182", At(11, 30), "Boeing 737", "B", "1"),
            Leg(FlightDirection.Arrival, "ZZ191", At(10, 30), "Boeing 737", "B", "1"),
            Leg(FlightDirection.Departure, "ZZ192", At(12), "Boeing 737", "B", "1"),
            Leg(FlightDirection.Arrival, "ZZ201", At(10, 45), "Boeing 737-800", "Terminal B", null),
            Leg(FlightDirection.Departure, "ZZ202", At(12, 15), "Boeing 737-800", "B", null),
        ]), ct);

        var proposals = (await occ.ListAsync(SeededOccAccount, SeededPujStation, day, OccFlightFeedView.Contracted, ct))!.Proposals;
        var stands = await context.Stands.AsNoTracking().Where(item => item.StationId == stationId)
            .ToDictionaryAsync(item => item.PublicId, item => item.Code, ct);
        var zz181 = proposals.Single(item => item.FlightNumber == "ZZ181");
        var zz191 = proposals.Single(item => item.FlightNumber == "ZZ191");
        var zz201 = proposals.Single(item => item.FlightNumber == "ZZ201");

        // «Boeing 737» is generic: B738 carries 3 of the 4 recent 737 flights (75 %).
        Assert.Equal((b738.PublicId, AircraftTypeSuggestionSources.History),
            (zz181.SuggestedAircraftTypeId, zz181.SuggestedAircraftTypeSource));
        Assert.Equal(AircraftTypeSuggestionSources.History, zz191.SuggestedAircraftTypeSource);
        Assert.Equal((b738.PublicId, AircraftTypeSuggestionSources.ProviderModel),
            (zz201.SuggestedAircraftTypeId, zz201.SuggestedAircraftTypeSource));
        Assert.All(proposals, item => Assert.Null(item.SuggestedRegistration));

        // The gate «1» of terminal B is B01; the next overlapping arrival with the same gate takes the other free stand
        // of terminal B, and so would a third one with no gate if any were left.
        Assert.Equal(("B01", StandSuggestionSources.Gate), (stands[zz181.SuggestedStandId!.Value], zz181.SuggestedStandSource));
        Assert.Equal(("B02", StandSuggestionSources.Free), (stands[zz191.SuggestedStandId!.Value], zz191.SuggestedStandSource));
        Assert.Null(zz201.SuggestedStandId);
        Assert.Null(zz201.SuggestedStandSource);
        Assert.All(proposals.Where(item => item.Direction == "Departure"), item => Assert.Null(item.SuggestedStandId));

        // Imported on B01, the flight holds it: the next read suggests B02 to ZZ191 still and nothing to ZZ201.
        var zz182 = proposals.Single(item => item.ProposalId == zz181.SuggestedDepartureId);
        Assert.Null((await occ.ImportAsync(SeededOccAccount, new OccFlightImportInput(zz181.ProposalId, zz182.ProposalId,
            b738.PublicId, zz181.SuggestedStandId, false, zz181.Version, zz182.Version), Guid.NewGuid(), ct)).Failure);
        var again = (await occ.ListAsync(SeededOccAccount, SeededPujStation, day, OccFlightFeedView.Contracted, ct))!.Proposals;
        Assert.Equal("B02", stands[again.Single(item => item.FlightNumber == "ZZ191").SuggestedStandId!.Value]);
        Assert.Null(again.Single(item => item.FlightNumber == "ZZ201").SuggestedStandId);
        Assert.Null(again.Single(item => item.FlightNumber == "ZZ181").SuggestedStandId);
        // The dismissed view suggests nothing.
        Assert.Empty((await occ.ListAsync(SeededOccAccount, SeededPujStation, day, OccFlightFeedView.Dismissed, ct))!.Proposals);
    }
    /// <summary>
    /// CN-28: the live aircraft the map's air picture already holds in memory names the type and the registration of the
    /// proposal whose ICAO callsign it broadcasts (DZZ881 is ZZ881), before the provider's model; another station, whose
    /// traffic the picture does not show, takes nothing from it. The feed's read never asks the network.
    /// </summary>
    [Fact]
    public async Task FlightFeedReviewTakesTheTypeOfTheLiveAircraft()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var seeded = await SeededFinanceProviderAsync(database, ct);
        var traffic = new LiveTraffic();
        var picture = new AirPictureService(traffic, AirTrafficSettings.Disabled with { Enabled = true }, TimeProvider.System);
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System).AddSingleton(FlightFeedBudget.Default)
            .AddSingleton<IAirportFlightFeed>(new DisabledFeed()).AddSingleton(picture)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
            }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var sync = scope.ServiceProvider.GetRequiredService<IFlightFeedSyncStore>();
        var occ = scope.ServiceProvider.GetRequiredService<IOccFlightFeedStore>();
        var now = DateTimeOffset.UtcNow;
        var station = Assert.Single(await sync.ListStationsAsync(now, ct), item => item.StationPublicId == SeededPujStation);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZoneId);
        // An hour ahead the arrival is still on its way: a candidate of the live traffic.
        var arrivalAt = new DateTimeOffset(now.UtcTicks - now.UtcTicks % TimeSpan.TicksPerMinute, TimeSpan.Zero).AddHours(1);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(arrivalAt, zone).Date);
        var b38M = new AircraftType
        {
            PublicId = Guid.CreateVersion7(), IcaoCode = "B38M", Manufacturer = "Boeing", Model = "737 MAX 8", IsActive = true,
            SizeCategory = AircraftSizeCategory.Narrowbody, CreatedAt = now, UpdatedAt = now,
        };
        context.AircraftTypes.Add(b38M);
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();

        var origin = new FeedAirport("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", "America/Santo_Domingo", 18.5m, -69.5m);
        FeedFlight Leg(FlightDirection direction, string number, DateTimeOffset at) =>
            new(direction, number, new FeedAirline("Demo Airlines", "ZZ", null), origin, at, null, null, "Expected", null,
                "Airbus A320", "B", null, false, "IsOperator");
        await sync.RecordAsync(new FlightFeedCall("AeroDataBox", station, day.ToDateTime(TimeOnly.MinValue),
                day.ToDateTime(new TimeOnly(23, 59)), ProviderCallTrigger.Manual, null, now),
            new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
            [
                Leg(FlightDirection.Arrival, "ZZ881", arrivalAt),
                Leg(FlightDirection.Departure, "ZZ882", arrivalAt.AddMinutes(50)),
                Leg(FlightDirection.Arrival, "ZZ883", arrivalAt.AddMinutes(5)),
            ]), ct);

        async Task<IReadOnlyList<OccFlightProposalData>> List() =>
            (await occ.ListAsync(SeededOccAccount, SeededPujStation, day, OccFlightFeedView.Contracted, ct))!.Proposals;
        // Before the map read the network, the picture is empty: the provider's model decides.
        Assert.All((await List()).Where(item => item.Direction == "Arrival"), item =>
            Assert.Equal((AircraftTypeSuggestionSources.ProviderModel, (string?)null),
                (item.SuggestedAircraftTypeSource, item.SuggestedRegistration)));
        Assert.Equal(0, traffic.Reads);

        await picture.PollOnceAsync(ct);
        var proposals = await List();
        var zz881 = proposals.Single(item => item.FlightNumber == "ZZ881");
        Assert.Equal((b38M.PublicId, AircraftTypeSuggestionSources.Live, "ZZ-1849"),
            (zz881.SuggestedAircraftTypeId, zz881.SuggestedAircraftTypeSource, zz881.SuggestedRegistration));
        // ZZ883's aircraft broadcasts no type of the catalog: its registration shows, the model decides the type.
        var zz883 = proposals.Single(item => item.FlightNumber == "ZZ883");
        Assert.Equal((AircraftTypeSuggestionSources.ProviderModel, "ZZ-0883"),
            (zz883.SuggestedAircraftTypeSource, zz883.SuggestedRegistration));
        // Only the map's worker reads the network.
        Assert.Equal(1, traffic.Reads);
    }

    /// <summary>A network with two aircraft near Punta Cana: DZZ881 a B38M and DZZ883 a type outside the catalog.</summary>
    private sealed class LiveTraffic : IAirTrafficProvider
    {
        public int Reads { get; private set; }

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution { get; } = new("Synthetic", "https://traffic.example.test", "Test", null);

        public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Reads++;
            var now = DateTimeOffset.UtcNow;
            return Task.FromResult(new AirTrafficReadResult(AirTrafficOutcome.Succeeded, Attribution, now,
            [
                new AirTrafficAircraft("0c0881", "DZZ881 ", "ZZ-1849", "B38M", "A3", 18.9, -68.9, 21000, false, 420, 120, -1200,
                    null, now),
                new AirTrafficAircraft("0c0883", "DZZ883", "zz-0883", "B739", "A3", 19.1, -68.7, 25000, false, 430, 110, -1000,
                    null, now),
            ], null));
        }
    }
}
