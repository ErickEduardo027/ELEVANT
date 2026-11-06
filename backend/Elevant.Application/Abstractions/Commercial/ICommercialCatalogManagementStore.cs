namespace Elevant.Application.Abstractions.Commercial;

public sealed record ManagedServiceData(Guid Id, string Code, string Name,
    string Description, string BillingUnit, string? ImageUrl, string? VideoUrl,
    int DisplayOrder, bool IsPublic, bool IsActive, string Version);

public sealed record ManagedServiceInput(string Code, string Name, string Description,
    string BillingUnit, string? ImageUrl, string? VideoUrl,
    int DisplayOrder, bool IsPublic, bool IsActive, string? Version);

/// <summary>«Dar de baja»: the reason and the service version on screen (1-N03).</summary>
public sealed record RetireServiceInput(string? ExpectedVersion, string? Reason);

public enum CatalogMutationFailure { Forbidden, Invalid, NotFound, Conflict }

public sealed record CatalogMutationResult(ManagedServiceData? Service,
    CatalogMutationFailure? Failure, string? Code = null)
{
    public static CatalogMutationResult Success(ManagedServiceData service) => new(service, null);

    /// <param name="code">Machine-readable reason sent to the client as the Problem Details "code".</param>
    public static CatalogMutationResult Failed(CatalogMutationFailure failure, string? code = null) =>
        new(null, failure, code);
}

/// <summary>
/// Contratos' catalog of services. An update with an Idempotency-Key replays its first result; the form
/// hides or reactivates a service but never retires it: «Dar de baja» is <see cref="RetireAsync"/>, refused
/// while a contract in force or in approval uses the service (1-N03).
/// </summary>
public interface ICommercialCatalogManagementStore
{
    Task<IReadOnlyList<ManagedServiceData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default);

    /// <summary>Creates (no <paramref name="serviceId"/>, no key) or updates a service.</summary>
    Task<CatalogMutationResult> SaveAsync(Guid actorId, Guid? serviceId,
        ManagedServiceInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Retires the service with a reason; the Idempotency-Key and the version are required.</summary>
    Task<CatalogMutationResult> RetireAsync(Guid actorId, Guid serviceId, Guid idempotencyKey,
        RetireServiceInput input, CancellationToken cancellationToken = default);

    /// <summary>Deprecated alias of <see cref="RetireAsync"/> without a reason; the same checks apply.</summary>
    Task<CatalogMutationResult> DeleteAsync(Guid actorId, Guid serviceId,
        string? version, Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
