using Elevant.Application.Finance;

namespace Elevant.Api.Configuration;

/// <summary>Logs only safe failure categories, never private object keys or provider messages.</summary>
internal static class FinancialDocumentDiagnosticLog
{
    private static readonly Action<ILogger, FinancialDocumentFailureStage, string, Exception?>
        LogUnavailable = LoggerMessage.Define<FinancialDocumentFailureStage, string>(
            LogLevel.Warning, new EventId(1801, "FinancialDocumentUnavailable"),
            "Financial document unavailable: stage={Stage}, cause={Cause}");

    internal static void Unavailable(ILogger logger,
        FinancialDocumentUnavailableException exception) =>
        LogUnavailable(logger, exception.Stage,
            exception.InnerException?.GetType().Name ?? "none", null);
}
