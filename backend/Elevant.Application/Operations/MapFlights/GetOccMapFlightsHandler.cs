using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Operations.MapFlights;

/// <summary>
/// <c>GET occ/map/flights</c> (ADR-0042, contracts 1.3): the ELEVANT flights of a station for the map, from
/// <c>hoursBack</c> hours before now to <c>hoursAhead</c> hours after it. Any map reader of the station reads them,
/// proposals and milestone times included; no station has to be the one with live traffic.
/// </summary>
public sealed class GetOccMapFlightsHandler(IActorContextResolver actorResolver, IOccMapFlightStore store,
    TimeProvider timeProvider)
{
    /// <summary>Hours before now the window starts at when the query does not say.</summary>
    public const int DefaultHoursBack = 2;

    /// <summary>The window never starts earlier than this many hours before now.</summary>
    public const int MaxHoursBack = 24;

    /// <summary>Hours after now the window ends at when the query does not say.</summary>
    public const int DefaultHoursAhead = 12;

    /// <summary>The window always reaches at least this many hours after now.</summary>
    public const int MinHoursAhead = 1;

    /// <summary>The window never ends later than this many hours after now.</summary>
    public const int MaxHoursAhead = 36;

    /// <param name="accountId">The account of the session.</param>
    /// <param name="stationId">The station whose flights are read.</param>
    /// <param name="hoursBack">0 to 24; 2 when absent.</param>
    /// <param name="hoursAhead">1 to 36; 12 when absent.</param>
    /// <param name="cancellationToken">The request's cancellation.</param>
    public async Task<OccMapResult<OccMapFlightsData>> HandleAsync(Guid accountId, Guid stationId, int? hoursBack,
        int? hoursAhead, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return OccMapResult.Failed<OccMapFlightsData>(OccMapFailure.Unauthorized);
        var back = hoursBack ?? DefaultHoursBack;
        var ahead = hoursAhead ?? DefaultHoursAhead;
        if (stationId == Guid.Empty || back is < 0 or > MaxHoursBack || ahead is < MinHoursAhead or > MaxHoursAhead)
            return OccMapResult.Failed<OccMapFlightsData>(OccMapFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (OccMapAccess.Check(actor, accountId, stationId, requiredStationCode: null) is { } failure)
            return OccMapResult.Failed<OccMapFlightsData>(failure);

        var now = timeProvider.GetUtcNow();
        var data = await store.ListAsync(stationId, now.AddHours(-back), now.AddHours(ahead), now, cancellationToken);
        return data is null
            ? OccMapResult.Failed<OccMapFlightsData>(OccMapFailure.NotFound)
            : OccMapResult.Success(data);
    }
}
