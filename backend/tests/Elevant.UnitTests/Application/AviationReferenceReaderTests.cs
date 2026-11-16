using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Integration.AviationReference;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0028 (note of 15 November 2026): the on-demand reference reads go through one cache in memory, the caps of each
/// read and the ceiling of the provider, all counted in the usage ledger, and every call is recorded there. A cap reached
/// or a failing provider is a typed state, never an exception. The provider, the ledger and the clock are stubs with
/// invented answers: nothing reaches a database or AeroDataBox.
/// </summary>
public sealed class AviationReferenceReaderTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000071");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");

    private static readonly AircraftFacts Aircraft = new("HI1055", true, "Boeing 737 MAX 8", "Boeing 737", "B38M", "7M8",
        "Demo Airlines", "99999", "0C2ABC", 189, 2, "Jet", 4.2, new DateOnly(2022, 3, 1), new DateOnly(2022, 4, 2),
        new DateOnly(2022, 4, 2), false);

    private static Task<AviationReferenceRead<AircraftFacts>> ReadAircraft(AviationReferenceReader reader, Ledger ledger,
        string registration = "HI1055") =>
        reader.ReadAsync(AviationReferenceKind.Aircraft, registration,
            (provider, token) => provider.GetAircraftAsync(registration, token), _ => 1, ledger, PuntaCana, AccountId,
            TestContext.Current.CancellationToken);

    [Fact]
    public async Task WithoutAProviderNothingIsCalledOrRecorded()
    {
        var provider = new StubProvider { Configured = false };
        var ledger = new Ledger();
        var read = await ReadAircraft(new AviationReferenceReader(provider, AviationReferenceLimits.Default, new Clock(Start)),
            ledger);

        Assert.Equal(AviationReferenceStatus.Disabled, read.Status);
        Assert.Equal(0, provider.Calls);
        Assert.Empty(ledger.Records);
    }

    [Fact]
    public async Task AnAnswerIsKeptForItsPeriodAndRecordedOnce()
    {
        var clock = new Clock(Start);
        var provider = new StubProvider();
        var ledger = new Ledger();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, clock);

        var first = await ReadAircraft(reader, ledger);
        clock.Now = Start.AddHours(23);
        var second = await ReadAircraft(reader, ledger);

        Assert.Equal((AviationReferenceStatus.Available, "B38M", Start), (first.Status, first.Value!.IcaoType, first.RetrievedAt));
        Assert.Equal(AviationReferenceStatus.Available, second.Status);
        Assert.Equal(1, provider.Calls);
        var record = Assert.Single(ledger.Records);
        Assert.Equal(("AeroDataBox", "aircraft", 1, ProviderCallTrigger.OnDemand, PuntaCana, AccountId),
            (record.Provider, record.Operation, record.Units, record.Trigger, record.StationId, record.RequestedBy));

        clock.Now = Start.AddHours(24);
        await ReadAircraft(reader, ledger);
        Assert.Equal(2, provider.Calls);
    }

    [Fact]
    public async Task TheDailyCapStopsTheCallAndKeepsTheLastValue()
    {
        var clock = new Clock(Start);
        var provider = new StubProvider();
        var ledger = new Ledger();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, clock);
        await ReadAircraft(reader, ledger);

        clock.Now = Start.AddDays(1).AddHours(1);
        ledger.OperationToday = AviationReferenceLimits.Default.Aircraft.DailyUnits;
        var capped = await ReadAircraft(reader, ledger);
        var other = await ReadAircraft(reader, ledger, "N12345");

        Assert.Equal((AviationReferenceStatus.DailyLimitReached, "HI1055"), (capped.Status, capped.Value!.Registration));
        Assert.Equal(Start, capped.RetrievedAt);
        Assert.Equal((AviationReferenceStatus.DailyLimitReached, null), (other.Status, other.Value));
        Assert.Equal(1, provider.Calls);
    }

    [Fact]
    public async Task TheMonthlyCapAndTheProviderCeilingStopTheCall()
    {
        var provider = new StubProvider();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, new Clock(Start));

        var month = await ReadAircraft(reader, new Ledger { OperationMonth = AviationReferenceLimits.Default.Aircraft.MonthlyUnits });
        var ceiling = await ReadAircraft(reader, new Ledger { ProviderMonth = AviationReferenceLimits.Default.ProviderMonthlyUnits });

        Assert.Equal(AviationReferenceStatus.MonthlyLimitReached, month.Status);
        Assert.Equal(AviationReferenceStatus.MonthlyLimitReached, ceiling.Status);
        Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task NothingFoundIsKeptAsNotFound()
    {
        var provider = new StubProvider { Answer = _ => new ReferenceCall<AircraftFacts>(ProviderCallOutcome.NoContent, 1, 204, null, null) };
        var ledger = new Ledger();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, new Clock(Start));

        var first = await ReadAircraft(reader, ledger, "N0NE");
        var second = await ReadAircraft(reader, ledger, "N0NE");

        Assert.Equal((AviationReferenceStatus.NotFound, AviationReferenceStatus.NotFound), (first.Status, second.Status));
        Assert.Equal(1, provider.Calls);
        Assert.Equal(1, Assert.Single(ledger.Records).Units);
    }

    [Fact]
    public async Task AFailureIsNotRetriedForFiveMinutes()
    {
        var clock = new Clock(Start);
        var provider = new StubProvider { Answer = _ => ReferenceCall<AircraftFacts>.Failure(ProviderCallOutcome.Failed, 0, 503) };
        var ledger = new Ledger();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, clock);

        var failed = await ReadAircraft(reader, ledger);
        clock.Now = Start.AddMinutes(4);
        var waiting = await ReadAircraft(reader, ledger);
        clock.Now = Start.AddMinutes(5);
        provider.Answer = _ => new ReferenceCall<AircraftFacts>(ProviderCallOutcome.Succeeded, 1, 200, null, Aircraft);
        var recovered = await ReadAircraft(reader, ledger);

        Assert.Equal((AviationReferenceStatus.Unavailable, AviationReferenceStatus.Unavailable, AviationReferenceStatus.Available),
            (failed.Status, waiting.Status, recovered.Status));
        Assert.Equal(2, provider.Calls);
        Assert.Equal(ProviderCallOutcome.Failed, ledger.Records[0].Outcome);
    }

    [Fact]
    public async Task AnExhaustedQuotaPausesEveryReadUntilTheNextUtcDay()
    {
        var clock = new Clock(Start);
        var provider = new StubProvider { Answer = _ => ReferenceCall<AircraftFacts>.Failure(ProviderCallOutcome.QuotaExceeded, 0, 429) };
        var ledger = new Ledger();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, clock);

        var exhausted = await ReadAircraft(reader, ledger);
        var other = await ReadAircraft(reader, ledger, "N12345");
        clock.Now = new DateTimeOffset(2026, 11, 16, 0, 0, 0, TimeSpan.Zero);
        provider.Answer = _ => new ReferenceCall<AircraftFacts>(ProviderCallOutcome.Succeeded, 1, 200, null, Aircraft);
        var nextDay = await ReadAircraft(reader, ledger, "N12345");

        Assert.Equal(AviationReferenceStatus.MonthlyLimitReached, exhausted.Status);
        Assert.Equal(AviationReferenceStatus.Unavailable, other.Status);
        Assert.Equal(AviationReferenceStatus.Available, nextDay.Status);
        Assert.Equal(2, provider.Calls);
    }

    [Fact]
    public async Task ConcurrentReadsOfOneSubjectMakeOneCall()
    {
        var release = new TaskCompletionSource();
        var provider = new StubProvider { Wait = release.Task };
        var ledger = new Ledger();
        var reader = new AviationReferenceReader(provider, AviationReferenceLimits.Default, new Clock(Start));

        var reads = Enumerable.Range(0, 5).Select(_ => ReadAircraft(reader, ledger)).ToArray();
        release.SetResult();
        var results = await Task.WhenAll(reads);

        Assert.All(results, read => Assert.Equal(AviationReferenceStatus.Available, read.Status));
        Assert.Equal(1, provider.Calls);
        Assert.Single(ledger.Records);
    }

    [Fact]
    public void TheDefaultCapsFitTheStarterPlanNextToTheFeed()
    {
        var limits = AviationReferenceLimits.Default;
        var monthly = limits.AirlineFleet.MonthlyUnits + limits.Aircraft.MonthlyUnits + limits.AirportRoutes.MonthlyUnits +
            limits.AirportDelays.MonthlyUnits;

        Assert.Equal((6, 1, 6, 6), (limits.AirlineFleet.UnitsPerCall, limits.Aircraft.UnitsPerCall,
            limits.AirportRoutes.UnitsPerCall, limits.AirportDelays.UnitsPerCall));
        Assert.Equal((TimeSpan.FromDays(7), TimeSpan.FromDays(1), TimeSpan.FromHours(24), TimeSpan.FromHours(1)),
            (limits.AirlineFleet.CacheFor, limits.Aircraft.CacheFor, limits.AirportRoutes.CacheFor, limits.AirportDelays.CacheFor));
        // The Development VPS gives the feed 9 000 units a month: together they stay far below the plan's 40 000.
        Assert.True(monthly + 9000 <= 12000, $"The reference reads may spend {monthly} units a month.");
    }

    [Fact]
    public async Task ADemoRegistrationIsNeverAsked()
    {
        var provider = new StubProvider();
        var handler = new GetOccAviationReferenceHandler(new Resolver(Member("operations.dashboard.read")), new Airports(),
            new AviationReferenceReader(provider, AviationReferenceLimits.Default, new Clock(Start)), new Ledger(),
            new Clock(Start));

        var result = await handler.AircraftAsync(AccountId, PuntaCana, "hi-dm07", TestContext.Current.CancellationToken);

        Assert.Equal((AviationReferenceStatus.NotApplicable, "HIDM07"), (result.Value!.Status, result.Value.Subject));
        Assert.Equal(0, provider.Calls);
    }

    [Theory]
    [InlineData(null, AviationReferenceFailure.InvalidRequest)]
    [InlineData("HI 1055!", AviationReferenceFailure.InvalidRequest)]
    public async Task AMalformedRegistrationIsRefused(string? registration, AviationReferenceFailure failure)
    {
        var handler = new GetOccAviationReferenceHandler(new Resolver(Member("operations.dashboard.read")), new Airports(),
            new AviationReferenceReader(new StubProvider(), AviationReferenceLimits.Default, new Clock(Start)), new Ledger(),
            new Clock(Start));

        var result = await handler.AircraftAsync(AccountId, PuntaCana, registration, TestContext.Current.CancellationToken);

        Assert.Equal(failure, result.Failure);
    }

    [Fact]
    public async Task TheOccReadsNeedAMapPermissionAndTheStationInScope()
    {
        var reader = new AviationReferenceReader(new StubProvider(), AviationReferenceLimits.Default, new Clock(Start));
        var forbidden = new GetOccAviationReferenceHandler(new Resolver(Member("finance.home.read")), new Airports(), reader,
            new Ledger(), new Clock(Start));
        var allowed = new GetOccAviationReferenceHandler(new Resolver(Member("operations.positions_map.read")), new Airports(),
            reader, new Ledger(), new Clock(Start));

        Assert.Equal(AviationReferenceFailure.Forbidden,
            (await forbidden.DelaysAsync(AccountId, PuntaCana, null, TestContext.Current.CancellationToken)).Failure);
        Assert.Equal(AviationReferenceFailure.NotFound,
            (await allowed.RoutesAsync(AccountId, Guid.Parse("20000000-0000-7000-8000-000000000099"),
                TestContext.Current.CancellationToken)).Failure);
        var delays = await allowed.DelaysAsync(AccountId, PuntaCana, "sdq", TestContext.Current.CancellationToken);
        Assert.Equal("SDQ", delays.Value!.Subject);
        var own = await allowed.DelaysAsync(AccountId, PuntaCana, null, TestContext.Current.CancellationToken);
        Assert.Equal("MDPC", own.Value!.Subject);
    }

    [Fact]
    public async Task TheFleetIsForContratosAndTheSuperadministrator()
    {
        var reader = new AviationReferenceReader(new StubProvider(), AviationReferenceLimits.Default, new Clock(Start));
        GetAirlineFleetHandler Handler(ActorContext actor) => new(new Resolver(actor), reader, new Ledger(), new Clock(Start));

        var occ = await Handler(Member("operations.dashboard.read")).HandleAsync(AccountId, "ZZA", TestContext.Current.CancellationToken);
        var contratos = await Handler(Member("contracts.requests.read")).HandleAsync(AccountId, "zza", TestContext.Current.CancellationToken);
        var invalid = await Handler(Member("contracts.requests.read")).HandleAsync(AccountId, "ZZ-A", TestContext.Current.CancellationToken);

        Assert.Equal(AviationReferenceFailure.Forbidden, occ.Failure);
        Assert.Equal(("ZZA", AviationReferenceStatus.Available, 87), (contratos.Value!.Subject, contratos.Value.Status,
            contratos.Value.Value!.TotalAircraft));
        Assert.Equal(AviationReferenceFailure.InvalidRequest, invalid.Failure);
    }

    private static ActorContext Member(params string[] permissions) => new(AccountId, "occ.reference@example.test",
        "Reference Reader",
        [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000001"), "ADMIN_OCC", "Admin OCC", PortalKind.BackOffice,
            "admin_occ")],
        [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000001"),
            Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        [new ActorStationScope(PuntaCana, "PUJ")],
        new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations,
            permissions.ToHashSet(StringComparer.Ordinal)));

    private sealed class Resolver(ActorContext actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(actor);
    }

    private sealed class Airports : IOccStationAirportStore
    {
        public Task<string?> FindIcaoCodeAsync(Guid stationId, CancellationToken cancellationToken = default) =>
            Task.FromResult(stationId == PuntaCana ? "MDPC" : null);
    }

    /// <summary>An invented provider: every read answers what <see cref="Answer"/> says for aircraft and fixed facts otherwise.</summary>
    private sealed class StubProvider : IAviationReferenceProvider
    {
        public bool Configured { get; init; } = true;

        public int Calls { get; private set; }

        public Task? Wait { get; init; }

        public Func<string, ReferenceCall<AircraftFacts>> Answer { get; set; } =
            _ => new ReferenceCall<AircraftFacts>(ProviderCallOutcome.Succeeded, 1, 200, null, Aircraft);

        public string Provider => "AeroDataBox";

        public bool IsConfigured => Configured;

        public Task<ReferenceCall<AirlineFleetFacts>> GetAirlineFleetAsync(string airlineCode, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new ReferenceCall<AirlineFleetFacts>(ProviderCallOutcome.Succeeded, 6, 200, null,
                new AirlineFleetFacts(87, [Aircraft])));
        }

        public async Task<ReferenceCall<AircraftFacts>> GetAircraftAsync(string registration, CancellationToken cancellationToken = default)
        {
            Calls++;
            if (Wait is not null) await Wait;
            return Answer(registration);
        }

        public Task<ReferenceCall<AirportRouteFacts>> GetDailyRoutesAsync(string airportIcao, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new ReferenceCall<AirportRouteFacts>(ProviderCallOutcome.Succeeded, 6, 200, null,
                new AirportRouteFacts([new AirportRoute("JFK", "KJFK", "New York JFK", "New York", "US", 40.64, -73.78, 6.5, ["Demo Airlines"])])));
        }

        public Task<ReferenceCall<AirportDelayFacts>> GetDelaysAsync(string airportCode, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new ReferenceCall<AirportDelayFacts>(ProviderCallOutcome.Succeeded, 6, 200, null,
                new AirportDelayFacts("MDPC", Start.AddHours(-2), Start, new DelayBatch(10, 9, 0, 12, 1.1),
                    new DelayBatch(8, 8, 1, 8, 0.9))));
        }
    }

    /// <summary>A ledger whose totals are set by the test, and that keeps what it was asked to record.</summary>
    private sealed class Ledger : IProviderUsageLedger
    {
        public int OperationToday { get; set; }

        public int OperationMonth { get; init; }

        public int ProviderMonth { get; init; }

        public List<ProviderUsageRecord> Records { get; } = [];

        public Task<ProviderUsageTotals> GetTotalsAsync(string provider, string operation, DateTimeOffset now,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new ProviderUsageTotals(OperationToday, OperationMonth, ProviderMonth));

        public Task RecordAsync(ProviderUsageRecord record, CancellationToken cancellationToken = default)
        {
            lock (Records) Records.Add(record);
            return Task.CompletedTask;
        }
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
