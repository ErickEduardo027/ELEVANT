namespace Elevant.Contracts.Finance;

public sealed record FinanceFiscalCreateRequest(Guid RequestId, Guid InvoiceId, string Outcome);
public sealed record FinanceFiscalSimulateRequest(Guid RequestId, string ExpectedVersion);
public sealed record FinanceFiscalMutationResponse(Guid? DocumentId, string? Version, bool Replayed, string? Failure);
public sealed record FinanceFiscalArtifactResponse(Guid Id, string Kind, string FileName, string ContentType, string Sha256, long Length);
public sealed record FinanceFiscalEventResponse(Guid Id, string Kind, string State, long? ProviderSequence, bool Applied, string Detail, DateTimeOffset OccurredAt);
public sealed record FinanceFiscalDocumentResponse(Guid Id, Guid InvoiceId, Guid StationId, string Mode, string Environment,
    string State, string ArtifactCompletion, string SnapshotHash, string CanonicalSnapshot, decimal Total, string CurrencyCode,
    string? ProviderDocumentId, string? DgiiResponseId, string? Encf, string Version, DateTimeOffset CreatedAt,
    IReadOnlyList<FinanceFiscalArtifactResponse> Artifacts, IReadOnlyList<FinanceFiscalEventResponse> History,
    string Disclaimer, string OfficialXsdValidation, bool Signed, bool OfficialQr);
public sealed record FinanceFiscalStatusResponse(string Mode, string Environment, bool CanSimulate, string Disclaimer,
    string OfficialXsdValidation, string ProviderStatus);
