using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Microsoft.Extensions.Logging;

namespace Elevant.IntegrationTests.Api;

public sealed class FinancialDocumentDiagnosticLogTests
{
    [Fact]
    public void LogsStageAndExceptionTypeWithoutProviderMessageOrObjectKey()
    {
        var logger = new RecordingLogger();
        var failure = new FinancialDocumentUnavailableException(
            FinancialDocumentFailureStage.StorageWrite,
            new InvalidOperationException("private-object-key-and-secret-must-not-appear"));

        FinancialDocumentDiagnosticLog.Unavailable(logger, failure);

        Assert.Equal(LogLevel.Warning, logger.Level);
        Assert.Contains("StorageWrite", logger.Message, StringComparison.Ordinal);
        Assert.Contains("InvalidOperationException", logger.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("private-object-key-and-secret-must-not-appear",
            logger.Message, StringComparison.Ordinal);
        Assert.Null(logger.Exception);
    }

    private sealed class RecordingLogger : ILogger
    {
        public LogLevel Level { get; private set; }
        public string Message { get; private set; } = string.Empty;
        public Exception? Exception { get; private set; }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Level = logLevel;
            Message = formatter(state, exception);
            Exception = exception;
        }
    }
}
