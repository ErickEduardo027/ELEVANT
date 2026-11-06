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

/// <summary>Airline the applicant proposed because it was not in the public catalog (1-N25).</summary>
public sealed record CommercialProposedAirlineData(string Name, string? CountryCode, string? IataCode,
    string IcaoCode, string? WebsiteUrl);

/// <summary>Contratos' record that the representative speaks for the airline (1-N18).</summary>
public sealed record CommercialRepresentativeConfirmationData(DateTimeOffset ConfirmedAt, string ConfirmedBy,
    string Note);

/// <summary>
/// One request of the Contratos inbox. <paramref name="Version"/> is what every command on it expects:
/// the request's rowversion and, once linked, its airline profile's, because the approval freezes the
/// profile's identity (1-D). <paramref name="ExistingCustomer"/> tells that the airline already has a
/// live contract or active portal accounts, so approving it would be rejected.
/// </summary>
public sealed record CommercialInboxRequestData(
    Guid Id, string Reference, string Airline, Guid? AirlineProfileId,
    string? LegalName, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, bool AirlineVerified, string? VerificationSourceUrl, string? AirlineWebsiteUrl,
    string RepresentativeName, string RepresentativeTitle,
    string RepresentativeEmail, string RepresentativePhone,
    string? RepresentativeNationalityCode, string? RepresentativeAddress,
    string? RepresentativeCountry, string? RepresentativeProvince,
    string? RepresentativeMunicipality, string? RepresentativeDistrict,
    string? RepresentativeDocumentType, string? RepresentativeDocumentNumber,
    bool AuthorityDeclared, string Status, DateTimeOffset SubmittedAt,
    DateTimeOffset? ReviewedAt, DateTimeOffset? CancelledAt,
    string? DecisionReason, Guid? ContractId,
    CommercialRepresentativeConfirmationData? RepresentativeConfirmation,
    CommercialProposedAirlineData? ProposedAirline, bool ExistingCustomer,
    IReadOnlyList<CommercialRequestItemData> Services, string Version);

/// <summary>Requests per status over the whole inbox, for the Contratos indicators.</summary>
public sealed record CommercialInboxCountsData(int Pending, int InReview, int Approved, int Rejected,
    int Cancelled);

public sealed record CommercialInboxData(int Page, int Limit, int Total, bool HasMore,
    CommercialInboxCountsData Counts, IReadOnlyList<CommercialInboxRequestData> Requests);

/// <summary>
/// Inbox filter: <see cref="Open"/> (pending and in review, oldest first), <see cref="All"/> or one
/// status name; <paramref name="Search"/> matches reference, airline, representative name or email.
/// </summary>
public sealed record CommercialInboxQuery(string Status, string? Search, int Page, int Limit)
{
    public const string Open = "Open";
    public const string All = "All";
    public const int MaximumLimit = 50;
    public const int MaximumSearchLength = 100;

    public static readonly IReadOnlyList<string> Statuses =
        [Open, All, "Pending", "InReview", "Approved", "Rejected", "Cancelled"];

    public bool IsValid => Statuses.Contains(Status, StringComparer.Ordinal) && Page >= 1 &&
        Limit is >= 1 and <= MaximumLimit && (long)(Page - 1) * Limit <= int.MaxValue &&
        (Search is null || Search.Trim().Length <= MaximumSearchLength);
}

/// <summary>
/// Decision on a request. <paramref name="ExpectedVersion"/> is the inbox version the reviewer saw; it
/// is optional while older clients exist and required together with an Idempotency-Key.
/// </summary>
public sealed record ReviewCommercialInput(bool Approve, string? Reason,
    IReadOnlyList<Guid> StationIds, string? ExpectedVersion = null);

/// <summary>
/// Verifies the airline of a request with an official source. A request whose airline was proposed
/// (not in the catalog) is linked to <paramref name="LinkProfileId"/>, or to a new verified and
/// published profile when it is null. Linking a profile that is already verified needs no identity.
/// </summary>
public sealed record VerifyRequestAirlineInput(string? ExpectedVersion, Guid? LinkProfileId = null,
    string? LegalName = null, string? CountryCode = null, string? IataCode = null, string? IcaoCode = null,
    string? VerificationSourceUrl = null);

/// <summary>How Contratos confirmed, through the airline's own channels, that the representative speaks for it.</summary>
public sealed record ConfirmCommercialRepresentativeInput(string? ExpectedVersion, string? Note);

public sealed record CancelCommercialRequestInput(string? ExpectedVersion, string? Reason);

public enum CommercialWorkflowFailure
{
    Forbidden, NotFound, Invalid, Conflict, AirlineUnverified,
}

/// <summary>Result of a commercial command; <paramref name="Code"/> is the Problem Details code of a failure.</summary>
public sealed record CommercialWorkflowResult(Guid? ResourceId,
    CommercialWorkflowFailure? Failure, string? Code = null)
{
    public bool IsSuccess => ResourceId is not null;
    public static CommercialWorkflowResult Success(Guid id) => new(id, null);
    public static CommercialWorkflowResult Failed(CommercialWorkflowFailure failure, string? code = null) =>
        new(null, failure, code);
}

public interface ICommercialWorkflowStore
{
    Task<IReadOnlyList<CommercialRequestData>?> ListRequestsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    /// <summary>Filtered, paged inbox with its status counters; null when the actor cannot read requests.</summary>
    Task<CommercialInboxData?> ListInboxAsync(Guid actorId, CommercialInboxQuery query,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CommercialStationData>?> ListStationsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<CommercialWorkflowResult> VerifyRequestAirlineAsync(Guid actorId, Guid requestId,
        Guid idempotencyKey, VerifyRequestAirlineInput input, CancellationToken cancellationToken = default);
    Task<CommercialWorkflowResult> ConfirmRepresentativeAsync(Guid actorId, Guid requestId,
        Guid idempotencyKey, ConfirmCommercialRepresentativeInput input,
        CancellationToken cancellationToken = default);
    Task<CommercialWorkflowResult> CancelAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
        CancelCommercialRequestInput input, CancellationToken cancellationToken = default);
    /// <summary>Approves or rejects; with <paramref name="idempotencyKey"/> a retry replays the first result.</summary>
    Task<CommercialWorkflowResult> DecideAsync(Guid actorId, Guid requestId,
        ReviewCommercialInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
