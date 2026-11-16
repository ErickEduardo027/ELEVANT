using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Integration.AviationReference;

/// <summary>Why a reference read was refused before reaching the cache.</summary>
public enum AviationReferenceFailure
{
    /// <summary>No valid session behind the request.</summary>
    Unauthorized,

    /// <summary>The caller may not read it.</summary>
    Forbidden,

    /// <summary>A missing or malformed code, registration or station.</summary>
    InvalidRequest,

    /// <summary>The station is not in the caller's scope, unknown, inactive or without an ICAO airport.</summary>
    NotFound,
}

/// <summary>
/// One reference answer for the screens: what was asked (<paramref name="Subject"/>, normalized), its state, the instant
/// the answer leaves, when the provider gave the value and the value itself (null when there is none).
/// </summary>
public sealed record AviationReferenceAnswer<T>(Guid? StationId, string Subject, AviationReferenceStatus Status,
    DateTimeOffset ServerTime, DateTimeOffset? RetrievedAt, T? Value)
    where T : class;

/// <summary>A reference answer, or why it was refused.</summary>
public sealed record AviationReferenceResult<T>(AviationReferenceAnswer<T>? Value, AviationReferenceFailure? Failure)
    where T : class
{
    public static AviationReferenceResult<T> Failed(AviationReferenceFailure failure) => new(null, failure);
}

/// <summary>Normalization of what the screens send.</summary>
public static partial class AviationReferenceCodes
{
    /// <summary>A registration in upper case without spaces or dashes («hi-1055» → «HI1055»); null when it is not one.</summary>
    public static string? Registration(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var compact = value.Trim().ToUpperInvariant().Replace(" ", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal);
        return RegistrationPattern().IsMatch(compact) ? compact : null;
    }

    /// <summary>An airline code: three ICAO letters or two IATA characters, in upper case; null otherwise.</summary>
    public static string? Airline(string? value)
    {
        var code = value?.Trim().ToUpperInvariant();
        return code is not null && (IcaoAirlinePattern().IsMatch(code) || IataAirlinePattern().IsMatch(code)) ? code : null;
    }

    /// <summary>An airport code: three IATA or four ICAO letters, in upper case; null otherwise.</summary>
    public static string? Airport(string? value)
    {
        var code = value?.Trim().ToUpperInvariant();
        return code is not null && AirportPattern().IsMatch(code) ? code : null;
    }

    [GeneratedRegex("^[A-Z0-9]{2,10}$", RegexOptions.CultureInvariant)]
    private static partial Regex RegistrationPattern();

    [GeneratedRegex("^[A-Z]{3}$", RegexOptions.CultureInvariant)]
    private static partial Regex IcaoAirlinePattern();

    [GeneratedRegex("^(?=.*[A-Z])[A-Z0-9]{2}$", RegexOptions.CultureInvariant)]
    private static partial Regex IataAirlinePattern();

    [GeneratedRegex("^[A-Z]{3,4}$", RegexOptions.CultureInvariant)]
    private static partial Regex AirportPattern();
}

/// <summary>
/// <c>GET contracts/airline-fleet</c> (ADR-0028, note of 15 November 2026): the fleet of an airline by its code, for
/// Contratos' intake and the superadministrator's airline catalog. A superadministrator, or AVIAM internal staff with
/// <c>contracts.requests.read</c>, may read it. It informs the reviewer and blocks nothing.
/// </summary>
public sealed class GetAirlineFleetHandler(IActorContextResolver actors, AviationReferenceReader reader,
    IProviderUsageLedger ledger, TimeProvider timeProvider)
{
    public const string ReadPermission = "contracts.requests.read";

    public async Task<AviationReferenceResult<AirlineFleetFacts>> HandleAsync(Guid accountId, string? airlineCode,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return AviationReferenceResult<AirlineFleetFacts>.Failed(AviationReferenceFailure.Unauthorized);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return AviationReferenceResult<AirlineFleetFacts>.Failed(AviationReferenceFailure.Unauthorized);
        if (actor!.EffectiveAccess?.IsSuperAdministrator != true &&
            !Operations.OccPlanningAccess.IsAuthorized(actor, ReadPermission))
            return AviationReferenceResult<AirlineFleetFacts>.Failed(AviationReferenceFailure.Forbidden);
        if (AviationReferenceCodes.Airline(airlineCode) is not { } code)
            return AviationReferenceResult<AirlineFleetFacts>.Failed(AviationReferenceFailure.InvalidRequest);

        var read = await reader.ReadAsync(AviationReferenceKind.AirlineFleet, code,
            (provider, token) => provider.GetAirlineFleetAsync(code, token), fleet => fleet.Sample.Count, ledger, null,
            accountId, cancellationToken);
        return new AviationReferenceResult<AirlineFleetFacts>(new AviationReferenceAnswer<AirlineFleetFacts>(null, code,
            read.Status, timeProvider.GetUtcNow(), read.RetrievedAt, read.Value), null);
    }
}

