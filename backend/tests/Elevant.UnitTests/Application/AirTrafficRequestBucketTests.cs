using Elevant.Application.Operations.AirPicture;

namespace Elevant.UnitTests.Application;

/// <summary>
/// M3: the one bucket of the requests to the network. Its token comes back 1.25 s after it is taken, so no request
/// follows another within 1.25 s and no minute sees more than 48 (0.8 a second); a clock set back never holds the reads.
/// </summary>
public sealed class AirTrafficRequestBucketTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 27, 21, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheTokenComesBackOnePointTwoFiveSecondsAfterItIsTaken()
    {
        Assert.Equal(0.8, AirTrafficRequestBucket.RequestsPerSecond);
        Assert.Equal(TimeSpan.FromMilliseconds(1_250), AirTrafficRequestBucket.TokenInterval);
        var bucket = new AirTrafficRequestBucket();

        // A new bucket holds its token: the first request goes out at once.
        Assert.Equal(TimeSpan.Zero, bucket.WaitAt(Start));
        Assert.True(bucket.TryTake(Start));

        // Until the token is back nothing else goes out, and a refused request takes nothing.
        Assert.Equal(TimeSpan.FromMilliseconds(1_250), bucket.WaitAt(Start));
        Assert.False(bucket.TryTake(Start));
        Assert.Equal(TimeSpan.FromMilliseconds(250), bucket.WaitAt(Start.AddSeconds(1)));
        Assert.False(bucket.TryTake(Start.AddMilliseconds(1_249)));
        Assert.True(bucket.TryTake(Start.AddMilliseconds(1_250)));
        Assert.Equal(TimeSpan.FromMilliseconds(1_250), bucket.WaitAt(Start.AddMilliseconds(1_250)));
    }

    [Fact]
    public void NoMinuteSeesMoreThanFortyEightRequests()
    {
        // A request asked for every 50 ms for ten minutes: only one every 1.25 s goes out.
        var bucket = new AirTrafficRequestBucket();
        var sent = new List<DateTimeOffset>();
        for (var at = Start; at < Start.AddMinutes(10); at = at.AddMilliseconds(50))
            if (bucket.TryTake(at)) sent.Add(at);

        Assert.Equal(480, sent.Count);
        Assert.All(sent.Zip(sent.Skip(1)), pair => Assert.Equal(AirTrafficRequestBucket.TokenInterval, pair.Second - pair.First));
        Assert.All(sent, first => Assert.True(sent.Count(at => at >= first && at < first.AddMinutes(1)) <= 48));
    }

    [Fact]
    public void AClockSetBackNeverHoldsTheRequests()
    {
        var bucket = new AirTrafficRequestBucket();
        Assert.True(bucket.TryTake(Start));

        // An hour back: the token counts as back, and the bucket counts from the new time on.
        var back = Start.AddHours(-1);
        Assert.Equal(TimeSpan.Zero, bucket.WaitAt(back));
        Assert.True(bucket.TryTake(back));
        Assert.Equal(TimeSpan.FromMilliseconds(1_250), bucket.WaitAt(back));
        Assert.False(bucket.TryTake(back.AddSeconds(1)));
        Assert.True(bucket.TryTake(back.AddMilliseconds(1_250)));
    }
}
