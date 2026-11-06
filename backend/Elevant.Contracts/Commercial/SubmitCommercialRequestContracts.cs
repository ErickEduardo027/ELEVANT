namespace Elevant.Contracts.Commercial;

/// <summary>
/// Anonymous application. <c>airlineProfileId</c> names a catalog airline; when the airline is not
/// listed it is null and <c>proposedAirline</c> describes it instead (1-N25).
/// </summary>
public sealed record SubmitCommercialRequestRequest(
    Guid RequestId,
    Guid? AirlineProfileId,
    IReadOnlyList<Guid> ServiceIds,
    string RepresentativeName,
    string RepresentativeTitle,
    string RepresentativeEmail,
    string RepresentativePhone,
    bool AuthorityDeclared,
    string? RepresentativeNationalityCode = null,
    string? RepresentativeAddress = null,
    string? RepresentativeCountry = null,
    string? RepresentativeProvince = null,
    string? RepresentativeMunicipality = null,
    string? RepresentativeDocumentType = null,
    string? RepresentativeDocumentNumber = null,
    string? RepresentativeDistrict = null,
    ProposedAirlineRequest? ProposedAirline = null);

/// <summary>Airline that is not in the public catalog: ICAO is required, IATA only when it has one.</summary>
public sealed record ProposedAirlineRequest(
    string Name,
    string CountryCode,
    string? IataCode,
    string IcaoCode,
    string? WebsiteUrl = null);

public sealed record SubmitCommercialRequestResponse(string Reference, bool Replayed);
