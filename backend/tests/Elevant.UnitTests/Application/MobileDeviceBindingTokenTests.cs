using Elevant.Application.Integration;

namespace Elevant.UnitTests.Application;

/// <summary>2-N02: OCC's expected version of a tablet moves only when the tablet changes hands or is revoked.</summary>
public sealed class MobileDeviceBindingTokenTests
{
    [Fact]
    public void TheTokenChangesWithTheBindingItsStateAndTheRevocationOnly()
    {
        var bound = MobileDeviceBindingToken.Of(41, bindingOpen: true, revoked: false);

        Assert.Equal(bound, MobileDeviceBindingToken.Of(41, bindingOpen: true, revoked: false));
        Assert.NotEqual(bound, MobileDeviceBindingToken.Of(41, bindingOpen: false, revoked: false));
        Assert.NotEqual(bound, MobileDeviceBindingToken.Of(42, bindingOpen: true, revoked: false));
        Assert.NotEqual(MobileDeviceBindingToken.Of(41, false, false), MobileDeviceBindingToken.Of(41, false, true));
        Assert.Equal(MobileDeviceBindingToken.Of(null, false, false), MobileDeviceBindingToken.Of(0, false, false));
        // Opaque to clients: plain base64, nothing a screen should parse.
        Assert.Matches("^[A-Za-z0-9+/]+={0,2}$", bound);
    }

    [Fact]
    public void TheTabletCodesAreStable()
    {
        Assert.Equal("device_revoked", MobileDeviceCodes.Revoked);
        Assert.Equal("device_in_use_by_active_agent", MobileDeviceCodes.InUseByActiveAgent);
        Assert.Equal("device_platform_mismatch", MobileDeviceCodes.PlatformMismatch);
        Assert.Equal("device_not_bound", MobileDeviceCodes.NotBound);
        Assert.Equal("version_conflict", MobileDeviceCodes.VersionConflict);
    }
}
