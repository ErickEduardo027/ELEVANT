namespace Elevant.Contracts.Commercial;

/// <summary>Active public choices for a Development affiliation request.</summary>
public sealed record AffiliationOptionsResponse(
    IReadOnlyList<AffiliationStationOptionResponse> Stations,
    IReadOnlyList<AffiliationServiceOptionResponse> Services);

public sealed record AffiliationStationOptionResponse(Guid Id, string Code, string Name);

public sealed record AffiliationServiceOptionResponse(
    Guid Id, string Code, string Name, string DefaultBillingUnit);
