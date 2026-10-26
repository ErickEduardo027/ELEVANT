namespace Elevant.Contracts.Commercial;

public sealed record SubmitCommercialRequestRequest(
    Guid RequestId,
    Guid AirlineProfileId,
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
    string? RepresentativeDistrict = null);

public sealed record SubmitCommercialRequestResponse(string Reference, bool Replayed);
