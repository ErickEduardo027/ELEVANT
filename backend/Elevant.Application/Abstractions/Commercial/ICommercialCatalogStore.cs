namespace Elevant.Application.Abstractions.Commercial;

public sealed record PublicServiceData(Guid Id, string Name, string Description,
    string? ImageUrl, string? VideoUrl, int DisplayOrder);

public sealed record PublicAirlineData(Guid Id, string Name, string Region,
    string? LegalName, string? CountryCode, string? IataCode, string? IcaoCode,
    string? LogoUrl, bool IsVerified);

public sealed record PublicCommercialCatalog(
    IReadOnlyList<PublicServiceData> Services,
    IReadOnlyList<PublicAirlineData> Airlines);

public interface ICommercialCatalogStore
{
    Task<PublicCommercialCatalog> GetPublicAsync(CancellationToken cancellationToken = default);
}
