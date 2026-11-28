using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// The layers of the weather of the region around a station's airport (plan M6 of 27 November 2026), for the readers of
/// the region's METARs (<see cref="GetOccRegionWeatherHandler"/>, <see cref="OccMapAccess"/>):
/// <list type="bullet">
/// <item><c>GET occ/weather/sigmets</c>: the international SIGMETs that touch the region's box.</item>
/// <item><c>GET occ/weather/wind</c>: the wind 10 m above the ground on a coarse grid over it.</item>
/// <item><c>GET occ/weather/radar</c>: the latest radar scans over it, as tile addresses.</item>
/// </list>
/// Only a station whose airport has a region (Punta Cana) is found. Each source reads its service for the whole box at
/// once and keeps what it answered; the state of each layer travels in the success (<see cref="RegionWeatherLayerStatus"/>):
/// a service that is off or failing is never a server error.
/// </summary>
public sealed class GetOccRegionWeatherLayersHandler(IActorContextResolver actorResolver, IOccStationAirportStore airports,
    IRegionSigmetSource sigmets, IRegionWindSource wind, IRegionRadarSource radar, TimeProvider timeProvider)
{
    /// <summary>The SIGMETs over the station's region still valid now, ordered by the end of their validity.</summary>
    public async Task<OccMapResult<OccRegionSigmetsData>> SigmetsAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var (failure, area) = await AreaAsync(accountId, stationId, cancellationToken);
        if (failure is { } refused) return OccMapResult.Failed<OccRegionSigmetsData>(refused);

        var layer = await ReadAsync(() => sigmets.ReadAsync(area!, cancellationToken), cancellationToken);
        var now = timeProvider.GetUtcNow();
        // A SIGMET past its validity is never served, also when it is the one kept after a failure.
        var valid = layer?.Value is { } all
            ? all.Where(sigmet => sigmet.ValidTo > now).OrderBy(sigmet => sigmet.ValidTo).ThenBy(sigmet => sigmet.Id,
                StringComparer.Ordinal).ToArray()
            : [];
        var (status, reason) = RegionWeatherLayerStatus.Of(layer, _ => true);
        return OccMapResult.Success(new OccRegionSigmetsData(stationId, status, reason, now,
            RegionWeatherLayerStatus.RefreshAfterSeconds(layer, RegionWeatherLayerPace.Sigmets, now),
            AerodromeWeatherAttribution.NoaaAviationWeatherCenter, valid));
    }

    /// <summary>The wind grid over the station's region.</summary>
    public async Task<OccMapResult<OccRegionWindData>> WindAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var (failure, area) = await AreaAsync(accountId, stationId, cancellationToken);
        if (failure is { } refused) return OccMapResult.Failed<OccRegionWindData>(refused);

        var layer = await ReadAsync(() => wind.ReadAsync(area!, cancellationToken), cancellationToken);
        var now = timeProvider.GetUtcNow();
        var (status, reason) = RegionWeatherLayerStatus.Of(layer, grid => now - grid.ValidAt <= RegionWeatherLayerStatus.LiveWindAge);
        var grid = layer?.Value ?? new RegionWindGrid(now, area!, RegionWindGridShape.Columns, RegionWindGridShape.Rows, []);
        return OccMapResult.Success(new OccRegionWindData(stationId, status, reason, now,
            RegionWeatherLayerStatus.RefreshAfterSeconds(layer, RegionWeatherLayerPace.Wind, now),
            AerodromeWeatherAttribution.OpenMeteo, layer?.Value?.ValidAt, grid));
    }

    /// <summary>The radar frames over the station's region; a region without a radar site has none, and nothing is asked.</summary>
    public async Task<OccMapResult<OccRegionRadarData>> RadarAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var (failure, area) = await AreaAsync(accountId, stationId, cancellationToken);
        if (failure is { } refused) return OccMapResult.Failed<OccRegionRadarData>(refused);

        RegionWeatherLayer<RegionRadarFrames>? layer = area!.RadarSite is null
            ? RegionWeatherLayer<RegionRadarFrames>.Without(null)
            : await ReadAsync(() => radar.ReadAsync(area, cancellationToken), cancellationToken);
        var now = timeProvider.GetUtcNow();
        // A provider without any scan has nothing to draw: unavailable, as without an answer.
        if (layer?.Value is { Frames.Count: 0 }) layer = layer with { Value = null };
        var (status, reason) = RegionWeatherLayerStatus.Of(layer,
            frames => now - frames.Frames[^1].Time <= RegionWeatherLayerStatus.LiveRadarAge);
        var frames = layer?.Value;
        return OccMapResult.Success(new OccRegionRadarData(stationId, status, reason, now,
            RegionWeatherLayerStatus.RefreshAfterSeconds(layer, RegionWeatherLayerPace.Radar, now),
            AerodromeWeatherAttribution.IowaEnvironmentalMesonet, frames?.Provider, frames?.MaxZoom ?? 0,
            frames?.Frames ?? []));
    }

    /// <summary>
    /// The box of the station's region once the account may read it: the same validation, readers and scope as the
    /// region's METARs. An unknown or inactive station, or one whose airport has no region, is not found.
    /// </summary>
    private async Task<(OccMapFailure? Failure, RegionWeatherArea? Area)> AreaAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (OccMapFailure.Unauthorized, null);
        if (stationId == Guid.Empty) return (OccMapFailure.InvalidRequest, null);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (OccMapAccess.Check(actor, accountId, stationId, requiredStationCode: null) is { } failure) return (failure, null);

        var area = RegionWeatherStations.AreaAround(await airports.FindIcaoCodeAsync(stationId, cancellationToken));
        return area is null ? (OccMapFailure.NotFound, null) : (null, area);
    }

    /// <summary>
    /// One read of a layer's source. The service's own failures already come back as what the source may still serve; a
    /// fault of the source itself leaves nothing either, and the screens show the layer as unavailable. Only the caller's
    /// cancellation is thrown.
    /// </summary>
    private static async Task<RegionWeatherLayer<T>?> ReadAsync<T>(Func<Task<RegionWeatherLayer<T>?>> read,
        CancellationToken cancellationToken) where T : class
    {
        try
        {
            return await read();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return RegionWeatherLayer<T>.Without(WeatherServiceFailure.Failed);
        }
    }
}
