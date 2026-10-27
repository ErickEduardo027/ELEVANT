namespace Elevant.Application.Abstractions.Commercial;

public sealed record CommercialRequestItemData(Guid ServiceId, string Name, string Unit);
public sealed record CommercialStationData(Guid Id, string Code, string Name);
public sealed record CommercialRequestData(
    Guid Id, string Reference, string Airline, Guid AirlineProfileId,
    string? LegalName, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, bool AirlineVerified, string? VerificationSourceUrl,
    string RepresentativeName, string RepresentativeTitle,
    string RepresentativeEmail, string RepresentativePhone,
    string? RepresentativeNationalityCode, string? RepresentativeAddress,
    string? RepresentativeCountry, string? RepresentativeProvince,
    string? RepresentativeMunicipality, string? RepresentativeDocumentType,
    string? RepresentativeDocumentNumber,
    bool AuthorityDeclared, string Status, DateTimeOffset SubmittedAt,
    string? DecisionReason, Guid? ContractId,
    IReadOnlyList<CommercialRequestItemData> Services,
    string? RepresentativeDistrict = null);

public sealed record VerifyAirlineInput(string LegalName, string CountryCode,
    string IataCode, string IcaoCode, string VerificationSourceUrl, string? LogoUrl);
public sealed record ReviewCommercialInput(bool Approve, string? Reason,
    IReadOnlyList<Guid> StationIds);

public enum CommercialWorkflowFailure
{
    Forbidden, NotFound, Invalid, Conflict, AirlineUnverified,
}
public sealed record CommercialWorkflowResult(Guid? ResourceId,
    CommercialWorkflowFailure? Failure)
{
    public bool IsSuccess => ResourceId is not null;
    public static CommercialWorkflowResult Success(Guid id) => new(id, null);
    public static CommercialWorkflowResult Failed(CommercialWorkflowFailure failure) => new(null, failure);
}

public interface ICommercialWorkflowStore
{
    Task<IReadOnlyList<CommercialRequestData>?> ListRequestsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CommercialStationData>?> ListStationsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<CommercialWorkflowResult> VerifyAirlineAsync(Guid actorId, Guid profileId,
        VerifyAirlineInput input, CancellationToken cancellationToken = default);
    Task<CommercialWorkflowResult> DecideAsync(Guid actorId, Guid requestId,
        ReviewCommercialInput input, CancellationToken cancellationToken = default);
}
