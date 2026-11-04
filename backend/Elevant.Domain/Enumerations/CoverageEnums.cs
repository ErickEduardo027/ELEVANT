namespace Elevant.Domain.Enumerations;

/// <summary>Aircraft size a stand admits (ADR-0030): narrow-body or wide-body.</summary>
public enum AircraftSizeCategory
{
    Narrowbody,
    Widebody,
}

/// <summary>What occupying one stand does to another (ADR-0030).</summary>
public enum StandConstraintKind
{
    /// <summary>The affected stand cannot be used while the stand is occupied (9A cancels 10).</summary>
    Cancels,

    /// <summary>The affected stand only takes narrow-body aircraft while the stand is occupied (23A limits 25).</summary>
    NarrowbodyOnly,
}
