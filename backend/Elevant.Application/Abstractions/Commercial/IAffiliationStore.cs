namespace Elevant.Application.Abstractions.Commercial;

/// <summary>Reads the public, active reference choices for affiliation.</summary>
public interface IAffiliationStore
{
    Task<AffiliationOptionsData> GetOptionsAsync(CancellationToken cancellationToken = default);
}

public sealed record AffiliationOptionsData(
    IReadOnlyList<AffiliationStationOptionData> Stations,
    IReadOnlyList<AffiliationServiceOptionData> Services);

public sealed record AffiliationStationOptionData(Guid Id, string Code, string Name);

public sealed record AffiliationServiceOptionData(
    Guid Id, string Code, string Name, string DefaultBillingUnit);
