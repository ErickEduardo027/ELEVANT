using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>
/// A station of the airline's contracts (2-N32): every station of a version Finance approved, the same
/// scope its treasury history keeps, and whether a contract in force covers it today.
/// </summary>
public sealed record AirlinePortalStandingStationData(Guid Id, string Code, string Name, string IanaTimeZone, bool Current);

/// <summary>
/// A contract of the airline as the portal labels it (2-N35): its status, why a contract that never
/// activated is still waiting (<see cref="AirlinePortalStandings.PendingSignatures"/> or
/// <see cref="AirlinePortalStandings.PendingOperatingPermit"/>) and the approved versions that wait for both
/// signatures, a renewal or an amendment of an active contract included.
/// </summary>
public sealed record AirlinePortalStandingContractData(Guid Id, string Code, string Status, string? PendingReason,
    IReadOnlyList<Guid> VersionsAwaitingSignatures);

/// <summary>
/// Where the airline stands with AVIAM (2-N32): one overall status, whether the portal is read-only (no
/// contract covers any station today: history, invoices and payments stay available), the historical
/// stations and its contracts. The bootstrap keeps describing only what is in force today.
/// </summary>
public sealed record AirlinePortalStandingData(Guid OrganizationId, string Status, bool ReadOnly,
    IReadOnlyList<AirlinePortalStandingStationData> Stations, IReadOnlyList<AirlinePortalStandingContractData> Contracts);

public sealed record AirlinePortalStandingResult(AirlinePortalStandingData? Standing, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Standing is not null && Failure is null;

    public static AirlinePortalStandingResult Success(AirlinePortalStandingData standing) => new(standing, null);

    public static AirlinePortalStandingResult Failed(AirlinePortalFailure failure) => new(null, failure);
}

/// <summary>The rules that turn contract facts into the airline's standing (2-N32, 2-N35).</summary>
public static class AirlinePortalStandings
{
    public const string Active = "Active";
    public const string Pending = "Pending";
    public const string Suspended = "Suspended";
    public const string Expired = "Expired";
    public const string Terminated = "Terminated";
    public const string None = "None";

    /// <summary>A contract that never activated waits for both signatures of an approved version.</summary>
    public const string PendingSignatures = "signatures";

    /// <summary>Both parties signed; a verified, current operating permit is what is missing.</summary>
    public const string PendingOperatingPermit = "operating_permit";

    /// <summary>
    /// The overall status, by what matters most to the airline: a contract in force, then a suspended one,
    /// one about to start, an expired one and finally a terminated one.
    /// </summary>
    public static string Overall(IReadOnlyCollection<ContractStatus> statuses) =>
        statuses.Contains(ContractStatus.Active) ? Active
        : statuses.Contains(ContractStatus.Suspended) ? Suspended
        : statuses.Contains(ContractStatus.Draft) ? Pending
        : statuses.Contains(ContractStatus.Expired) ? Expired
        : statuses.Contains(ContractStatus.Terminated) ? Terminated
        : None;

    /// <summary>
    /// Why a contract that never activated still waits: an approved version without both signatures, or the
    /// operating permit. Any other contract has no pending reason.
    /// </summary>
    public static string? PendingReason(ContractStatus status, bool awaitingSignatures, bool hasUsablePermit) =>
        status != ContractStatus.Draft ? null
        : awaitingSignatures ? PendingSignatures
        : hasUsablePermit ? null
        : PendingOperatingPermit;
}
