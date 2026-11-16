namespace Elevant.Application.Abstractions.Commercial;

public sealed record PublicServiceData(Guid Id, string Name, string Description,
    string? ImageUrl, string? VideoUrl, int DisplayOrder);

/// <param name="RegistrySource">
/// Public registry that confirmed the airline (ADR-0023). Omitted when null so clients released
/// before this field, which reject unknown keys, keep reading the catalog (expand phase).
/// </param>
/// <param name="TaxRegistration">
/// The airline's tax identifier recorded by Superadministración (an RNC as its 9 digits) with
/// <paramref name="TaxRegistrationCountryCode"/>; the public request prefills it. Omitted when null (expand phase).
/// </param>
public sealed record PublicAirlineData(Guid Id, string Name, string Region,
    string? LegalName, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, bool IsVerified,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    string? RegistrySource = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    string? TaxRegistration = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    string? TaxRegistrationCountryCode = null);

public sealed record PublicCommercialCatalog(
    IReadOnlyList<PublicServiceData> Services,
    IReadOnlyList<PublicAirlineData> Airlines);

public interface ICommercialCatalogStore
{
    Task<PublicCommercialCatalog> GetPublicAsync(CancellationToken cancellationToken = default);
}
