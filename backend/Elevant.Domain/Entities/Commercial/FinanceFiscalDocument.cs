using Elevant.Domain.Enumerations;
namespace Elevant.Domain.Entities.Commercial;

/// <summary>Independent fiscal sidecar; never changes invoice, ledger or collection state.</summary>
public sealed class FinanceFiscalDocument : AuditableEntity
{
    private FinanceFiscalDocument() { }
    public long InvoiceId { get; private set; }
    public long CreatedByAccountId { get; private set; }
    public Guid RequestId { get; private set; }
    public string RequestHash { get; private set; } = string.Empty;
    public FiscalMode Mode { get; private set; }
    public string Environment { get; private set; } = string.Empty;
    public FiscalSimulationOutcome Outcome { get; private set; }
    public string CanonicalSnapshot { get; private set; } = string.Empty;
    public string SnapshotHash { get; private set; } = string.Empty;
    public string CurrencyCode { get; private set; } = string.Empty;
    public decimal Total { get; private set; }
    public FiscalState State { get; set; } = FiscalState.AwaitingArchive;
    public FiscalArtifactCompletion ArtifactCompletion { get; set; }
    public string? ProviderDocumentId { get; set; }
    public string? DgiiResponseId { get; set; }
    public string? Encf { get; set; }
    public long LastProviderSequence { get; set; }
    public static FinanceFiscalDocument Create(long invoice, long actor, Guid request, string requestHash,
        FiscalMode mode, string environment, FiscalSimulationOutcome outcome, string snapshot, string snapshotHash,
        string currency, decimal total, DateTimeOffset now) => new()
    {
        PublicId = Guid.CreateVersion7(), InvoiceId = invoice, CreatedByAccountId = actor, RequestId = request,
        RequestHash = requestHash, Mode = mode, Environment = environment, Outcome = outcome,
        CanonicalSnapshot = snapshot, SnapshotHash = snapshotHash, CurrencyCode = currency, Total = total,
        CreatedAt = now, UpdatedAt = now,
    };
}

/// <summary>Durable one-dispatch intent; Dispatching is never automatically retried.</summary>
public sealed class FinanceFiscalIntent : AuditableEntity
{
    public long DocumentId { get; set; }
    public FiscalIntentStatus Status { get; set; }
    public Guid? DispatchRequestId { get; set; }
    public string? DispatchRequestHash { get; set; }
    public long? DispatchedByAccountId { get; set; }
    public DateTimeOffset? DispatchedAt { get; set; }
    public int DispatchCount { get; set; }
}

public sealed class FinanceFiscalArtifact : AuditableEntity
{
    public long DocumentId { get; set; }
    public FiscalArtifactKind Kind { get; set; }
    public string ObjectKey { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string Sha256 { get; set; } = string.Empty;
    public long Length { get; set; }
}

/// <summary>Append-only history and callback inbox. EventId is unique within the document.</summary>
public sealed class FinanceFiscalEvent : AuditableEntity
{
    public long DocumentId { get; set; }
    public Guid EventId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string PayloadHash { get; set; } = string.Empty;
    public long? ProviderSequence { get; set; }
    public FiscalState State { get; set; }
    public bool Applied { get; set; }
    public string Detail { get; set; } = string.Empty;
}
