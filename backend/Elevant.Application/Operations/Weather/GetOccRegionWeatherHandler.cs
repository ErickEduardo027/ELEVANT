using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// <c>GET occ/weather/region</c> (plan M6 of 27 November 2026): the METAR and the TAF of every airport of the region
/// around a station's airport, for the same readers as the OCC map (<see cref="OccMapAccess"/>: AVIAM internal staff
/// with the station in scope and any of the four map permissions). The region is the one of the station's own airport
/// (<see cref="RegionWeatherStations"/>): Punta Cana has the 32 airports the maps draw in Región, and a station whose
/// airport has no region is not found. The weather source reads the service for the whole region at once and keeps what
/// it answered, so a read never waits for more than one call per kind of report. Its state travels in the success
/// (<see cref="RegionWeatherStatus"/>): a service that is off, failing or without reports is never a server error.
/// </summary>
public sealed class GetOccRegionWeatherHandler(IActorContextResolver actorResolver, IOccStationAirportStore airports,
    IRegionWeatherSource weather, TimeProvider timeProvider)
{
    /// <param name="accountId">The account of the session.</param>
    /// <param name="stationId">The station whose airport's region is read.</param>
    /// <param name="cancellationToken">The request's cancellation: once it fires the read is abandoned and it is thrown.</param>
    public async Task<OccMapResult<OccRegionWeatherData>> HandleAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return OccMapResult.Failed<OccRegionWeatherData>(OccMapFailure.Unauthorized);
        if (stationId == Guid.Empty) return OccMapResult.Failed<OccRegionWeatherData>(OccMapFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (OccMapAccess.Check(actor, accountId, stationId, requiredStationCode: null) is { } failure)
            return OccMapResult.Failed<OccRegionWeatherData>(failure);

        // An unknown or inactive station, or one whose airport has no region, has no regional weather to read.
        var region = RegionWeatherStations.Around(await airports.FindIcaoCodeAsync(stationId, cancellationToken));
        if (region is null) return OccMapResult.Failed<OccRegionWeatherData>(OccMapFailure.NotFound);

        RegionWeatherData? data;
        try
        {
            data = await weather.ReadAsync([.. region.Select(station => station.IcaoCode)], cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // The service's own failures already come back as the reports the source may still serve; a fault of the
            // source itself leaves no report either, and the screens show the region as unavailable.
            data = RegionWeatherData.Without(WeatherServiceFailure.Failed);
        }

        // The state is resolved at the instant the answer leaves, the same one the answer carries.
        var now = timeProvider.GetUtcNow();
        var (status, reason) = RegionWeatherStatus.Of(data, now);
        return OccMapResult.Success(new OccRegionWeatherData(stationId, status, reason, now,
            RegionWeatherStatus.RefreshAfterSeconds(data, now), AerodromeWeatherAttribution.NoaaAviationWeatherCenter,
            [.. region.Select(station => Station(station, data))]));
    }

    private static OccRegionStationWeather Station(RegionWeatherStation station, RegionWeatherData? data)
    {
        var metar = data?.Metars.GetValueOrDefault(station.IcaoCode);
        return new OccRegionStationWeather(station, metar, metar is null ? null : MetarCeiling.Of(metar.Clouds),
            data?.Tafs.GetValueOrDefault(station.IcaoCode));
    }
}
