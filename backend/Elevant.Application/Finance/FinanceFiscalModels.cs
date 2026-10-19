using Elevant.Domain.Enumerations;
namespace Elevant.Application.Finance;

public sealed class FinanceFiscalOptions
{
    public FiscalMode Mode { get; init; } = FiscalMode.Off;
    public string Environment { get; init; } = "Development";
}
public enum FinanceFiscalFailure { Invalid, Forbidden, NotFound, Conflict, Disabled, ProviderNotConfigured, ArchiveUnavailable }
public sealed record FiscalCreateInput(Guid RequestId, Guid InvoiceId, FiscalSimulationOutcome Outcome);
public sealed record FiscalSimulateInput(Guid RequestId, string ExpectedVersion);
public sealed record FiscalCallbackInput(string Credential, byte[] OriginalBytes);
public sealed record FiscalResult(Guid? DocumentId, string? Version, bool Replayed, FinanceFiscalFailure? Failure)
{
    public bool IsSuccess => Failure is null;
    public static FiscalResult Failed(FinanceFiscalFailure failure) => new(null, null, false, failure);
}
public sealed record FiscalSnapshotLine(int LineNumber, string Kind, int? ParentLineNumber, string? Reason,
    string OperationCode, DateOnly OperationDate, string ServiceCode, string ServiceName, decimal Quantity,
    string BillingUnit, decimal UnitPrice, string CurrencyCode, decimal Amount,
    decimal? Net = null, decimal? Discount = null, decimal? Tax = null, decimal? Gross = null,
    string? Treatment = null, decimal? Rate = null, string? Basis = null, Guid? PolicyId = null,
    DateTimeOffset? CapturedAt = null);
public sealed record FiscalArtifactData(Guid Id, string Kind, string FileName, string ContentType, string Sha256, long Length);
public sealed record FiscalEventData(Guid Id, string Kind, string State, long? ProviderSequence, bool Applied, string Detail, DateTimeOffset OccurredAt);
public sealed record FiscalDocumentData(Guid Id, Guid InvoiceId, Guid StationId, string Mode, string Environment,
    string State, string ArtifactCompletion, string SnapshotHash, string CanonicalSnapshot, decimal Total,
    string CurrencyCode, string? ProviderDocumentId, string? DgiiResponseId, string? Encf, string Version,
    DateTimeOffset CreatedAt, IReadOnlyList<FiscalArtifactData> Artifacts, IReadOnlyList<FiscalEventData> History);
public sealed record FiscalDownload(byte[] Bytes, string FileName, string ContentType, string Sha256);
public sealed record FiscalArchiveItem(FiscalArtifactKind Kind, string FileName, string ContentType, byte[] Bytes);
public sealed record FiscalProviderRequest(Guid DocumentId, string Environment, FiscalSimulationOutcome Outcome, byte[] OriginalBytes);
public sealed record FiscalProviderReply(FiscalState State, string? ProviderDocumentId, string? DgiiResponseId,
    string? Encf, long Sequence, byte[] OriginalBytes);
public sealed record FiscalAuthenticatedCallback(Guid DocumentId, string Environment, Guid EventId, long Sequence,
    FiscalState State, string? ProviderDocumentId, string? DgiiResponseId, string? Encf);
