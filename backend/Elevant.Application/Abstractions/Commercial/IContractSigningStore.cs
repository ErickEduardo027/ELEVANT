namespace Elevant.Application.Abstractions.Commercial;

public enum ContractSigningFailure
{
    Forbidden, NotFound, Conflict, Invalid, Unavailable, Corrupt
}

public sealed record ContractSigningSummary(Guid ContractId, Guid VersionId,
    string ContractCode, string AirlineName, string VersionStatus,
    string SigningStatus, bool RequiresElectronicSigning,
    Guid? AviamSignerAccountId, string? AviamSignerEmail,
    Guid? AirlineSignerAccountId, string? AirlineSignerEmail,
    DateTimeOffset? IssuedAt, DateTimeOffset? FormalizedAt,
    string? DraftSha256, string? SignedSha256, string? AuditSha256,
    DateTimeOffset? LastCheckedAt, DateTimeOffset? NextCheckAt,
    string? SigningMethod = null, DateTimeOffset? AviamAcceptedAt = null,
    DateTimeOffset? AirlineAcceptedAt = null);

public sealed record ContractSigningResult<T>(T? Value,
    ContractSigningFailure? Failure)
{
    public bool IsSuccess => Failure is null && Value is not null;
    public static ContractSigningResult<T> Success(T value) => new(value, null);
    public static ContractSigningResult<T> Failed(ContractSigningFailure failure) =>
        new(default, failure);
}

public sealed record ContractSignerOption(Guid AccountId, string Name, string Email);

public interface IContractSigningStore
{
    Task<ContractSigningResult<IReadOnlyList<ContractSigningSummary>>> ListManagedAsync(
        Guid actorId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<IReadOnlyList<ContractSignerOption>>> ListAviamSignersAsync(
        Guid actorId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<ContractSigningSummary>> SetSignersAsync(Guid actorId,
        Guid versionId, Guid aviamSignerAccountId,
        CancellationToken cancellationToken = default);
    Task<ContractSigningResult<ContractSigningSummary>> GetManagedAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<byte[]>> PreviewAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<ContractSigningSummary>> IssueAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<byte[]>> GetManagedDraftAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<byte[]>> GetAirlineDraftAsync(Guid actorId,
        Guid contractId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<ContractSigningSummary>> AcceptAviamAsync(Guid actorId,
        Guid versionId, Guid requestId, string expectedDraftSha256,
        CancellationToken cancellationToken = default);
    Task<ContractSigningResult<ContractSigningSummary>> AcceptAirlineAsync(Guid actorId,
        Guid contractId, Guid requestId, string expectedDraftSha256,
        CancellationToken cancellationToken = default);
    Task<ContractSigningResult<ContractSigningSummary>> GetAirlineAsync(Guid actorId,
        Guid contractId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<Uri>> GetAirlineSigningUrlAsync(Guid actorId,
        Guid contractId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<byte[]>> GetFinalPdfAsync(Guid actorId,
        Guid contractId, CancellationToken cancellationToken = default);
    Task<ContractSigningResult<byte[]>> GetManagedEvidenceAsync(Guid actorId,
        Guid versionId, bool audit, CancellationToken cancellationToken = default);
    Task ReconcileDueAsync(CancellationToken cancellationToken = default);
}
