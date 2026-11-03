namespace Elevant.Application.Abstractions.Commercial;

/// <summary>An airline as a public registry describes it.</summary>
public sealed record AirlineRegistryCandidate(
    string Name,
    IReadOnlyList<string> IataCodes,
    IReadOnlyList<string> IcaoCodes,
    string? Country,
    bool Active,
    string? EntityUrl);

/// <summary>A public airline registry (Wikidata, OpenFlights…). Null means it could not answer.</summary>
public interface IAirlineRegistrySource
{
    string Name { get; }

    /// <summary>Lower answers first; the local registry of observed airlines (ADR-0028) is 0.</summary>
    int Order => 100;

    Task<IReadOnlyList<AirlineRegistryCandidate>?> FindAsync(string? iataCode, string? icaoCode,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Verdict of a registry check (ADR-0023). <see cref="Status"/> is Found, Mismatch, Defunct,
/// NotFound or Unavailable (no registry answered); <see cref="Differences"/> explains a mismatch.
/// </summary>
public sealed record AirlineRegistryCheck(
    string Status,
    string? Source,
    string? MatchedName,
    string? MatchedIataCode,
    string? MatchedIcaoCode,
    string? Country,
    string? EntityUrl,
    IReadOnlyList<string> Differences,
    DateTimeOffset CheckedAt)
{
    public const string Unavailable = "Unavailable";
}

public interface IAirlineRegistryLookup
{
    Task<AirlineRegistryCheck> CheckAsync(string name, string? iataCode, string? icaoCode,
        CancellationToken cancellationToken = default);
}
