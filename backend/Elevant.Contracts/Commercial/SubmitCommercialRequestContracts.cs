namespace Elevant.Contracts.Commercial;

public sealed record SubmitCommercialRequestRequest(
    Guid RequestId,
    Guid AirlineProfileId,
    IReadOnlyList<Guid> ServiceIds,
    string RepresentativeName,
    string RepresentativeTitle,
    string RepresentativeEmail,
    string RepresentativePhone,
    bool AuthorityDeclared);

public sealed record SubmitCommercialRequestResponse(string Reference, bool Replayed);
