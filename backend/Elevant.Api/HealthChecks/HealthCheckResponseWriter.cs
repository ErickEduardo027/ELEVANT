using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Elevant.Api.HealthChecks;

/// <summary>Writes a small health response without configuration or exception details.</summary>
public static class HealthCheckResponseWriter
{
    /// <summary>Serializes the aggregate status and individual check states.</summary>
    public static Task WriteAsync(HttpContext httpContext, HealthReport report)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(report);

        httpContext.Response.ContentType = "application/json; charset=utf-8";

        var response = new
        {
            status = report.Status.ToString().ToLowerInvariant(),
            checks = report.Entries
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .Select(entry => new
                {
                    name = entry.Key,
                    status = entry.Value.Status.ToString().ToLowerInvariant(),
                }),
        };

        return httpContext.Response.WriteAsJsonAsync(response);
    }
}
