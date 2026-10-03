namespace Elevant.Application.Finance;

/// <summary>A published private document is missing, altered or temporarily inaccessible.</summary>
public sealed class FinancialDocumentUnavailableException : Exception
{
    public FinancialDocumentUnavailableException() : base("Financial document is unavailable.") { }

    public FinancialDocumentUnavailableException(Exception innerException)
        : base("Financial document is unavailable.", innerException) { }
}
