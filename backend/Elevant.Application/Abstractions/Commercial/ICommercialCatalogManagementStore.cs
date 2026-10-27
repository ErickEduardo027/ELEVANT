namespace Elevant.Application.Abstractions.Commercial;

public sealed record ManagedServiceData(Guid Id, string Code, string Name,
    string Description, string BillingUnit, string? ImageUrl, string? VideoUrl,
    int DisplayOrder, bool IsPublic, bool IsActive, string Version);

public sealed record ManagedServiceInput(string Code, string Name, string Description,
    string BillingUnit, string? ImageUrl, string? VideoUrl,
    int DisplayOrder, bool IsPublic, bool IsActive, string? Version);

public enum CatalogMutationFailure { Forbidden, Invalid, NotFound, Conflict }

public sealed record CatalogMutationResult(ManagedServiceData? Service,
    CatalogMutationFailure? Failure, string? Code = null)
{
    public static CatalogMutationResult Success(ManagedServiceData service) => new(service, null);

    /// <param name="code">Machine-readable reason sent to the client as the Problem Details "code".</param>
    public static CatalogMutationResult Failed(CatalogMutationFailure failure, string? code = null) =>
        new(null, failure, code);
}

public interface ICommercialCatalogManagementStore
{
    Task<IReadOnlyList<ManagedServiceData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<CatalogMutationResult> SaveAsync(Guid actorId, Guid? serviceId,
        ManagedServiceInput input, CancellationToken cancellationToken = default);
    Task<CatalogMutationResult> DeleteAsync(Guid actorId, Guid serviceId,
        string version, CancellationToken cancellationToken = default);
}
