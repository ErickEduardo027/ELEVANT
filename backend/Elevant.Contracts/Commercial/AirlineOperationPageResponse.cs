namespace Elevant.Contracts.Commercial;

/// <summary>Tenant-scoped, read-only operation history.</summary>
public sealed record AirlineOperationPageResponse(
    int Page, int Limit, bool HasMore,
    IReadOnlyList<AirlinePortalOperationResponse> Operations);
