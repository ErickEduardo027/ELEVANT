using System.Text.Json.Serialization;
using Elevant.Domain.Validation;

namespace Elevant.Application.Abstractions.Commercial;

/// <param name="RegistryStatus">Last public-registry check (ADR-0023): Found, Mismatch, Defunct or NotFound; null when never checked or stale.</param>
/// <param name="IdentityLocked">The airline already operates with AVIAM: its legal name, codes and verification are fixed (1-N20).</param>
/// <param name="TaxRegistration">
/// The airline's tax identifier (an RNC as its 9 digits) with <paramref name="TaxRegistrationCountryCode"/>; both are
/// omitted when null so screens released before them, which reject unknown keys, keep reading (expand phase).
/// </param>
public sealed record ManagedAirlineData(
    Guid Id, string SourceName, string DisplayName, string? LegalName,
    string Region, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, string SourceUrl, string? VerificationSourceUrl,
    bool IsVerified, bool IsPublished, string Version,
    string? RegistryStatus = null, string? RegistrySource = null, DateTimeOffset? RegistryCheckedAt = null,
    string? RegistryEntityUrl = null, bool IdentityLocked = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TaxRegistration = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TaxRegistrationCountryCode = null);

/// <summary>What a registry check is about; the record step refuses it if these changed meanwhile.</summary>
public sealed record AirlineRegistryKey(Guid Id, string Name, string? IataCode, string? IcaoCode);

/// <summary>The stored airline after a registry check, with the full verdict for the screen.</summary>
public sealed record AirlineRegistryCheckResult(ManagedAirlineData Airline, AirlineRegistryCheck Check);

/// <remarks>
/// <c>TaxRegistration</c> is the airline's optional tax identifier; the saved profile keeps exactly what the form
/// sends (empty clears it). With it, <c>TaxRegistrationCountryCode</c> is required; a Dominican airline's is an RNC
/// (ADR-0020). It is not part of the verified identity: changing it never voids the registry check or the manual
/// verification.
/// </remarks>
public sealed record ManagedAirlineInput(
    string SourceName, string DisplayName, string? LegalName,
    string Region, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, string SourceUrl, string? VerificationSourceUrl,
    bool IsVerified, bool IsPublished, string? Version,
    string? TaxRegistration = null, string? TaxRegistrationCountryCode = null)
{
    /// <summary>The canonical tax identifier, or null when none was given.</summary>
    public TaxRegistration? TaxRegistrationOrNull() =>
        TaxRegistrations.Normalize(TaxRegistration, TaxRegistrationCountryCode);

    /// <summary>
    /// Empty, or a valid identifier with its country; a Dominican airline's identifier is a Dominican RNC.
    /// </summary>
    public bool HasValidTaxRegistration() =>
        string.IsNullOrWhiteSpace(TaxRegistration) ||
        TaxRegistrationOrNull() is { } tax &&
        (CountryCode?.Trim().ToUpperInvariant() != TaxRegistrations.DominicanRepublic ||
            tax.CountryCode == TaxRegistrations.DominicanRepublic);

    public bool IsValid() =>
        HasValidTaxRegistration() &&
        Required(SourceName, 160) && Required(DisplayName, 160) &&
        Optional(LegalName, 200) && Required(Region, 64) &&
        Code(CountryCode, 2, lettersOnly: true) &&
        Code(IataCode, 2) && Code(IcaoCode, 3, lettersOnly: true) &&
        (string.IsNullOrWhiteSpace(IataCode) || Elevant.Domain.Validation.AirlineCodes.IsIata(IataCode.Trim().ToUpperInvariant())) &&
        (string.IsNullOrWhiteSpace(IcaoCode) || Elevant.Domain.Validation.AirlineCodes.IsIcao(IcaoCode.Trim().ToUpperInvariant())) &&
        Url(SourceUrl, required: true) && Url(VerificationSourceUrl) &&
        (string.IsNullOrWhiteSpace(LogoUrl) ||
            LogoUrl.StartsWith("/api/v1/media/", StringComparison.Ordinal) &&
            Guid.TryParse(LogoUrl["/api/v1/media/".Length..], out _) ||
            LogoUrl.Length <= 512 && LogoUrl.StartsWith("/assets/airlines/", StringComparison.Ordinal) &&
            LogoUrl["/assets/airlines/".Length..] is var file &&
            file.Length is > 4 and <= 100 &&
            file.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.') &&
            !file.Contains("..", StringComparison.Ordinal) &&
            (file.EndsWith(".svg", StringComparison.OrdinalIgnoreCase) ||
             file.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ||
             file.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))) &&
        (!IsVerified || Required(LegalName, 200) &&
            Url(VerificationSourceUrl, required: true));

    private static bool Required(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;

    private static bool Optional(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) || value.Trim().Length <= max;

    private static bool Code(string? value, int length, bool lettersOnly = false) =>
        string.IsNullOrWhiteSpace(value) || value.Length == length &&
        value.All(character => char.IsAsciiLetterUpper(character) ||
            !lettersOnly && char.IsAsciiDigit(character));

    private static bool Url(string? value, bool required = false) =>
        !required && string.IsNullOrWhiteSpace(value) ||
        value is { Length: <= 512 } && Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0;
}

public sealed record AirlineMutationResult(ManagedAirlineData? Airline,
    CatalogMutationFailure? Failure, string? Code = null)
{
    public static AirlineMutationResult Success(ManagedAirlineData airline) => new(airline, null);
    public static AirlineMutationResult Failed(CatalogMutationFailure failure, string? code = null) => new(null, failure, code);
}

public sealed record AirlineEnrichmentResult(int Changed, CatalogMutationFailure? Failure);

/// <summary>
/// What «Completar fichas AVIAM» may fill besides the public identity. <c>IncludeDevelopmentTaxRegistrations</c> copies
/// the FICTITIOUS demo RNCs of the Development reference to profiles without identifier; only Development and Test may
/// turn it on (<c>AirlineCatalogEnrichment:IncludeDevelopmentTaxRegistrations</c>), so they never reach Production.
/// </summary>
public sealed record AirlineCatalogEnrichmentSettings(bool IncludeDevelopmentTaxRegistrations)
{
    public static readonly AirlineCatalogEnrichmentSettings Default = new(false);
}

public interface ICommercialAirlineManagementStore
{
    Task<IReadOnlyList<ManagedAirlineData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    /// <summary>
    /// Creates (no id) or updates a profile. An update takes an optional Idempotency-Key (expand) and
    /// refuses to change the identity of an operating airline (<c>airline_identity_locked</c>).
    /// </summary>
    Task<AirlineMutationResult> SaveAsync(Guid actorId, Guid? profileId,
        ManagedAirlineInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);
    Task<AirlineMutationResult> ArchiveAsync(Guid actorId, Guid profileId,
        string version, CancellationToken cancellationToken = default);
    Task<AirlineEnrichmentResult> EnrichHistoricalCatalogAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    /// <summary>Name and codes to check; null with a failure for a non super administrator or an unknown airline.</summary>
    Task<(AirlineRegistryKey? Key, CatalogMutationFailure? Failure)> RegistryKeyAsync(Guid actorId, Guid profileId,
        CancellationToken cancellationToken = default);
    /// <summary>Stores the verdict unless the name or codes changed after the key was read (Conflict).</summary>
    Task<AirlineMutationResult> RecordRegistryCheckAsync(Guid actorId, AirlineRegistryKey key,
        AirlineRegistryCheck check, CancellationToken cancellationToken = default);
}
