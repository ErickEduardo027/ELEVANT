using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Infrastructure.Integrations.AirTraffic;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0042 (contracts 1.3): the air picture is read only while someone watches the map, once per interval for every
/// screen, with a back-off after refusals and failures; the trails live in memory, never across a gap; the state travels
/// with its reason and the pace the screens ask again at. Every network here is a stub: nothing calls out.
/// </summary>
public sealed class AirPictureServiceTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly AirTrafficAttribution First = new("first", "https://first.example", "Licence one", null);
    private static readonly AirTrafficAttribution Second =
        new("second", "https://second.example", "Licence two", "https://second.example/licence");

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task NeverCallsTheProviderWithoutDemand()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);
        Assert.True(service.IsEnabled);

        // The worker sleeps until a screen reads the map: a whole day without screens calls nothing, and reading what
        // is in memory is not demand.
        var waiting = service.WaitForDemandAsync(Ct);
        for (var hour = 0; hour < 24; hour++)
        {
            clock.Advance(TimeSpan.FromHours(1));
            Assert.False(service.HasDemand);
            Assert.Empty(service.Read(shortTrails: true).Aircraft);
            Assert.Null(service.Track("0c0001"));
        }
        Assert.False(waiting.IsCompleted);
        Assert.Equal(0, network.Reads);

        // The first screen wakes it, and the read asks for the configured circle.
        service.NoteDemand();
        await waiting.WaitAsync(TimeSpan.FromSeconds(10), Ct);
        Assert.True(service.HasDemand);
        Assert.True(service.WaitForDemandAsync(Ct).IsCompletedSuccessfully);
        await service.PollOnceAsync(Ct);
        Assert.Equal(1, network.Reads);
        Assert.Equal(new AirTrafficArea(18.5674, -68.3634, 250), network.LastArea);
    }

    [Fact]
    public async Task TheFirstReadAfterIdleIsWarming()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock) { Aircraft = [Plane("0c0001", Start)] };
        var service = new AirPictureService(network, Settings(), clock);

        service.NoteDemand();
        var warming = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Warming, null, 2, First), (warming.Status, warming.Reason, warming.RefreshAfterSeconds,
            warming.Source));
        Assert.Equal((Start, (DateTimeOffset?)null, (int?)null), (warming.ServerTime, warming.ObservedAt, warming.AgeSeconds));
        Assert.Empty(warming.Aircraft);

        await service.PollOnceAsync(Ct);
        Assert.Equal(AirPictureStatus.Live, service.Read(shortTrails: true).Status);

        // Nobody watches for longer than the idle time: the next screen starts a new watch, warming until its first read.
        clock.Advance(TimeSpan.FromMinutes(20));
        network.Aircraft = [Plane("0c0001", clock.GetUtcNow())];
        Assert.False(service.HasDemand);
        service.NoteDemand();
        var again = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Warming, 2), (again.Status, again.RefreshAfterSeconds));
        Assert.Empty(again.Aircraft);
        await service.PollOnceAsync(Ct);
        Assert.Equal(AirPictureStatus.Live, service.Read(shortTrails: true).Status);

        // While a refusal's wait still runs no read comes before it ends: a new watch says what failed, not Warming.
        clock.Advance(TimeSpan.FromSeconds(10));
        network.Outcome = AirTrafficOutcome.Unauthorized;
        Assert.Equal(TimeSpan.FromMinutes(30), await service.PollOnceAsync(Ct));
        clock.Advance(TimeSpan.FromMinutes(20));
        service.NoteDemand();
        var refused = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Unavailable, AirPictureReasons.Unauthorized, 60),
            (refused.Status, refused.Reason, refused.RefreshAfterSeconds));
        Assert.Empty(refused.Aircraft);

        // Once that wait is over the worker reads at once, and the watch warms up for that read.
        clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal(AirPictureStatus.Warming, service.Read(shortTrails: true).Status);
    }

    [Fact]
    public async Task PollsWhileWatchedAndStopsWhenIdle()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(idleAfterSeconds: 900), clock);

        // A screen watches for five minutes, reading the picture at its pace, then closes; the loop is the worker's.
        var closedAt = Start.AddMinutes(5);
        service.NoteDemand();
        while (service.HasDemand)
        {
            if (clock.GetUtcNow() <= closedAt) service.NoteDemand();
            clock.Advance(await service.PollOnceAsync(Ct));
        }

        // One read every ten seconds until fifteen minutes after the screen's last read (15:05 + 15 min), none after.
        Assert.Equal(120, network.Reads);
        Assert.Equal(Start.AddSeconds(1190), network.LastReadAt);
        Assert.Equal(Start.AddSeconds(1200), clock.GetUtcNow());

        // Without demand the worker waits: an hour later nothing more was read.
        var waiting = service.WaitForDemandAsync(Ct);
        clock.Advance(TimeSpan.FromHours(1));
        Assert.False(waiting.IsCompleted);
        Assert.Equal(120, network.Reads);

        // The next screen starts the reads again.
        service.NoteDemand();
        await waiting.WaitAsync(TimeSpan.FromSeconds(10), Ct);
        await service.PollOnceAsync(Ct);
        Assert.Equal(121, network.Reads);
    }

    [Fact]
    public async Task OneProviderReadPerIntervalForEveryClient()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock) { Aircraft = [Plane("0c0001", Start)] };
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();
        Assert.Equal(TimeSpan.FromSeconds(10), await service.PollOnceAsync(Ct));

        // Two hundred screens read the picture at once: all are served from memory and none calls the network.
        var pictures = await Task.WhenAll(Enumerable.Range(0, 200).Select(_ => Task.Run(() =>
        {
            service.NoteDemand();
            return service.Read(shortTrails: true);
        }, Ct)));
        Assert.All(pictures, picture =>
        {
            Assert.Equal(AirPictureStatus.Live, picture.Status);
            Assert.Equal("0c0001", Assert.Single(picture.Aircraft).Aircraft.Hex);
        });
        Assert.Equal(1, network.Reads);

        // A pass before the interval is over reads nothing and answers the time left.
        clock.Advance(TimeSpan.FromSeconds(4));
        Assert.Equal(TimeSpan.FromSeconds(6), await service.PollOnceAsync(Ct));
        Assert.Equal(1, network.Reads);

        // Two passes at the same time make one read: the second answers the interval without calling.
        clock.Advance(TimeSpan.FromSeconds(6));
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        network.Gate = gate;
        var first = service.PollOnceAsync(Ct);
        Assert.Equal(TimeSpan.FromSeconds(10), await service.PollOnceAsync(Ct));
        gate.SetResult();
        Assert.Equal(TimeSpan.FromSeconds(10), await first);
        Assert.Equal(2, network.Reads);
    }

    [Fact]
    public async Task AppendsTrailPointsAndDropsAircraftNotSeen()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();

        // A moves a kilometre, then stands still for ten seconds: both are points. B is seen in the first three reads only.
        await ReadAt(service, clock, network, 0, Plane("0c0001", At(0), 18.5), Plane("0c0002", At(0), 18.6));
        await ReadAt(service, clock, network, 10, Plane("0c0001", At(10), 18.51), Plane("0c0002", At(10), 18.61));
        await ReadAt(service, clock, network, 20, Plane("0c0001", At(20), 18.51), Plane("0c0002", At(20), 18.62));
        // Five seconds and 30 metres after the last point: not a point. Nine seconds and 60 metres after it: a point.
        await ReadAt(service, clock, network, 30, Plane("0c0001", At(25), 18.51027));
        await ReadAt(service, clock, network, 40, Plane("0c0001", At(29), 18.51054));
        // The same position again is nothing new.
        await ReadAt(service, clock, network, 50, Plane("0c0001", At(29), 18.51054));

        var picture = service.Read(shortTrails: true);
        var a = Assert.Single(picture.Aircraft);
        Assert.Equal("0c0001", a.Aircraft.Hex);
        Assert.Equal([At(0), At(10), At(20), At(29)], a.Trail.Select(point => point.At));
        Assert.Equal([18.5, 18.51, 18.51, 18.51054], a.Trail.Select(point => point.Latitude));
        Assert.All(a.Trail, point => Assert.Equal((-68.36, 2500, false), (point.Longitude, point.AltitudeFeet, point.OnGround)));

        // B, last seen at 15:00:20, keeps its track for fifteen minutes; then it is forgotten.
        clock.SetTime(At(20 + 899));
        Assert.Equal([At(0), At(10), At(20)], service.Track("0c0002")!.Points.Select(point => point.At));
        clock.SetTime(At(20 + 900));
        Assert.Null(service.Track("0c0002"));
        Assert.NotNull(service.Track("0c0001"));

        // Seen again, it starts a new trail.
        await ReadAt(service, clock, network, 20 + 910, Plane("0c0002", At(20 + 910), 18.7));
        Assert.Equal([At(930)], service.Track("0c0002")!.Points.Select(point => point.At));
    }

    [Fact]
    public async Task NeverJoinsATrailAcrossAGap()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();
        await ReadAt(service, clock, network, 0, Plane("0c0001", At(0), 18.50));
        await ReadAt(service, clock, network, 10, Plane("0c0001", At(10), 18.51));
        await ReadAt(service, clock, network, 20, Plane("0c0001", At(20), 18.52));

        // Lost for exactly five minutes: still the same segment.
        await ReadAt(service, clock, network, 320, Plane("0c0001", At(320), 18.60));
        Assert.Equal([At(0), At(10), At(20), At(320)], service.Track("0c0001")!.Points.Select(point => point.At));

        // Lost for one second more: a new segment, and the old one is never served again.
        await ReadAt(service, clock, network, 621, Plane("0c0001", At(621), 18.70));
        var picture = service.Read(shortTrails: true);
        Assert.Equal([At(621)], Assert.Single(picture.Aircraft).Trail.Select(point => point.At));
        Assert.Equal([At(621)], service.Track("0c0001")!.Points.Select(point => point.At));

        await ReadAt(service, clock, network, 631, Plane("0c0001", At(631), 18.71));
        Assert.Equal([At(621), At(631)], service.Track("0c0001")!.Points.Select(point => point.At));
    }

    [Fact]
    public async Task KeepsOnlyTheTrailMinutes()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(trailMinutes: 2), clock);
        service.NoteDemand();
        for (var second = 0; second <= 300; second += 10)
            await ReadAt(service, clock, network, second, Plane("0c0001", At(second), 18.5 + second / 10_000.0));

        // At 15:05:00 only the points of the last two minutes are kept.
        var track = service.Track("0c0001")!.Points;
        Assert.Equal(13, track.Count);
        Assert.Equal((At(180), At(300)), (track[0].At, track[^1].At));
        Assert.Equal(Enumerable.Range(23, 8).Select(step => At(step * 10)),
            Assert.Single(service.Read(shortTrails: true).Aircraft).Trail.Select(point => point.At));

        // A minute later without reads, the track is cut to the last two minutes again.
        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(Enumerable.Range(24, 7).Select(step => At(step * 10)),
            service.Track("0c0001")!.Points.Select(point => point.At));
    }

    [Fact]
    public async Task GoesStaleThenUnavailableWhenTheProviderFails()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock) { Aircraft = [Plane("0c0001", Start)] };
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();
        await ReadAt(service, clock, network, 0);
        var live = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Live, null, Start, 0), (live.Status, live.Reason, live.ObservedAt, live.AgeSeconds));

        // Failures while the last good read is at most 30 seconds old: still live, without a reason.
        network.Outcome = AirTrafficOutcome.Failed;
        Assert.Equal(TimeSpan.FromSeconds(15), await ReadAt(service, clock, network, 10));
        Assert.Equal(TimeSpan.FromSeconds(30), await ReadAt(service, clock, network, 25));
        clock.SetTime(At(30));
        Assert.Equal((AirPictureStatus.Live, null), (service.Read(true).Status, service.Read(true).Reason));

        // Older: stale, with the aircraft of the last good read and the reason of the last attempt.
        clock.SetTime(At(31));
        var stale = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Stale, AirPictureReasons.ProviderError, Start, 31, First),
            (stale.Status, stale.Reason, stale.ObservedAt, stale.AgeSeconds, stale.Source));
        Assert.Equal("0c0001", Assert.Single(stale.Aircraft).Aircraft.Hex);
        Assert.Equal([Start], Assert.Single(stale.Aircraft).Trail.Select(point => point.At));
        await ReadAt(service, clock, network, 55);
        network.Outcome = AirTrafficOutcome.RateLimited;
        await ReadAt(service, clock, network, 115);
        Assert.Equal(AirPictureReasons.RateLimited, service.Read(true).Reason);

        // Ten minutes is the last moment it is shown; after that it is unavailable, without aircraft.
        clock.SetTime(At(600));
        Assert.Equal((AirPictureStatus.Stale, 600), (service.Read(true).Status, service.Read(true).AgeSeconds));
        clock.SetTime(At(601));
        var unavailable = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Unavailable, AirPictureReasons.RateLimited, Start, 601, 60, First),
            (unavailable.Status, unavailable.Reason, unavailable.ObservedAt, unavailable.AgeSeconds,
                unavailable.RefreshAfterSeconds, unavailable.Source));
        Assert.Empty(unavailable.Aircraft);

        // The next good read is live again.
        network.Outcome = AirTrafficOutcome.Succeeded;
        network.Aircraft = [Plane("0c0001", At(601))];
        await ReadAt(service, clock, network, 601);
        var back = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Live, null, 0), (back.Status, back.Reason, back.AgeSeconds));
        Assert.Single(back.Aircraft);
    }

    [Fact]
    public async Task ShortTrailsHaveAtMostEightPointsOldestFirst()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();
        for (var second = 0; second < 110; second += 10)
            await ReadAt(service, clock, network, second, Plane("0c0001", At(second), 18.5 + second / 1_000.0));
        await ReadAt(service, clock, network, 110, Plane("0c0001", At(110), 18.61), Plane("0c0002", At(110), 18.4));

        var picture = service.Read(shortTrails: true);
        Assert.Equal(["0c0001", "0c0002"], picture.Aircraft.Select(item => item.Aircraft.Hex));
        Assert.Equal(Enumerable.Range(4, 8).Select(step => At(step * 10)), picture.Aircraft[0].Trail.Select(point => point.At));
        Assert.Equal([At(110)], picture.Aircraft[1].Trail.Select(point => point.At));

        // Without trails, the same aircraft and positions.
        var bare = service.Read(shortTrails: false);
        Assert.Equal(picture.Aircraft.Select(item => item.Aircraft), bare.Aircraft.Select(item => item.Aircraft));
        Assert.All(bare.Aircraft, item => Assert.Empty(item.Trail));
    }

    [Fact]
    public async Task ATrackIsTheLastSegmentOfAtMostSixHundredPoints()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();
        for (var second = 0; second < 7_000; second += 10)
            await ReadAt(service, clock, network, second, Plane("0c0001", At(second), 18.0 + second / 100_000.0));

        // 700 points thinned evenly to 600: the first and the last stay, all in order, every one a real position.
        var track = service.Track(" 0C0001 ")!;
        Assert.Equal(("0c0001", At(6_990), First), (track.Hex, track.ServerTime, track.Source));
        Assert.Equal(600, track.Points.Count);
        Assert.Equal((At(0), At(6_990)), (track.Points[0].At, track.Points[^1].At));
        Assert.All(track.Points.Zip(track.Points.Skip(1)), pair => Assert.True(pair.First.At < pair.Second.At));
        Assert.All(track.Points, point => Assert.Equal(0, (point.At - Start).Ticks % TimeSpan.FromSeconds(10).Ticks));
        Assert.Null(service.Track("0c0009"));
        Assert.Null(service.Track(" "));

        // After a gap only the new segment is served.
        await ReadAt(service, clock, network, 6_990 + 301, Plane("0c0001", At(6_990 + 301), 18.2));
        Assert.Equal([At(7_291)], service.Track("0c0001")!.Points.Select(point => point.At));
    }

    [Fact]
    public async Task BacksOffOnRateLimitUnauthorizedAndFailures()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);

        async Task<int> After(AirTrafficOutcome outcome, int? retryAfterSeconds = null)
        {
            network.Outcome = outcome;
            network.RetryAfter = retryAfterSeconds is { } seconds ? TimeSpan.FromSeconds(seconds) : null;
            var wait = await service.PollOnceAsync(Ct);
            clock.Advance(wait);
            return (int)wait.TotalSeconds;
        }

        // Failures: 15 seconds, doubled for each one in a row, up to five minutes.
        foreach (var expected in new[] { 15, 30, 60, 120, 240, 300, 300 })
            Assert.Equal(expected, await After(AirTrafficOutcome.Failed));
        Assert.Equal(10, await After(AirTrafficOutcome.Succeeded));
        // A request to slow down: what Retry-After asks, and at least a minute.
        Assert.Equal(90, await After(AirTrafficOutcome.RateLimited, 90));
        Assert.Equal(60, await After(AirTrafficOutcome.RateLimited, 5));
        Assert.Equal(60, await After(AirTrafficOutcome.RateLimited));
        // A refusal of the address or the key, or a spent day's budget: half an hour.
        Assert.Equal(1_800, await After(AirTrafficOutcome.Unauthorized));
        Assert.Equal(1_800, await After(AirTrafficOutcome.QuotaExceeded));
        // A success starts the count of failures again.
        Assert.Equal(10, await After(AirTrafficOutcome.Succeeded));
        Assert.Equal(15, await After(AirTrafficOutcome.Failed));
        // One read per pass, never a retry in between.
        Assert.Equal(15, network.Reads);
    }

    [Fact]
    public async Task RefreshAfterStaysBetweenTenAndSixtyAndIsTwoWhileWarming()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock);
        var service = new AirPictureService(network, Settings(), clock);
        service.NoteDemand();
        Assert.Equal(2, service.Read(true).RefreshAfterSeconds);

        // The pace follows the reader's own wait, from ten seconds up to a minute.
        var expected = new (AirTrafficOutcome Outcome, int Refresh)[]
        {
            (AirTrafficOutcome.Succeeded, 10), (AirTrafficOutcome.Failed, 15), (AirTrafficOutcome.Failed, 30),
            (AirTrafficOutcome.Failed, 60), (AirTrafficOutcome.Failed, 60), (AirTrafficOutcome.Unauthorized, 60),
            (AirTrafficOutcome.Succeeded, 10),
        };
        foreach (var (outcome, refresh) in expected)
        {
            network.Outcome = outcome;
            var wait = await service.PollOnceAsync(Ct);
            Assert.Equal(refresh, service.Read(true).RefreshAfterSeconds);
            clock.Advance(wait);
        }

        // Never faster than ten seconds, never slower than a minute, whatever the interval.
        Assert.Equal(10, await RefreshWithInterval(5));
        Assert.Equal(25, await RefreshWithInterval(25));
        Assert.Equal(60, await RefreshWithInterval(120));
        Assert.Equal(60, new AirPictureService(network, Settings(enabled: false), clock).Read(true).RefreshAfterSeconds);

        async Task<int> RefreshWithInterval(int seconds)
        {
            var other = new AirPictureService(network, Settings(intervalSeconds: seconds), clock);
            other.NoteDemand();
            network.Outcome = AirTrafficOutcome.Succeeded;
            await other.PollOnceAsync(Ct);
            return other.Read(true).RefreshAfterSeconds;
        }
    }

    [Fact]
    public async Task TheFailoverIsVisibleInTheSource()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedNetwork(First, clock) { Outcome = AirTrafficOutcome.Failed, Aircraft = [Plane("0c0001", Start)] };
        var second = new ScriptedNetwork(Second, clock) { Aircraft = [Plane("0c0002", Start)] };
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        var service = new AirPictureService(failover, Settings(), clock);
        service.NoteDemand();
        Assert.Equal(First, service.Read(true).Source);

        async Task<TimeSpan> Pass()
        {
            var wait = await service.PollOnceAsync(Ct);
            clock.Advance(wait);
            return wait;
        }

        // Two failures back off as usual; the third hands over to the next network, which is asked after the interval.
        Assert.Equal(TimeSpan.FromSeconds(15), await Pass());
        Assert.Equal(First, service.Read(true).Source);
        Assert.Equal(TimeSpan.FromSeconds(30), await Pass());
        Assert.Equal(TimeSpan.FromSeconds(10), await Pass());
        var handedOver = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Unavailable, AirPictureReasons.ProviderError, Second),
            (handedOver.Status, handedOver.Reason, handedOver.Source));

        // The next network answers: its aircraft, with its credit.
        Assert.Equal(TimeSpan.FromSeconds(10), await Pass());
        var live = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Live, Second), (live.Status, live.Source));
        Assert.Equal("0c0002", Assert.Single(live.Aircraft).Aircraft.Hex);
        Assert.Equal(Second, service.Track("0c0002")!.Source);
        Assert.Equal((3, 1), (first.Reads, second.Reads));

        // Ten minutes after the hand-over the first network is asked again; it answers and the credit follows it back.
        first.Outcome = AirTrafficOutcome.Succeeded;
        first.Aircraft = [Plane("0c0001", clock.GetUtcNow())];
        while (first.Reads == 3) await Pass();
        var back = service.Read(shortTrails: true);
        Assert.Equal((AirPictureStatus.Live, First), (back.Status, back.Source));
        Assert.Equal("0c0001", Assert.Single(back.Aircraft).Aircraft.Hex);
        // The second network answered every ten seconds from 15:00:55 to 15:10:35; the retry came at 15:10:45.
        Assert.Equal(59, second.Reads);
        Assert.Equal(Start.AddSeconds(645), first.LastReadAt);
    }

    [Fact]
    public async Task AFailedRetryOfTheFirstNetworkKeepsThePictureLive()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedNetwork(First, clock) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedNetwork(Second, clock);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        var service = new AirPictureService(failover, Settings(), clock);
        service.NoteDemand();

        // Three failures hand over to the second network after 15, 30 and 10 seconds.
        foreach (var seconds in new[] { 15, 30, 10 })
        {
            var wait = await service.PollOnceAsync(Ct);
            Assert.Equal(TimeSpan.FromSeconds(seconds), wait);
            clock.Advance(wait);
        }

        // The second network answers every pass. Ten minutes after the hand-over the first one is asked again and asks to
        // wait an hour; an hour later it refuses the address. Each time the second answers that same pass: the picture
        // stays live with its aircraft and its credit, without a reason, and the pace stays the interval.
        var retries = new (AirTrafficOutcome Outcome, TimeSpan? RetryAfter, DateTimeOffset At)[]
        {
            (AirTrafficOutcome.RateLimited, TimeSpan.FromHours(1), Start.AddSeconds(645)),
            (AirTrafficOutcome.Unauthorized, null, Start.AddSeconds(645).AddHours(1)),
        };
        foreach (var (outcome, retryAfter, at) in retries)
        {
            (first.Outcome, first.RetryAfter) = (outcome, retryAfter);
            var firstReads = first.Reads;
            for (var pass = 0; first.Reads == firstReads; pass++)
            {
                Assert.True(pass < 1_000, "The first network was never asked again.");
                second.Aircraft = [Plane("0c0002", clock.GetUtcNow())];
                var secondReads = second.Reads;
                Assert.Equal(TimeSpan.FromSeconds(10), await service.PollOnceAsync(Ct));
                Assert.Equal(secondReads + 1, second.Reads);
                var picture = service.Read(shortTrails: false);
                Assert.Equal((AirPictureStatus.Live, (string?)null, Second, 10),
                    (picture.Status, picture.Reason, picture.Source, picture.RefreshAfterSeconds));
                Assert.Equal("0c0002", Assert.Single(picture.Aircraft).Aircraft.Hex);
                clock.Advance(TimeSpan.FromSeconds(10));
            }
            Assert.Equal(at, first.LastReadAt);
        }
    }

    [Fact]
    public async Task ARateLimitThatHandsOverIsWaitedOutByThatNetworkOnly()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedNetwork(First, clock) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedNetwork(Second, clock);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        var service = new AirPictureService(failover, Settings(), clock);
        service.NoteDemand();

        async Task<TimeSpan> Pass()
        {
            var wait = await service.PollOnceAsync(Ct);
            clock.Advance(wait);
            return wait;
        }

        // Two failures back off as usual. The third is a 429 that asks for half an hour, and it hands over: the reader
        // waits only the interval, because the half hour is the first network's, not the second's.
        Assert.Equal(TimeSpan.FromSeconds(15), await Pass());
        Assert.Equal(TimeSpan.FromSeconds(30), await Pass());
        (first.Outcome, first.RetryAfter) = (AirTrafficOutcome.RateLimited, TimeSpan.FromSeconds(1_800));
        Assert.Equal(TimeSpan.FromSeconds(10), await Pass());
        Assert.Equal(Second, service.Read(shortTrails: false).Source);
        var limitedAt = Start.AddSeconds(45);
        Assert.Equal(limitedAt, first.LastReadAt);

        // The second answers every ten seconds and the picture stays live. The first is not asked during its half hour,
        // although its retry of every ten minutes falls due within it: it is asked with the first pass after the half
        // hour, and asks for another one. The second answers that same pass, and the next retry comes half an hour
        // later, not ten minutes.
        foreach (var askedAt in new[] { limitedAt.AddSeconds(1_800), limitedAt.AddSeconds(3_600) })
        {
            var firstReads = first.Reads;
            while (first.Reads == firstReads)
            {
                var passAt = clock.GetUtcNow();
                Assert.True(passAt <= askedAt, "The first network was not asked again when its wait ended.");
                second.Aircraft = [Plane("0c0002", passAt)];
                var secondReads = second.Reads;
                Assert.Equal(TimeSpan.FromSeconds(10), await Pass());
                Assert.True(first.Reads == firstReads || passAt == askedAt, "The first network was asked before its wait ended.");
                Assert.Equal(secondReads + 1, second.Reads);
                var picture = service.Read(shortTrails: false);
                Assert.Equal((AirPictureStatus.Live, (string?)null, Second, 10),
                    (picture.Status, picture.Reason, picture.Source, picture.RefreshAfterSeconds));
                Assert.Equal("0c0002", Assert.Single(picture.Aircraft).Aircraft.Hex);
            }
            Assert.Equal(askedAt, first.LastReadAt);
        }
    }

    [Fact]
    public async Task AFailingNetworkKeepsTheTurnWhileTheOtherWaitsOutItsRetryAfter()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedNetwork(First, clock) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedNetwork(Second, clock);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        var service = new AirPictureService(failover, Settings(), clock);
        service.NoteDemand();

        async Task<TimeSpan> Pass()
        {
            var wait = await service.PollOnceAsync(Ct);
            clock.Advance(wait);
            return wait;
        }

        // The first hands over after three failures, at 15:00:45. Its retry at 15:10:45 asks for half an hour, and the
        // second answers that pass.
        foreach (var seconds in new[] { 15, 30, 10 }) Assert.Equal(TimeSpan.FromSeconds(seconds), await Pass());
        (first.Outcome, first.RetryAfter) = (AirTrafficOutcome.RateLimited, TimeSpan.FromSeconds(1_800));
        while (first.Reads == 3) await Pass();
        Assert.Equal(Start.AddSeconds(645), first.LastReadAt);

        // Then the second fails. Its third failure would hand back to the first, which is still waiting: the second keeps
        // the turn and the credit, its failures back off as usual, and the first is asked again only after its half
        // hour (15:40:45), by the retry of the first pass after it, which finds it answering.
        (first.Outcome, second.Outcome) = (AirTrafficOutcome.Succeeded, AirTrafficOutcome.Failed);
        var waits = new List<int>();
        while (first.Reads == 4)
        {
            Assert.Equal(Second, service.Read(shortTrails: false).Source);
            waits.Add((int)(await Pass()).TotalSeconds);
        }
        Assert.Equal([15, 30, 60, 120, 240, 300, 300, 300, 300, 300, 10], waits);
        Assert.Equal(Start.AddSeconds(2_620), first.LastReadAt);
        var back = service.Read(shortTrails: false);
        Assert.Equal((AirPictureStatus.Live, First), (back.Status, back.Source));
    }

    [Fact]
    public async Task DisabledAnswersNotConfiguredWithoutCalls()
    {
        var clock = new ManualClock(Start);
        var network = new ScriptedNetwork(First, clock) { Aircraft = [Plane("0c0001", Start)] };
        foreach (var service in new[]
                 {
                     new AirPictureService(network, Settings(enabled: false), clock),
                     new AirPictureService(new UnconfiguredAirTrafficProvider(), Settings(), clock),
                     new AirPictureService(new UnconfiguredAirTrafficProvider(), AirTrafficSettings.Disabled, clock),
                 })
        {
            Assert.False(service.IsEnabled);
            service.NoteDemand();
            Assert.False(service.HasDemand);
            Assert.Equal(TimeSpan.FromSeconds(10), await service.PollOnceAsync(Ct));

            var picture = service.Read(shortTrails: true);
            Assert.Equal((AirPictureStatus.Disabled, AirPictureReasons.NotConfigured, 60, Start),
                (picture.Status, picture.Reason, picture.RefreshAfterSeconds, picture.ServerTime));
            Assert.Equal(((DateTimeOffset?)null, (int?)null, (AirTrafficAttribution?)null),
                (picture.ObservedAt, picture.AgeSeconds, picture.Source));
            Assert.Empty(picture.Aircraft);
            Assert.Null(service.Track("0c0001"));

            // The worker never waits for it, and the wait only ends with the cancellation.
            using var stop = new CancellationTokenSource();
            var waiting = service.WaitForDemandAsync(stop.Token);
            Assert.False(waiting.IsCompleted);
            await stop.CancelAsync();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);
        }
        Assert.Equal(0, network.Reads);
    }

    [Fact]
    public async Task MatchKeysAreCachedTwentySecondsPerStation()
    {
        var clock = new ManualClock(Start);
        var service = new AirPictureService(new ScriptedNetwork(First, clock), Settings(), clock);
        var station = Guid.Parse("6f0e1d2c-3b4a-4958-8677-a1b2c3d4e5f6");
        var another = Guid.Parse("7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d");
        var loads = new List<Guid>();
        Func<CancellationToken, Task<IReadOnlyList<MapFlightMatchKey>>> Loader(Guid stationId) => _ =>
        {
            loads.Add(stationId);
            return Task.FromResult<IReadOnlyList<MapFlightMatchKey>>([Key($"p:{loads.Count}")]);
        };

        var keys = await service.MatchKeysAsync(station, Loader(station), Ct);
        Assert.Equal("p:1", Assert.Single(keys).FlightKey);
        clock.Advance(TimeSpan.FromSeconds(19));
        Assert.Same(keys, await service.MatchKeysAsync(station, Loader(station), Ct));
        Assert.Equal([station], loads);

        // Another station keeps its own keys.
        var others = await service.MatchKeysAsync(another, Loader(another), Ct);
        Assert.Equal("p:2", Assert.Single(others).FlightKey);
        Assert.Same(keys, await service.MatchKeysAsync(station, Loader(station), Ct));

        // Twenty seconds after their load they are read again.
        clock.Advance(TimeSpan.FromSeconds(1));
        var reloaded = await service.MatchKeysAsync(station, Loader(station), Ct);
        Assert.Equal("p:3", Assert.Single(reloaded).FlightKey);
        Assert.Same(others, await service.MatchKeysAsync(another, Loader(another), Ct));
        Assert.Equal([station, another, station], loads);
    }

    [Fact]
    public async Task MatchKeysLoadOnceAtATimeAndSurviveAFailedLoad()
    {
        var clock = new ManualClock(Start);
        var service = new AirPictureService(new ScriptedNetwork(First, clock), Settings(), clock);
        var station = Guid.Parse("6f0e1d2c-3b4a-4958-8677-a1b2c3d4e5f6");

        // Callers that arrive while the first load runs wait for it and share it.
        var calls = 0;
        var slow = new TaskCompletionSource<IReadOnlyList<MapFlightMatchKey>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var callers = Enumerable.Range(0, 10).Select(_ => service.MatchKeysAsync(station, _ =>
        {
            Interlocked.Increment(ref calls);
            return slow.Task;
        }, Ct)).ToArray();
        slow.SetResult([Key("p:1")]);
        var shared = await Task.WhenAll(callers);
        Assert.All(shared, keys => Assert.Same(shared[0], keys));
        Assert.Equal(1, calls);

        // When they are due again, the other callers get the known keys while one load runs; a load that fails keeps them
        // for twenty more seconds.
        clock.Advance(TimeSpan.FromSeconds(20));
        var failing = new TaskCompletionSource<IReadOnlyList<MapFlightMatchKey>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var reload = service.MatchKeysAsync(station, _ => failing.Task, Ct);
        Assert.Same(shared[0], await service.MatchKeysAsync(station, _ => throw new InvalidOperationException("not called"), Ct));
        failing.SetException(new InvalidOperationException("database out of reach"));
        Assert.Same(shared[0], await reload);
        clock.Advance(TimeSpan.FromSeconds(19));
        Assert.Same(shared[0], await service.MatchKeysAsync(station, _ => throw new InvalidOperationException("not called"), Ct));

        // A station whose first load fails has no keys, and the picture still answers.
        Assert.Empty(await service.MatchKeysAsync(Guid.NewGuid(), _ => throw new TimeoutException("database out of reach"), Ct));

        // The caller's cancellation is thrown and leaves nothing behind: the next caller loads.
        var third = Guid.NewGuid();
        using var stop = new CancellationTokenSource();
        var never = new TaskCompletionSource<IReadOnlyList<MapFlightMatchKey>>();
        var cancelled = service.MatchKeysAsync(third, token => never.Task.WaitAsync(token), stop.Token);
        await stop.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
        var loaded = await service.MatchKeysAsync(third,
            _ => Task.FromResult<IReadOnlyList<MapFlightMatchKey>>([Key("p:9")]), Ct);
        Assert.Equal("p:9", Assert.Single(loaded).FlightKey);
    }

    private static DateTimeOffset At(int seconds) => Start.AddSeconds(seconds);

    private static AirTrafficSettings Settings(int intervalSeconds = 10, int idleAfterSeconds = 900, int trailMinutes = 180,
        bool enabled = true) =>
        new(enabled, "PUJ", 18.5674, -68.3634, 250, TimeSpan.FromSeconds(intervalSeconds),
            TimeSpan.FromSeconds(idleAfterSeconds), TimeSpan.FromMinutes(trailMinutes));

    /// <summary>A synthetic aircraft: an invented address over the sea east of Punta Cana.</summary>
    private static AirTrafficAircraft Plane(string hex, DateTimeOffset positionAt, double latitude = 18.5) =>
        new(hex, null, null, "A320", "A3", latitude, -68.36, 2500, false, 150, 80, -600, null, positionAt);

    private static MapFlightMatchKey Key(string flightKey) =>
        new(flightKey, "Arrival", "ZZ123", "ZZA", "ZZ", null, Start, false, false);

    /// <summary>
    /// Moves the clock to <paramref name="second"/> seconds after the start and makes one read that brings
    /// <paramref name="aircraft"/> (when given); answers the wait the service set.
    /// </summary>
    private static async Task<TimeSpan> ReadAt(AirPictureService service, ManualClock clock, ScriptedNetwork network,
        int second, params AirTrafficAircraft[] aircraft)
    {
        clock.SetTime(At(second));
        if (aircraft.Length > 0) network.Aircraft = aircraft;
        var reads = network.Reads;
        var wait = await service.PollOnceAsync(Ct);
        Assert.Equal(reads + 1, network.Reads);
        return wait;
    }

    private sealed class ScriptedNetwork(AirTrafficAttribution attribution, TimeProvider clock) : IAirTrafficProvider
    {
        private int _reads;

        public AirTrafficOutcome Outcome { get; set; } = AirTrafficOutcome.Succeeded;

        public TimeSpan? RetryAfter { get; set; }

        public IReadOnlyList<AirTrafficAircraft> Aircraft { get; set; } = [];

        /// <summary>When set, every read waits for it.</summary>
        public TaskCompletionSource? Gate { get; set; }

        public int Reads => Volatile.Read(ref _reads);

        public DateTimeOffset? LastReadAt { get; private set; }

        public AirTrafficArea? LastArea { get; private set; }

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => attribution;

        public async Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _reads);
            LastReadAt = clock.GetUtcNow();
            LastArea = area;
            if (Gate is { } gate) await gate.Task.WaitAsync(cancellationToken);
            return Outcome == AirTrafficOutcome.Succeeded
                ? new AirTrafficReadResult(Outcome, attribution, clock.GetUtcNow(), [.. Aircraft], null)
                : AirTrafficReadResult.Failure(Outcome, attribution, RetryAfter);
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private long _ticks = start.UtcTicks;

        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);

        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);

        public void SetTime(DateTimeOffset at) => Interlocked.Exchange(ref _ticks, at.UtcTicks);
    }
}
