using Elevant.Application.Operations.MapFlights;

namespace Elevant.UnitTests.Application;

/// <summary>ADR-0042 (contracts 1.3): the map names its flights and visits by a prefix and the id in lower case.</summary>
public sealed class MapFlightKeysTests
{
    [Fact]
    public void KeysCarryTheirPrefix()
    {
        var id = Guid.Parse("0196F1C2-3D4E-7A5B-8C9D-0E1F2A3B4C5D");

        Assert.Equal("p:0196f1c2-3d4e-7a5b-8c9d-0e1f2a3b4c5d", MapFlightKeys.Proposal(id));
        Assert.Equal("l:0196f1c2-3d4e-7a5b-8c9d-0e1f2a3b4c5d", MapFlightKeys.Leg(id));
        Assert.Equal("t:0196f1c2-3d4e-7a5b-8c9d-0e1f2a3b4c5d", MapFlightKeys.Turnaround(id));
        Assert.Equal(("p:", "l:", "t:"), (MapFlightKeys.ProposalPrefix, MapFlightKeys.LegPrefix, MapFlightKeys.TurnaroundPrefix));
        // The same id is three different keys.
        Assert.Equal(3, new[] { MapFlightKeys.Proposal(id), MapFlightKeys.Leg(id), MapFlightKeys.Turnaround(id) }.Distinct().Count());
    }
}
