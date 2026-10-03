namespace Elevant.Application.Finance;

/// <summary>Stable, non-sensitive stage for operational diagnostics.</summary>
public enum FinancialDocumentFailureStage
{
    Unknown,
    SourceValidation,
    RenderedContent,
    StorageConfiguration,
    StorageWrite,
    StorageRead,
    StorageDelete,
    MetadataConflict,
    StoredContent,
}

/// <summary>A published private document is missing, altered or temporarily inaccessible.</summary>
public sealed class FinancialDocumentUnavailableException : Exception
{
    public FinancialDocumentFailureStage Stage { get; }

    public FinancialDocumentUnavailableException()
        : this(FinancialDocumentFailureStage.Unknown) { }

    public FinancialDocumentUnavailableException(Exception innerException)
        : this(FinancialDocumentFailureStage.Unknown, innerException) { }

    public FinancialDocumentUnavailableException(FinancialDocumentFailureStage stage,
        Exception? innerException = null)
        : base("Financial document is unavailable.", innerException) => Stage = stage;
}
