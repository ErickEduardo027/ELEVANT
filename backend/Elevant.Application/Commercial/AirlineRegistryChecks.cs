using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>
/// The automatic registry check of a commercial request (ADR-0023): a public submission with a
/// proposed airline and every approval ask the registries (never AeroDataBox) within a time budget.
/// A registry that fails or is too slow makes the verdict «Unavailable», never an error.
/// </summary>
public static class AirlineRegistryChecks
{
    /// <summary>Longest wait for all the registries together; Wikidata alone times out at 8 s.</summary>
    public static readonly TimeSpan Budget = TimeSpan.FromSeconds(10);

    /// <summary>Verdicts that block an approval unless Superadministración verified the airline by hand.</summary>
    public static bool Blocks(string? status) =>
        status is nameof(AirlineRegistryStatus.NotFound) or nameof(AirlineRegistryStatus.Defunct)
            or nameof(AirlineRegistryStatus.Mismatch);

    public static async Task<AirlineRegistryCheck> RunAsync(IAirlineRegistryLookup registry, string name,
        string? iataCode, string? icaoCode, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(registry);
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(Budget);
        try
        {
            return await registry.CheckAsync(name, iataCode, icaoCode, budget.Token);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested &&
            exception is OperationCanceledException or HttpRequestException or TimeoutException)
        {
            return new AirlineRegistryCheck(AirlineRegistryCheck.Unavailable, null, null, null, null, null, null,
                ["Ningún registro público respondió a tiempo."], DateTimeOffset.UtcNow);
        }
    }

    /// <summary>The Spanish detail stored with the verdict: its differences, at most 500 characters.</summary>
    public static string? Detail(AirlineRegistryCheck check)
    {
        ArgumentNullException.ThrowIfNull(check);
        var text = string.Join(" ", check.Differences ?? []).Trim();
        return text.Length == 0 ? null : text.Length <= 500 ? text : text[..500];
    }
}
