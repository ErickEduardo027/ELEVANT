using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// <c>GET occ/weather</c> (ADR-0043, contracts 1.4): the METAR and the TAF of a station's airport, for the same readers
/// as the OCC map (<see cref="OccMapAccess"/>: AVIAM internal staff with the station in scope and any of the four map
/// permissions). The airport is the station's own (PUJ reads MDPC), so any station in scope has its weather. The weather
/// source keeps what the service answered and asks it only when its reports are due, so a read never waits for more than
/// one call per report. Its state travels in the success (<see cref="AerodromeWeatherStatus"/>): a service that is off,
/// failing or without a report is never a server error.
/// </summary>
public sealed class GetOccAerodromeWeatherHandler(IActorContextResolver actorResolver, IOccStationAirportStore airports,
    IAerodromeWeatherSource weather, TimeProvider timeProvider)
{
    /// <param name="accountId">The account of the session.</param>
    /// <param name="stationId">The station whose airport's weather is read.</param>
    /// <param name="cancellationToken">The request's cancellation: once it fires the read is abandoned and it is thrown.</param>
    public async Task<OccMapResult<OccAerodromeWeatherData>> HandleAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return OccMapResult.Failed<OccAerodromeWeatherData>(OccMapFailure.Unauthorized);
        if (stationId == Guid.Empty) return OccMapResult.Failed<OccAerodromeWeatherData>(OccMapFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (OccMapAccess.Check(actor, accountId, stationId, requiredStationCode: null) is { } failure)
            return OccMapResult.Failed<OccAerodromeWeatherData>(failure);

        // An unknown or inactive station, or an airport without a four-letter ICAO code, has no weather to read.
        var icaoCode = await airports.FindIcaoCodeAsync(stationId, cancellationToken);
        if (!IsIcaoCode(icaoCode)) return OccMapResult.Failed<OccAerodromeWeatherData>(OccMapFailure.NotFound);

        AerodromeWeatherData? data;
        try
        {
            data = await weather.ReadAsync(icaoCode, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // The service's own failures already come back as the reports the source may still serve; a fault of the
            // source itself leaves no report either, and the screens show the weather as unavailable.
            data = new AerodromeWeatherData(icaoCode, null, false, null, null);
        }

        // The state is resolved at the instant the answer leaves, the same one the answer carries.
        var now = timeProvider.GetUtcNow();
        var status = AerodromeWeatherStatus.Of(data, now);
        var credit = AerodromeWeatherAttribution.NoaaAviationWeatherCenter;
        return OccMapResult.Success(data is null
            ? new OccAerodromeWeatherData(stationId, icaoCode, status, now, null, credit, null, null)
            : new OccAerodromeWeatherData(stationId, icaoCode, status, now, data.RetrievedAt, credit, data.Metar, data.Taf));
    }

    /// <summary>Four letters in upper case, as an ICAO location indicator is written.</summary>
    private static bool IsIcaoCode([System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? code) =>
        code is { Length: 4 } && code.All(char.IsAsciiLetterUpper);
}
