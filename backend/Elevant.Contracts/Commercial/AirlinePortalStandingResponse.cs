namespace Elevant.Contracts.Commercial;

/// <summary>
/// Where the airline stands with AVIAM (2-N32): <c>Status</c> is Active, Pending, Suspended, Expired,
/// Terminated or None; <c>ReadOnly</c> means no contract covers any station today, while history, invoices
/// and payments stay available. The stations are every station of its approved contracts.
/// </summary>
public sealed record AirlinePortalStandingResponse(
    Guid OrganizationId,
    string Status,
    bool ReadOnly,
    IReadOnlyList<AirlinePortalStandingStationResponse> Stations,
    IReadOnlyList<AirlinePortalStandingContractResponse> Contracts);

/// <summary>A station of the airline's contracts; <c>Current</c> when a contract in force covers it today.</summary>
public sealed record AirlinePortalStandingStationResponse(
    Guid Id,
    string Code,
    string Name,
    string IanaTimeZone,
    bool Current);

/// <summary>
/// A contract as the portal labels it (2-N35): <c>PendingReason</c> is <c>signatures</c> or
/// <c>operating_permit</c> for a contract that never activated, and the versions listed wait for both signatures.
/// </summary>
public sealed record AirlinePortalStandingContractResponse(
    Guid Id,
    string Code,
    string Status,
    string? PendingReason,
    IReadOnlyList<Guid> VersionsAwaitingSignatures);
