using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Persistence.Integration;

/// <summary>
/// Airlines seen in the flight data already paid for (ADR-0028), asked before any public
/// registry and at no cost. It only knows airlines that operated at our stations, so when it
/// knows nothing it says it cannot answer instead of «not found», and the next registry decides.
/// </summary>
internal sealed class ObservedAirlineRegistrySource(IServiceScopeFactory scopeFactory, TimeProvider timeProvider)
    : IAirlineRegistrySource
{
    private static readonly TimeSpan Active = TimeSpan.FromDays(365);

    public string Name => "Vuelos observados (AeroDataBox)";

    public int Order => 0;

    public async Task<IReadOnlyList<AirlineRegistryCandidate>?> FindAsync(string? iataCode, string? icaoCode,
        CancellationToken cancellationToken = default)
    {
        var iata = iataCode?.Trim().ToUpperInvariant();
        var icao = icaoCode?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(iata) && string.IsNullOrEmpty(icao)) return null;
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var entries = await context.Set<AirlineRegistryEntry>().AsNoTracking()
            .Where(entry => (iata != null && entry.IataCode == iata) || (icao != null && entry.IcaoCode == icao))
            .OrderByDescending(entry => entry.LastSeenAt).Take(10).ToArrayAsync(cancellationToken);
        if (entries.Length == 0) return null;
        var since = timeProvider.GetUtcNow() - Active;
        return entries.Select(entry => new AirlineRegistryCandidate(entry.Name,
            entry.IataCode is null ? [] : [entry.IataCode], entry.IcaoCode is null ? [] : [entry.IcaoCode], null,
            entry.LastSeenAt >= since, null)).ToArray();
    }
}
