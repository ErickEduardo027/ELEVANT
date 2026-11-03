using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Integration;
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
    /// ADR-0028: a provider read keeps only contracted legs as proposals, harvests airlines and
    /// airports for free, OCC imports a pair into a turnaround with its contract, later reads
    /// update the confirmed legs, and the lease and budget come from the database.
    /// </summary>
    [Fact]
    public async Task FlightFeedIngestsContractedLegsAndOccImportsThem()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var seeded = await SeededFinanceProviderAsync(database, ct);
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddSingleton<IAirportFlightFeed, DisabledFeed>()
            .AddSingleton(FlightFeedBudget.Default)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
            }).Build()).BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var sync = scope.ServiceProvider.GetRequiredService<IFlightFeedSyncStore>();
        var occ = scope.ServiceProvider.GetRequiredService<IOccFlightFeedStore>();
        var now = DateTimeOffset.UtcNow;

        // The lease admits one holder at a time.
        var (first, second) = (Guid.NewGuid(), Guid.NewGuid());
        Assert.True(await sync.TryAcquireLeaseAsync("AeroDataBox", first, now, now.AddMinutes(5), ct));
        Assert.False(await sync.TryAcquireLeaseAsync("AeroDataBox", second, now, now.AddMinutes(5), ct));
        await sync.ReleaseLeaseAsync("AeroDataBox", first, ct);
        Assert.True(await sync.TryAcquireLeaseAsync("AeroDataBox", second, now, now.AddMinutes(5), ct));
        await sync.ReleaseLeaseAsync("AeroDataBox", second, ct);

        var station = Assert.Single(await sync.ListStationsAsync(now, ct), item => item.StationPublicId == SeededPujStation);
        // «Actualizar ahora» needs «Crear escalas» in planning and the station in scope.
        Assert.Equal(station, await sync.AuthorizeManualRefreshAsync(SeededOccAccount, SeededPujStation, ct));
        Assert.Null(await sync.AuthorizeManualRefreshAsync(SeededRampAgentAccount, SeededPujStation, ct));
        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZoneId);
        // Keep both legs on today's local date at the station.
        var localNoon = TimeZoneInfo.ConvertTime(now, zone).Date.AddHours(12);
        var arrivalAt = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localNoon, DateTimeKind.Unspecified), zone));
        FeedFlight Leg(FlightDirection direction, string number, string airline, string? iata, string? icao, DateTimeOffset at,
            FeedAirport counterpart, DateTimeOffset? revised = null) =>
            new(direction, number, new FeedAirline(airline, iata, icao), counterpart, at, revised, null, "Expected", "HI1055",
                "Boeing 737", "B", "22", false, "IsOperator");
        var origin = new FeedAirport("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", "America/Santo_Domingo", 18.5m, -69.5m);
        var destination = new FeedAirport("XQB", "XQBB", "Synthetic Destination", null, "US", "America/New_York", null, null);
        var flights = new[]
        {
            Leg(FlightDirection.Arrival, "ZZ161", "Demo Airlines", "ZZ", null, arrivalAt, origin),
            Leg(FlightDirection.Departure, "ZZ162", "Demo Airlines", "ZZ", null, arrivalAt.AddMinutes(90), destination),
            Leg(FlightDirection.Arrival, "Q9100", "Synthetic Other Air", "Q9", "QNA", arrivalAt, origin),
        };
        var call = new FlightFeedCall("AeroDataBox", station, localNoon.AddHours(-2), localNoon.AddHours(10),
            ProviderCallTrigger.Scheduled, null, now);
        var ingest = await sync.RecordAsync(call, new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null, flights), ct);
        Assert.Equal((3, 2, 2, 0, 2, 2), (ingest.FlightsReceived, ingest.ContractedLegs, ingest.NewProposals, ingest.UpdatedLegs,
            ingest.AirlinesSeen, ingest.AirportsAdded));
        Assert.Equal(2, (await sync.GetStateAsync("AeroDataBox", now, ct)).UnitsToday);
        var activity = await sync.GetActivityAsync("AeroDataBox", station, now, ct);
        Assert.Single(activity.RecentFetches);
        Assert.Contains(arrivalAt, activity.ContractedFlightTimesToday);
        var airport = await context.Airports.AsNoTracking().SingleAsync(item => item.IataCode == "XQA", ct);
        Assert.Equal(("XQAA", "America/Santo_Domingo", 18.5m), (airport.IcaoCode, airport.IanaTimeZone, airport.Latitude));

        // The airline seen for free answers registry checks first.
        var observed = scope.ServiceProvider.GetServices<IAirlineRegistrySource>().Single(source => source.Order == 0);
        Assert.Equal("Synthetic Other Air", Assert.Single((await observed.FindAsync("Q9", null, ct))!).Name);
        Assert.Null(await observed.FindAsync("Q7", null, ct));

        // OCC reads the proposals with the suggested pair; a ramp agent cannot.
        Assert.Null(await occ.ListAsync(SeededRampAgentAccount, SeededPujStation, DateOnly.FromDateTime(localNoon), ct));
        var feed = (await occ.ListAsync(SeededOccAccount, SeededPujStation, DateOnly.FromDateTime(localNoon), ct))!;
        Assert.Equal((false, 2, 1200), (feed.Budget.Configured, feed.Budget.UnitsToday, feed.Budget.DailyUnits));
        var arrival = Assert.Single(feed.Proposals, item => item.Direction == "Arrival");
        var departure = Assert.Single(feed.Proposals, item => item.Direction == "Departure");
        Assert.Equal(departure.ProposalId, arrival.SuggestedDepartureId);
        Assert.Null(departure.SuggestedDepartureId);
        Assert.True(arrival.CounterpartKnown);

        // Import the pair: a turnaround with the contract that covers it; repeating returns the same one.
        Assert.Equal(OccFlightFeedFailure.Forbidden,
            (await occ.ImportAsync(SeededRampAgentAccount, arrival.ProposalId, departure.ProposalId, ct)).Failure);
        Assert.Equal(OccFlightFeedFailure.Conflict,
            (await occ.ImportAsync(SeededOccAccount, departure.ProposalId, arrival.ProposalId, ct)).Failure);
        var imported = await occ.ImportAsync(SeededOccAccount, arrival.ProposalId, departure.ProposalId, ct);
        Assert.Null(imported.Failure);
        var replay = await occ.ImportAsync(SeededOccAccount, arrival.ProposalId, departure.ProposalId, ct);
        Assert.Equal((imported.TurnaroundId, true), (replay.TurnaroundId, replay.Replayed));
        var turnaround = await context.Turnarounds.AsNoTracking().SingleAsync(item => item.PublicId == imported.TurnaroundId, ct);
        var version = await context.ContractVersions.AsNoTracking().Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.Id).SingleAsync(ct);
        Assert.Equal((OperationalDataSource.ExternalProvider, "AeroDataBox", (long?)version, "HI1055"),
            (turnaround.Source, turnaround.ExternalProvider, turnaround.ContractVersionId, turnaround.AircraftRegistration));
        Assert.Equal(2, await context.FlightLegs.CountAsync(leg => leg.TurnaroundId == turnaround.Id, ct));

        // A later read updates the confirmed leg; a new leg can be dismissed once, a confirmed one cannot.
        context.ChangeTracker.Clear();
        var later = new[]
        {
            Leg(FlightDirection.Arrival, "ZZ161", "Demo Airlines", "ZZ", null, arrivalAt, origin, arrivalAt.AddMinutes(25)),
            Leg(FlightDirection.Arrival, "ZZ301", "Demo Airlines", null, null, arrivalAt.AddHours(3), origin),
        };
        later[1] = later[1] with { Airline = new FeedAirline("Demo Airlines", "ZZ", null) };
        var refresh = await sync.RecordAsync(call with { OccurredAt = now.AddMinutes(15), Trigger = ProviderCallTrigger.Manual },
            new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null, later), ct);
        Assert.Equal((1, 1), (refresh.NewProposals, refresh.UpdatedLegs));
        Assert.Equal(arrivalAt.AddMinutes(25), await context.FlightLegs.AsNoTracking()
            .Where(leg => leg.TurnaroundId == turnaround.Id && leg.Direction == FlightDirection.Arrival)
            .Select(leg => leg.EstimatedAt).SingleAsync(ct));
        var extra = await context.Set<ExternalFlightProposal>().AsNoTracking().SingleAsync(item => item.FlightNumber == "ZZ301", ct);
        Assert.Null(await occ.DismissAsync(SeededOccAccount, extra.PublicId, ct));
        Assert.Null(await occ.DismissAsync(SeededOccAccount, extra.PublicId, ct));
        Assert.Equal(OccFlightFeedFailure.Conflict, await occ.DismissAsync(SeededOccAccount, arrival.ProposalId, ct));
        var afterDismiss = (await occ.ListAsync(SeededOccAccount, SeededPujStation, DateOnly.FromDateTime(localNoon), ct))!;
        Assert.DoesNotContain(afterDismiss.Proposals, item => item.ProposalId == extra.PublicId);
        Assert.Equal(4, afterDismiss.Budget.UnitsToday);
        Assert.NotNull(afterDismiss.NextManualRefreshAt);

        // A failed call is still recorded but changes nothing else.
        await sync.RecordAsync(call with { OccurredAt = now.AddMinutes(20) },
            AirportFeedResponse.Failure(ProviderCallOutcome.RateLimited, 0, 429), ct);
        Assert.Equal(3, await context.Set<ProviderUsageEntry>().CountAsync(ct));
        Assert.Equal(2, (await sync.GetActivityAsync("AeroDataBox", station, now.AddMinutes(21), ct)).RecentFetches.Count);
    }

    private sealed class DisabledFeed : IAirportFlightFeed
    {
        public string Provider => "AeroDataBox";

        public bool IsConfigured => false;

        public int UnitsPerCall => 2;

        public TimeSpan MaxWindow => TimeSpan.FromHours(12);

        public Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
            CancellationToken cancellationToken = default) => throw new InvalidOperationException("Tests never call the provider.");
    }
}
