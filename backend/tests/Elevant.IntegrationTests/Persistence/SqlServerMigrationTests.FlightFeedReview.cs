using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Integrations.SimulatedFlightFeed;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// 2-B, 2-N16, 2-N36: the feed keeps the legs of every registered airline; OCC reviews the contracted ones,
    /// the charter candidates apart and the dismissed ones; imports a pair with its aircraft type and stand or as
    /// a charter, never a carrier whose contract at the station is suspended; and restores a dismissed proposal
    /// while its flight has not passed. Every refusal has its code.
    /// </summary>
    [Fact]
    public async Task FlightFeedReviewImportsWithTypeStandAndCharterAndRestoresDismissedProposals()
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
        // Tomorrow at the station keeps every leg ahead of now; yesterday's leg has passed.
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).Date);
        var day = today.AddDays(1);
        DateTimeOffset At(DateOnly date, int hour, int minute = 0) =>
            new(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(new TimeOnly(hour, minute)), zone));
        await CharterAirlineAsync(context, "C9", "CQZ", "Charter Air", ct);
        var origin = new FeedAirport("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", "America/Santo_Domingo", 18.5m, -69.5m);
        FeedFlight Leg(FlightDirection direction, string number, string airline, string iata, DateTimeOffset at, string registration,
            string model = "Airbus A320") =>
            new(direction, number, new FeedAirline(airline, iata, null), origin, at, null, null, "Expected", registration, model,
                "A", "3", false, "IsOperator");
        var call = new FlightFeedCall("AeroDataBox", station, day.ToDateTime(new TimeOnly(6, 0)),
            day.ToDateTime(new TimeOnly(18, 0)), ProviderCallTrigger.Manual, null, now);
        var ingest = await sync.RecordAsync(call, new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
        [
            Leg(FlightDirection.Arrival, "ZZ161", "Demo Airlines", "ZZ", At(day, 10), "HI1001"),
            Leg(FlightDirection.Departure, "ZZ162", "Demo Airlines", "ZZ", At(day, 11, 30), "HI1001"),
            Leg(FlightDirection.Arrival, "ZZ171", "Demo Airlines", "ZZ", At(day, 10, 15), "HI1002", "Boeing 737-800"),
            Leg(FlightDirection.Departure, "ZZ172", "Demo Airlines", "ZZ", At(day, 11, 45), "HI1002", "Boeing 737-800"),
            Leg(FlightDirection.Arrival, "C9100", "Charter Air", "C9", At(day, 13), "HI2001"),
            Leg(FlightDirection.Departure, "C9101", "Charter Air", "C9", At(day, 14, 30), "HI2001"),
            Leg(FlightDirection.Arrival, "Q9100", "Unregistered Air", "Q9", At(day, 13), "HI3001"),
        ]), ct);
        // Registered airlines come at no extra cost; only the contracted legs count for the cadence.
        Assert.Equal((7, 4, 6), (ingest.FlightsReceived, ingest.ContractedLegs, ingest.NewProposals));
        Assert.DoesNotContain(await context.Set<ExternalFlightProposal>().AsNoTracking().Select(item => item.FlightNumber)
            .ToArrayAsync(ct), number => number == "Q9100");

        async Task<IReadOnlyList<OccFlightProposalData>> View(OccFlightFeedView view, DateOnly? date = null) =>
            (await occ.ListAsync(SeededOccAccount, SeededPujStation, date ?? day, view, ct))!.Proposals;
        var contracted = await View(OccFlightFeedView.Contracted);
        Assert.Equal(["ZZ161", "ZZ171", "ZZ162", "ZZ172"], contracted.Select(item => item.FlightNumber));
        var charter = await View(OccFlightFeedView.Charter);
        Assert.Equal(["C9100", "C9101"], charter.Select(item => item.FlightNumber));
        Assert.Empty(await View(OccFlightFeedView.Dismissed));
        var (zz161, zz162) = Proposal(contracted, "ZZ161");
        var (zz171, zz172) = Proposal(contracted, "ZZ171");

        // The provider's model suggests the seeded A320; a Boeing 737-800 matches no type yet.
        var a320 = await context.AircraftTypes.AsNoTracking().Where(item => item.IcaoCode == "A320")
            .Select(item => new { item.Id, item.PublicId }).SingleAsync(ct);
        Assert.Equal(a320.PublicId, zz161.SuggestedAircraftTypeId);
        Assert.Null(zz171.SuggestedAircraftTypeId);
        var standA01 = await context.Stands.AsNoTracking().Where(item => item.Code == "A01")
            .Select(item => new { item.Id, item.PublicId }).SingleAsync(ct);

        // A carrier with a contract never flies as a charter; a key needs both versions; the type must be active.
        Assert.Equal("charter_has_contract", (await occ.ImportAsync(SeededOccAccount,
            new OccFlightImportInput(zz161.ProposalId, zz162.ProposalId, Charter: true), null, ct)).Code);
        Assert.Equal("expected_version_required", (await occ.ImportAsync(SeededOccAccount,
            new OccFlightImportInput(zz161.ProposalId, zz162.ProposalId), Guid.NewGuid(), ct)).Code);
        Assert.Equal("aircraft_type_unavailable", (await occ.ImportAsync(SeededOccAccount,
            new OccFlightImportInput(zz161.ProposalId, zz162.ProposalId, Guid.NewGuid(), null, false, zz161.Version, zz162.Version),
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("version_conflict", (await occ.ImportAsync(SeededOccAccount,
            new OccFlightImportInput(zz161.ProposalId, zz162.ProposalId, a320.PublicId, null, false, "AAAAAAAAAAA=", zz162.Version),
            Guid.NewGuid(), ct)).Code);

        // Imported with its type and stand; the same key replays, another body with it is a conflict.
        var key = Guid.NewGuid();
        var input = new OccFlightImportInput(zz161.ProposalId, zz162.ProposalId, a320.PublicId, standA01.PublicId, false,
            zz161.Version, zz162.Version);
        var imported = await occ.ImportAsync(SeededOccAccount, input, key, ct);
        Assert.Null(imported.Failure);
        var replay = await occ.ImportAsync(SeededOccAccount, input, key, ct);
        Assert.Equal((imported.TurnaroundId, true), (replay.TurnaroundId, replay.Replayed));
        Assert.Equal("idempotency_conflict", (await occ.ImportAsync(SeededOccAccount, input with { StandId = null }, key, ct)).Code);
        Assert.Equal("flight_proposal_closed", (await occ.ImportAsync(SeededOccAccount, input, Guid.NewGuid(), ct)).Code);
        var turnaround = await context.Turnarounds.AsNoTracking().SingleAsync(item => item.PublicId == imported.TurnaroundId, ct);
        Assert.Equal(a320.Id, turnaround.AircraftTypeId);
        Assert.NotNull(turnaround.ContractVersionId);
        Assert.True(await context.Set<StandAssignment>().AsNoTracking().AnyAsync(item => item.TurnaroundId == turnaround.Id &&
            item.StandId == standA01.Id && item.AssignedTo == null, ct));

        // The second pair overlaps on A01: the stand is taken for its window.
        var taken = await occ.ImportAsync(SeededOccAccount, new OccFlightImportInput(zz171.ProposalId, zz172.ProposalId, null,
            standA01.PublicId, false, zz171.Version, zz172.Version), Guid.NewGuid(), ct);
        Assert.Equal("stand_unavailable", taken.Code);
        Assert.Contains("stand_taken", taken.Reasons!);

        // A carrier without contract comes in only as a charter, with its prepayment pending (ADR-0033).
        var (c9100, c9101) = Proposal(charter, "C9100");
        Assert.Equal("charter_required", (await occ.ImportAsync(SeededOccAccount,
            new OccFlightImportInput(c9100.ProposalId, c9101.ProposalId), null, ct)).Code);
        var charterImport = await occ.ImportAsync(SeededOccAccount, new OccFlightImportInput(c9100.ProposalId, c9101.ProposalId,
            null, null, true, c9100.Version, c9101.Version), Guid.NewGuid(), ct);
        Assert.Null(charterImport.Failure);
        var charterTurnaround = await context.Turnarounds.AsNoTracking()
            .SingleAsync(item => item.PublicId == charterImport.TurnaroundId, ct);
        Assert.Null(charterTurnaround.ContractVersionId);
        Assert.Equal(CharterPrepaymentStatus.Pending, await context.Set<CharterAgreement>().AsNoTracking()
            .Where(item => item.TurnaroundId == charterTurnaround.Id).Select(item => item.PrepaymentStatus).SingleAsync(ct));

        // Suspended at the station: its proposals leave every view and its import is refused (2-N16).
        var contractId = await SeededContractIdAsync(context, ct);
        await context.Contracts.Where(item => item.Id == contractId)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.Status, ContractStatus.Suspended), ct);
        Assert.DoesNotContain(await View(OccFlightFeedView.Contracted), item => item.AirlineName == "Demo Airlines");
        Assert.DoesNotContain(await View(OccFlightFeedView.Charter), item => item.AirlineName == "Demo Airlines");
        Assert.Equal("contract_not_in_force", (await occ.ImportAsync(SeededOccAccount, new OccFlightImportInput(zz171.ProposalId,
            zz172.ProposalId, null, null, true, zz171.Version, zz172.Version), Guid.NewGuid(), ct)).Code);
        await context.Contracts.Where(item => item.Id == contractId)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.Status, ContractStatus.Active), ct);

        // The dismissal takes the version on screen with its key (2-N36): the key needs the version, a stale version is
        // a conflict, an imported proposal is closed and the same key replays the first result.
        Assert.Equal("expected_version_required", (await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, null,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("version_conflict", (await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, "AAAAAAAAAAA=",
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("flight_proposal_closed", (await occ.DismissAsync(SeededOccAccount, zz161.ProposalId, zz161.Version,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("forbidden", (await occ.DismissAsync(SeededRampAgentAccount, zz171.ProposalId, zz171.Version,
            Guid.NewGuid(), ct)).Code);
        var dismissKey = Guid.NewGuid();
        var dismissal = await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, zz171.Version, dismissKey, ct);
        Assert.Null(dismissal.Failure);
        Assert.False(dismissal.Replayed);
        Assert.True((await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, zz171.Version, dismissKey, ct)).Replayed);
        Assert.Equal("idempotency_conflict", (await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, "AAAAAAAAAAA=",
            dismissKey, ct)).Code);

        // A dismissed proposal comes back while its flight has not passed (2-N36).
        var dismissed = Assert.Single(await View(OccFlightFeedView.Dismissed));
        Assert.Equal(("ZZ171", "Dismissed"), (dismissed.FlightNumber, dismissed.Status));
        Assert.Equal("forbidden", (await occ.RestoreAsync(SeededRampAgentAccount, dismissed.ProposalId, dismissed.Version,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("expected_version_required", (await occ.RestoreAsync(SeededOccAccount, dismissed.ProposalId, null,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("version_conflict", (await occ.RestoreAsync(SeededOccAccount, dismissed.ProposalId, zz171.Version,
            Guid.NewGuid(), ct)).Code);
        var restoreKey = Guid.NewGuid();
        var restored = await occ.RestoreAsync(SeededOccAccount, dismissed.ProposalId, dismissed.Version, restoreKey, ct);
        Assert.Null(restored.Failure);
        var restoredAgain = await occ.RestoreAsync(SeededOccAccount, dismissed.ProposalId, dismissed.Version, restoreKey, ct);
        Assert.Equal((restored.Version, true), (restoredAgain.Version, restoredAgain.Replayed));
        Assert.Equal("flight_proposal_not_dismissed", (await occ.RestoreAsync(SeededOccAccount, dismissed.ProposalId,
            restored.Version, Guid.NewGuid(), ct)).Code);
        // Retrying the uncertain dismissal after the restore replays it instead of dismissing the proposal again, and a
        // new dismissal with the version seen before the restore is stale.
        Assert.True((await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, zz171.Version, dismissKey, ct)).Replayed);
        Assert.Equal("version_conflict", (await occ.DismissAsync(SeededOccAccount, zz171.ProposalId, zz171.Version,
            Guid.NewGuid(), ct)).Code);
        Assert.Contains(await View(OccFlightFeedView.Contracted), item => item.ProposalId == dismissed.ProposalId &&
            item.Status == "Proposed" && item.Version == restored.Version);
        Assert.Equal(["occ.flight_proposal.dismissed", "occ.flight_proposal.restored"], await context.AuditEntries.AsNoTracking()
            .Where(item => item.EntityPublicId == dismissed.ProposalId).OrderBy(item => item.Id).Select(item => item.Action)
            .ToArrayAsync(ct));

        // Yesterday's leg has passed: dismissed, it stays dismissed.
        var yesterday = today.AddDays(-1);
        await sync.RecordAsync(call with
        {
            FromLocal = yesterday.ToDateTime(new TimeOnly(6, 0)), ToLocal = yesterday.ToDateTime(new TimeOnly(18, 0)),
            OccurredAt = now.AddMinutes(1),
        }, new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
            [Leg(FlightDirection.Arrival, "ZZ401", "Demo Airlines", "ZZ", At(yesterday, 10), "HI1003")]), ct);
        var past = Assert.Single(await View(OccFlightFeedView.Contracted, yesterday));
        Assert.Null((await occ.DismissAsync(SeededOccAccount, past.ProposalId, cancellationToken: ct)).Failure);
        var pastDismissed = Assert.Single(await View(OccFlightFeedView.Dismissed, yesterday));
        // Dismissing it again with its current version leaves it as it is.
        Assert.Null((await occ.DismissAsync(SeededOccAccount, pastDismissed.ProposalId, pastDismissed.Version, Guid.NewGuid(),
            ct)).Failure);
        Assert.Equal(pastDismissed.Version, Assert.Single(await View(OccFlightFeedView.Dismissed, yesterday)).Version);
        Assert.Equal("flight_proposal_passed", (await occ.RestoreAsync(SeededOccAccount, pastDismissed.ProposalId,
            pastDismissed.Version, Guid.NewGuid(), ct)).Code);
    }

    /// <summary>
    /// 2-B: the simulated feed of Development and Test answers a deterministic timetable of the registered
    /// airlines through the same synchronizer, with its own ledger, and never feeds the airline registry.
    /// </summary>
    [Fact]
    public async Task SimulatedFlightFeedProposesRegisteredAirlinesWithItsOwnLedger()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var seeded = await SeededFinanceProviderAsync(database, ct);
        await using var provider = FeedProvider(database, null);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var sync = scope.ServiceProvider.GetRequiredService<IFlightFeedSyncStore>();
        var feed = scope.ServiceProvider.GetRequiredService<IAirportFlightFeed>();
        Assert.IsType<SimulatedAirportFlightFeed>(feed);
        var registry = await context.Set<AirlineRegistryEntry>().AsNoTracking().CountAsync(ct);
        var synchronizer = new FlightFeedSynchronizer(sync, feed, TimeProvider.System, FlightFeedBudget.Default);

        var result = await synchronizer.RefreshNowAsync(SeededOccAccount, SeededPujStation, ct);
        Assert.Equal(FlightFeedRefreshStatus.Refreshed, result.Status);
        Assert.True(result.Ingest!.ContractedLegs >= 2);
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(2, (await sync.GetStateAsync(SimulatedAirportFlightFeed.ProviderName, now, ct)).UnitsToday);
        Assert.Equal(0, (await sync.GetStateAsync("AeroDataBox", now, ct)).UnitsToday);
        Assert.Equal(registry, await context.Set<AirlineRegistryEntry>().AsNoTracking().CountAsync(ct));
        var proposals = await context.Set<ExternalFlightProposal>().AsNoTracking().ToArrayAsync(ct);
        Assert.NotEmpty(proposals);
        Assert.All(proposals, item =>
        {
            Assert.Equal(SimulatedAirportFlightFeed.ProviderName, item.Provider);
            Assert.NotNull(item.AircraftModel);
            Assert.NotNull(item.CounterpartAirportId);
        });
        // OCC can import what the simulation proposed: the suggested departure is the same aircraft.
        var date = proposals.First(item => item.Direction == FlightDirection.Arrival).OperationDate;
        var occ = scope.ServiceProvider.GetRequiredService<IOccFlightFeedStore>();
        var listed = (await occ.ListAsync(SeededOccAccount, SeededPujStation, date, cancellationToken: ct))!;
        Assert.Equal(SimulatedAirportFlightFeed.ProviderName, listed.Budget.Provider);
        Assert.True(listed.Budget.Configured);
        var arrival = listed.Proposals.First(item => item.Direction == "Arrival" && item.SuggestedDepartureId is not null);
        var departure = listed.Proposals.Single(item => item.ProposalId == arrival.SuggestedDepartureId);
        Assert.Equal(arrival.AircraftRegistration, departure.AircraftRegistration);
        var imported = await occ.ImportAsync(SeededOccAccount, new OccFlightImportInput(arrival.ProposalId, departure.ProposalId,
            null, null, false, arrival.Version, departure.Version), Guid.NewGuid(), ct);
        Assert.Null(imported.Failure);
    }

    private static ServiceProvider FeedProvider(TemporaryDatabase database, IAirportFlightFeed? feed)
    {
        var services = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddSingleton(FlightFeedBudget.Default);
        if (feed is not null) services.AddSingleton(feed);
        else
            services.AddSingleton<IAirportFlightFeed>(provider =>
                new SimulatedAirportFlightFeed(provider.GetRequiredService<ISimulatedFlightFeedCatalog>()));
        return services.AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
        }).Build()).BuildServiceProvider();
    }

    /// <summary>An active airline with an active organization and no contract: a charter candidate (ADR-0033).</summary>
    private static async Task CharterAirlineAsync(ElevantDbContext context, string iata, string icao, string name,
        CancellationToken ct)
    {
        var organization = new Organization
        {
            PublicId = Guid.CreateVersion7(), Code = $"{icao}-CHARTER", LegalName = $"{name} Ltd.", DisplayName = name,
            Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Organizations.Add(organization);
        await context.SaveChangesAsync(ct);
        context.Airlines.Add(new Airline
        {
            PublicId = Guid.CreateVersion7(), OrganizationId = organization.Id, IataCode = iata, IcaoCode = icao, Name = name,
            IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
    }

    /// <summary>An arrival of the list and the departure it pairs with.</summary>
    private static (OccFlightProposalData Arrival, OccFlightProposalData Departure) Proposal(
        IReadOnlyList<OccFlightProposalData> proposals, string arrivalNumber)
    {
        var arrival = proposals.Single(item => item.FlightNumber == arrivalNumber);
        return (arrival, proposals.Single(item => item.ProposalId == arrival.SuggestedDepartureId));
    }
}
