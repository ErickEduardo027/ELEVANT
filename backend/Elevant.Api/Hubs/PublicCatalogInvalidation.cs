using Microsoft.Extensions.Logging;

namespace Elevant.Api.Hubs;

/// <summary>
/// A catalog mutation is already committed before this best-effort push runs.
/// Clients also re-read the catalog over HTTP on a bounded polling interval.
/// </summary>
public static class PublicCatalogInvalidation
{
    private static readonly Action<ILogger, Exception?> LogFailedPush =
        LoggerMessage.Define(LogLevel.Warning, new EventId(1401, "PublicCatalogInvalidationFailed"),
            "Commercial catalog change was committed, but live invalidation failed; clients will refresh over HTTP.");

    public static async Task TrySendAsync(Func<CancellationToken, Task> send,
        ILogger logger)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await send(timeout.Token);
        }
        catch (Exception exception)
        {
            LogFailedPush(logger, exception);
        }
    }
}
