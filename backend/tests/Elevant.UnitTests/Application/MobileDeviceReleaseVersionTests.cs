using System.Globalization;
using Elevant.Application.Integration;

namespace Elevant.UnitTests.Application;

/// <summary>
/// 2-N02: each session of the agent holds its own binding, and a release names a registration of the session that
/// sends it, so a late one never frees the tablet after its agent signed in on it again. A session begins at its
/// sign-in, which a renewed token keeps (ADR-0046).
/// </summary>
public sealed class MobileDeviceReleaseVersionTests
{
    private static readonly DateTimeOffset Registered = new(2026, 11, 7, 10, 30, 0, 125, TimeSpan.Zero);

    [Fact]
    public void TheVersionIsTheInstantOfARegistrationAndASessionWithoutOneSendsNone()
    {
        Assert.True(MobileDeviceReleaseVersion.TryParse(null, out var none));
        Assert.Null(none);

        Assert.True(MobileDeviceReleaseVersion.TryParse("2026-11-07T10:30:00.125+00:00", out var utc));
        Assert.Equal(Registered, utc);
        Assert.True(MobileDeviceReleaseVersion.TryParse("2026-11-07T06:30:00.125-04:00", out var local));
        Assert.Equal(Registered, local);
        Assert.Equal(TimeSpan.Zero, local!.Value.Offset);

        Assert.False(MobileDeviceReleaseVersion.TryParse("ayer", out _));
        Assert.False(MobileDeviceReleaseVersion.TryParse(" ", out _));
    }

    [Fact]
    public void OnlyABindingOpenedAfterTheVersionSupersedesTheRelease()
    {
        // The session's binding began at its sign-in, before the registration the release names.
        Assert.False(MobileDeviceReleaseVersion.Superseded(Registered, Registered.AddMinutes(-5)));
        Assert.False(MobileDeviceReleaseVersion.Superseded(Registered, Registered));
        // A new sign-in opened another binding after it.
        Assert.True(MobileDeviceReleaseVersion.Superseded(Registered, Registered.AddMilliseconds(1)));
        // Without a version the release frees whatever binding the account holds.
        Assert.False(MobileDeviceReleaseVersion.Superseded(null, Registered.AddDays(1)));
    }

    [Fact]
    public void ASessionBeginsAtItsSignInAndRenewsOnlyABindingOfAnEarlierOne()
    {
        var issued = new DateTimeOffset(2026, 11, 7, 10, 30, 0, TimeSpan.Zero);
        static string Seconds(DateTimeOffset instant) =>
            instant.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        // A token names its sign-in (auth_time), which every renewal keeps (ADR-0046)...
        Assert.Equal(issued, MobileDeviceSession.StartedAt(Seconds(issued), Seconds(issued.AddHours(9))));
        // ...and a token issued without it began its session when it was issued (iat).
        Assert.Equal(issued, MobileDeviceSession.StartedAt(null, Seconds(issued)));
        Assert.Equal(TimeSpan.Zero, MobileDeviceSession.StartedAt("1762511400", null)!.Value.Offset);
        foreach (var invalid in new[] { null, "", "ayer", "-5", "0", "1.5", " 1762511400", "999999999999999" })
        {
            Assert.Null(MobileDeviceSession.StartedAt(invalid, invalid));
            // An unreadable auth_time counts as a missing one.
            Assert.Equal(issued, MobileDeviceSession.StartedAt(invalid, Seconds(issued)));
        }

        // A binding of an earlier session began before this one; the session's own began at or after its start.
        Assert.True(MobileDeviceSession.HeldByEarlierSession(issued.AddMilliseconds(-1), issued));
        Assert.False(MobileDeviceSession.HeldByEarlierSession(issued, issued));
        Assert.False(MobileDeviceSession.HeldByEarlierSession(issued.AddMinutes(3), issued));
        // A registration that names no session only refreshes the binding.
        Assert.False(MobileDeviceSession.HeldByEarlierSession(issued.AddYears(-1), null));
    }
}
