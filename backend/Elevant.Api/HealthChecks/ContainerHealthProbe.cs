using System.Net;

namespace Elevant.Api.HealthChecks;

/// <summary>Provides the dependency-free command used by the container healthcheck.</summary>
public static class ContainerHealthProbe
{
    private const string HealthArgument = "--health-probe";
    private const string SmokeArgument = "--smoke-probe";
    private static readonly Uri ReadinessEndpoint = new("http://127.0.0.1:8080/health/ready");
    private static readonly Uri[] SmokeEndpoints =
    [
        new("http://127.0.0.1:8080/health"),
        ReadinessEndpoint,
        new("http://127.0.0.1:8080/api/v1/system/ping"),
        new("http://127.0.0.1:8080/swagger/v1/swagger.json"),
    ];

    /// <summary>Returns true only for the dedicated container probe invocation.</summary>
    public static bool IsRequested(IReadOnlyList<string> arguments) =>
        arguments.Count == 1 && string.Equals(arguments[0], HealthArgument, StringComparison.Ordinal);

    /// <summary>Returns true only for the controller's in-container smoke invocation.</summary>
    public static bool IsSmokeRequested(IReadOnlyList<string> arguments) =>
        arguments.Count == 1 && string.Equals(arguments[0], SmokeArgument, StringComparison.Ordinal);

    /// <summary>Queries the local readiness endpoint and converts its status into a process exit code.</summary>
    public static async Task<int> RunAsync(CancellationToken cancellationToken = default)
    {
        using var handler = new SocketsHttpHandler
        {
            UseProxy = false,
        };

        return await RunEndpointsAsync(handler, [ReadinessEndpoint], cancellationToken);
    }

    internal static async Task<int> RunAsync(
        HttpMessageHandler handler,
        CancellationToken cancellationToken = default) =>
        await RunEndpointsAsync(handler, [ReadinessEndpoint], cancellationToken);

    /// <summary>Checks every private rollout endpoint from the API network namespace.</summary>
    public static async Task<int> RunSmokeAsync(CancellationToken cancellationToken = default)
    {
        using var handler = new SocketsHttpHandler
        {
            UseProxy = false,
        };

        return await RunEndpointsAsync(handler, SmokeEndpoints, cancellationToken);
    }

    internal static async Task<int> RunSmokeAsync(
        HttpMessageHandler handler,
        CancellationToken cancellationToken = default) =>
        await RunEndpointsAsync(handler, SmokeEndpoints, cancellationToken);

    private static async Task<int> RunEndpointsAsync(
        HttpMessageHandler handler,
        IReadOnlyList<Uri> endpoints,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(handler);

        using var client = new HttpClient(handler, disposeHandler: false)
        {
            Timeout = TimeSpan.FromSeconds(4),
        };

        try
        {
            foreach (var endpoint in endpoints)
            {
                using var response = await client.GetAsync(endpoint, cancellationToken);
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    return 1;
                }
            }

            return 0;
        }
        catch (Exception exception) when (
            exception is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            return 1;
        }
    }
}
