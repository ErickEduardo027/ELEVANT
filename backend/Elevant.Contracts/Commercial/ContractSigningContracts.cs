namespace Elevant.Contracts.Commercial;

public sealed record SetContractSignersRequest(Guid AviamSignerAccountId);
public sealed record ContractSignerOptionResponse(Guid AccountId, string Name, string Email);

public sealed record ContractSigningResponse(Guid ContractId, Guid VersionId,
    string ContractCode, string AirlineName, string VersionStatus,
    string SigningStatus, bool RequiresElectronicSigning,
    Guid? AviamSignerAccountId, string? AviamSignerEmail,
    Guid? AirlineSignerAccountId, string? AirlineSignerEmail,
    DateTimeOffset? IssuedAt, DateTimeOffset? FormalizedAt,
    string? DraftSha256, string? SignedSha256, string? AuditSha256,
    DateTimeOffset? LastCheckedAt, DateTimeOffset? NextCheckAt,
    string? SigningMethod = null, DateTimeOffset? AviamAcceptedAt = null,
    DateTimeOffset? AirlineAcceptedAt = null);

public sealed record AcceptContractRequest(Guid RequestId, string ExpectedDraftSha256);

public sealed record ContractSigningLinkResponse(Uri Url);
