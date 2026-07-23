using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Threading.RateLimiting;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.ExceptionHandling;
using Elevant.Api.OpenApi;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Extensions;

/// <summary>Composes services owned by the HTTP host.</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>Adds controllers, versioning, errors, CORS, SignalR and HTTP protections.</summary>
    public static IServiceCollection AddApiServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services
            .AddControllers()
            .AddJsonOptions(options =>
                options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

        services
            .AddApiVersioning(options =>
            {
                options.DefaultApiVersion = new ApiVersion(1, 0);
                options.ApiVersionReader = new UrlSegmentApiVersionReader();
                options.ReportApiVersions = true;
            })
            .AddMvc()
            .AddApiExplorer(options =>
            {
                options.GroupNameFormat = "'v'VVV";
                options.SubstituteApiVersionInUrl = true;
            });

        services.AddAuthorization();
        services.AddSignalR();
        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails(options =>
        {
            options.CustomizeProblemDetails = context =>
            {
                context.ProblemDetails.Extensions.TryAdd(
                    "traceId",
                    Activity.Current?.Id ?? context.HttpContext.TraceIdentifier);
            };
        });

        AddCors(services, configuration);
        AddRateLimiting(services, configuration);
        AddForwardedHeaders(services, configuration);
        services.AddElevantOpenApi();

        return services;
    }

    private static void AddCors(IServiceCollection services, IConfiguration configuration)
    {
        var allowedOrigins = configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>() ?? [];

        services.AddCors(options => options.AddPolicy(ApiConfiguration.CorsPolicy, policy =>
        {
            if (allowedOrigins.Length > 0)
            {
                policy
                    .WithOrigins(allowedOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials();
            }
        }));
    }

    private static void AddRateLimiting(IServiceCollection services, IConfiguration configuration)
    {
        var permitLimit = Math.Max(1, configuration.GetValue("RateLimiting:PermitLimit", 100));
        var windowSeconds = Math.Max(1, configuration.GetValue("RateLimiting:WindowSeconds", 60));

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(ApiConfiguration.ApiRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = permitLimit,
                        QueueLimit = 0,
                        Window = TimeSpan.FromSeconds(windowSeconds),
                    }));

            options.OnRejected = async (context, _) =>
            {
                context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                var problemDetailsService = context.HttpContext.RequestServices
                    .GetRequiredService<IProblemDetailsService>();

                await problemDetailsService.WriteAsync(new ProblemDetailsContext
                {
                    HttpContext = context.HttpContext,
                    ProblemDetails = new ProblemDetails
                    {
                        Status = StatusCodes.Status429TooManyRequests,
                        Title = "Too many requests.",
                        Type = "https://www.rfc-editor.org/rfc/rfc6585.html#section-4",
                        Instance = context.HttpContext.Request.Path,
                    },
                });
            };
        });
    }

    private static void AddForwardedHeaders(IServiceCollection services, IConfiguration configuration)
    {
        var enabled = configuration.GetValue("ForwardedHeaders:Enabled", false);
        var knownProxyValues = configuration
            .GetSection("ForwardedHeaders:KnownProxies")
            .Get<string[]>() ?? [];
        var knownNetworkValues = configuration
            .GetSection("ForwardedHeaders:KnownNetworks")
            .Get<string[]>() ?? [];

        if (enabled && knownProxyValues.Length == 0 && knownNetworkValues.Length == 0)
        {
            throw new InvalidOperationException(
                "Forwarded headers can be enabled only with an explicit known proxy or network.");
        }

        var knownProxies = knownProxyValues.Select(ParseIpAddress).ToArray();
        var knownNetworks = knownNetworkValues.Select(ParseIpNetwork).ToArray();

        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders =
                ForwardedHeaders.XForwardedFor |
                ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = Math.Max(1, configuration.GetValue("ForwardedHeaders:ForwardLimit", 1));
            options.RequireHeaderSymmetry = true;
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();

            foreach (var knownProxy in knownProxies)
            {
                options.KnownProxies.Add(knownProxy);
            }

            foreach (var knownNetwork in knownNetworks)
            {
                options.KnownIPNetworks.Add(knownNetwork);
            }
        });
    }

    private static IPAddress ParseIpAddress(string value) =>
        IPAddress.TryParse(value, out var address)
            ? address
            : throw new InvalidOperationException($"Invalid configured proxy address: '{value}'.");

    private static System.Net.IPNetwork ParseIpNetwork(string value) =>
        System.Net.IPNetwork.TryParse(value, out var network)
            ? network
            : throw new InvalidOperationException($"Invalid configured proxy network: '{value}'.");
}
