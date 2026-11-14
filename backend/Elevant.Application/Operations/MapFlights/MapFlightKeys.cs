namespace Elevant.Application.Operations.MapFlights;

/// <summary>
/// The keys the map names its flights and visits by (ADR-0042, contracts 1.3): a prefix that says what the id is and the
/// id in lower case with hyphens. They are opaque to the screens, which only compare them.
/// </summary>
public static class MapFlightKeys
{
    /// <summary>A proposal of the flight feed: an open one, or the one an imported leg came from.</summary>
    public const string ProposalPrefix = "p:";

    /// <summary>A leg of a turnaround that no proposal created.</summary>
    public const string LegPrefix = "l:";

    /// <summary>A turnaround, as the visit of an aircraft that no proposal created.</summary>
    public const string TurnaroundPrefix = "t:";

    public static string Proposal(Guid proposalId) => ProposalPrefix + proposalId.ToString("D");

    public static string Leg(Guid legId) => LegPrefix + legId.ToString("D");

    public static string Turnaround(Guid turnaroundId) => TurnaroundPrefix + turnaroundId.ToString("D");
}
