namespace Elevant.Application.Abstractions.Commercial;

public sealed record ManagedAirlineData(
    Guid Id, string SourceName, string DisplayName, string? LegalName,
    string Region, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, string SourceUrl, string? VerificationSourceUrl,
    bool IsVerified, bool IsPublished, string Version);

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
    CatalogMutationFailure? Failure)
{
    public static AirlineMutationResult Success(ManagedAirlineData airline) => new(airline, null);
    public static AirlineMutationResult Failed(CatalogMutationFailure failure) => new(null, failure);
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
}
