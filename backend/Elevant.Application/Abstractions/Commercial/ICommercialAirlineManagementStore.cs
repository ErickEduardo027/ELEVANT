namespace Elevant.Application.Abstractions.Commercial;

/// <param name="RegistryStatus">Last public-registry check (ADR-0023): Found, Mismatch, Defunct or NotFound; null when never checked or stale.</param>
public sealed record ManagedAirlineData(
    Guid Id, string SourceName, string DisplayName, string? LegalName,
    string Region, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, string SourceUrl, string? VerificationSourceUrl,
    bool IsVerified, bool IsPublished, string Version,
    string? RegistryStatus = null, string? RegistrySource = null, DateTimeOffset? RegistryCheckedAt = null,
    string? RegistryEntityUrl = null);

/// <summary>What a registry check is about; the record step refuses it if these changed meanwhile.</summary>
public sealed record AirlineRegistryKey(Guid Id, string Name, string? IataCode, string? IcaoCode);

/// <summary>The stored airline after a registry check, with the full verdict for the screen.</summary>
public sealed record AirlineRegistryCheckResult(ManagedAirlineData Airline, AirlineRegistryCheck Check);

public sealed record ManagedAirlineInput(
    string SourceName, string DisplayName, string? LegalName,
    string Region, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, string SourceUrl, string? VerificationSourceUrl,
    bool IsVerified, bool IsPublished, string? Version)
{
    public bool IsValid() =>
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

public interface ICommercialAirlineManagementStore
{
    Task<IReadOnlyList<ManagedAirlineData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<AirlineMutationResult> SaveAsync(Guid actorId, Guid? profileId,
        ManagedAirlineInput input, CancellationToken cancellationToken = default);
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