/// <summary>
/// The OCC's reference reads (ADR-0028 and ADR-0043, notes of 15 November 2026), for the same readers as the OCC map
/// (<see cref="OccMapAccess"/>): an aircraft by its registration, the daily routes from the station's airport and the
/// current delays of the station's airport or of another one. Each read goes through the cache and the caps of
/// <see cref="AviationReferenceReader"/>; a demo flight's registration is never asked.
/// </summary>
public sealed class GetOccAviationReferenceHandler(IActorContextResolver actors, IOccStationAirportStore airports,
    AviationReferenceReader reader, IProviderUsageLedger ledger, TimeProvider timeProvider)
{
    public async Task<AviationReferenceResult<AircraftFacts>> AircraftAsync(Guid accountId, Guid stationId,
        string? registration, CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(accountId, stationId, cancellationToken) is { } failure)
            return AviationReferenceResult<AircraftFacts>.Failed(failure);
        if (AviationReferenceCodes.Registration(registration) is not { } tail)
            return AviationReferenceResult<AircraftFacts>.Failed(AviationReferenceFailure.InvalidRequest);
        if (DemoFlightNumbering.IsRegistration(tail))
            return Answer<AircraftFacts>(stationId, tail,
                new AviationReferenceRead<AircraftFacts>(AviationReferenceStatus.NotApplicable, null, null));

        var read = await reader.ReadAsync(AviationReferenceKind.Aircraft, tail,
            (provider, token) => provider.GetAircraftAsync(tail, token), _ => 1, ledger, stationId, accountId,
            cancellationToken);
        return Answer(stationId, tail, read);
    }

    public async Task<AviationReferenceResult<AirportRouteFacts>> RoutesAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(accountId, stationId, cancellationToken) is { } failure)
            return AviationReferenceResult<AirportRouteFacts>.Failed(failure);
        if (await StationIcaoAsync(stationId, cancellationToken) is not { } icao)
            return AviationReferenceResult<AirportRouteFacts>.Failed(AviationReferenceFailure.NotFound);

        var read = await reader.ReadAsync(AviationReferenceKind.AirportRoutes, icao,
            (provider, token) => provider.GetDailyRoutesAsync(icao, token), routes => routes.Routes.Count, ledger,
            stationId, accountId, cancellationToken);
        return Answer(stationId, icao, read);
    }

    /// <summary>The current delays of the station's airport, or of another airport (IATA or ICAO) when one is given.</summary>
    public async Task<AviationReferenceResult<AirportDelayFacts>> DelaysAsync(Guid accountId, Guid stationId, string? airport,
        CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(accountId, stationId, cancellationToken) is { } failure)
            return AviationReferenceResult<AirportDelayFacts>.Failed(failure);
        string code;
        if (string.IsNullOrWhiteSpace(airport))
        {
            if (await StationIcaoAsync(stationId, cancellationToken) is not { } icao)
                return AviationReferenceResult<AirportDelayFacts>.Failed(AviationReferenceFailure.NotFound);
            code = icao;
        }
        else if (AviationReferenceCodes.Airport(airport) is { } other) code = other;
        else return AviationReferenceResult<AirportDelayFacts>.Failed(AviationReferenceFailure.InvalidRequest);

        var read = await reader.ReadAsync(AviationReferenceKind.AirportDelays, code,
            (provider, token) => provider.GetDelaysAsync(code, token), _ => 1, ledger, stationId, accountId,
            cancellationToken);
        return Answer(stationId, code, read);
    }

    private async Task<AviationReferenceFailure?> AuthorizeAsync(Guid accountId, Guid stationId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return AviationReferenceFailure.Unauthorized;
        if (stationId == Guid.Empty) return AviationReferenceFailure.InvalidRequest;
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        return OccMapAccess.Check(actor, accountId, stationId, requiredStationCode: null) switch
        {
            null => null,
            OccMapFailure.Unauthorized => AviationReferenceFailure.Unauthorized,
            OccMapFailure.Forbidden => AviationReferenceFailure.Forbidden,
            OccMapFailure.InvalidRequest => AviationReferenceFailure.InvalidRequest,
            _ => AviationReferenceFailure.NotFound,
        };
    }

    private async Task<string?> StationIcaoAsync(Guid stationId, CancellationToken cancellationToken)
    {
        var icao = await airports.FindIcaoCodeAsync(stationId, cancellationToken);
        return icao is { Length: 4 } && icao.All(char.IsAsciiLetterUpper) ? icao : null;
    }

    private AviationReferenceResult<T> Answer<T>(Guid stationId, string subject, AviationReferenceRead<T> read)
        where T : class =>
        new(new AviationReferenceAnswer<T>(stationId, subject, read.Status, timeProvider.GetUtcNow(), read.RetrievedAt,
            read.Value), null);
}
