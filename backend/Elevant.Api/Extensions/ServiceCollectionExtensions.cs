using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Threading.RateLimiting;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.ExceptionHandling;
using Elevant.Api.HealthChecks;
using Elevant.Api.Hubs;
using Elevant.Api.Media;
using Elevant.Api.OpenApi;
using Elevant.Api.Realtime;
using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Primitives;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.SignalR;

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

        AddAuthentication(services, configuration);
        services.AddSingleton(_ => new AccountChangeCursorCodec(
            Convert.FromBase64String(configuration["Authentication:SigningKeyBase64"]!)));
        services.AddSignalR();
        services.AddSingleton<IUserIdProvider, AccountHubUserIdProvider>();
        services.AddSingleton<IAccountChangePush, SignalRAccountChangePush>();
        if (configuration.GetValue<bool>("Realtime:AccountChangeDispatcherEnabled"))
            services.AddHostedService<AccountChangeDispatchWorker>();
        services.AddHostedService<Elevant.Api.Messaging.EmailDispatchWorker>();
        services.AddHostedService<Elevant.Api.Commercial.ContractLifecycleWorker>();
        services.AddHostedService<Elevant.Api.HumanResources.HumanResourcesDocumentWorker>();
        services.AddHostedService<Elevant.Api.Integration.FlightFeedSyncWorker>();
        if (!string.IsNullOrWhiteSpace(configuration["MediaStorage:Endpoint"]))
            services.AddHostedService<CommercialMediaCleanupWorker>();
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
        services
            .AddHealthChecks()
            .AddCheck<DatabaseReadinessHealthCheck>(
                name: "database-target",
                failureStatus: Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Unhealthy,
                tags: ["ready"]);
        services.AddElevantOpenApi();

        return services;
    }

    private static void AddAuthentication(
        IServiceCollection services,
        IConfiguration configuration)
    {
        var settings = configuration
            .GetRequiredSection(JwtAccessTokenOptions.SectionName)
            .Get<JwtAccessTokenOptions>()
            ?? throw new InvalidOperationException("Authentication JWT settings are required.");

        if (!settings.IsValid() || !settings.TryGetSigningKey(out var signingKeyBytes))
        {
            throw new InvalidOperationException(
                "Authentication JWT settings must provide issuer, audience, a base64 signing key that decodes to 32-128 bytes, and a lifetime from 1 to 60 minutes.");
        }

        var signingKey = new SymmetricSecurityKey(signingKeyBytes);

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.IncludeErrorDetails = false;
                options.MapInboundClaims = false;
                options.SaveToken = false;
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var accessToken = context.Request.Query["access_token"];
                        var path = context.HttpContext.Request.Path;
                        if (!StringValues.IsNullOrEmpty(accessToken) &&
                            (path.StartsWithSegments("/hubs/operations") ||
                             path.StartsWithSegments("/hubs/notifications")))
                        {
                            context.Token = accessToken;
                        }

                        return Task.CompletedTask;
                    },
                    OnTokenValidated = async context =>
                    {
                        var subjectClaims = context.Principal?
                            .FindAll(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
                            .Select(claim => claim.Value)
                            .ToArray() ?? [];
                        var tokenIdClaims = context.Principal?
                            .FindAll(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Jti)
                            .Select(claim => claim.Value)
                            .ToArray() ?? [];
                        var versionClaims = context.Principal?
                            .FindAll(SessionSecurityVersion.ClaimType)
                            .Select(claim => claim.Value)
                            .ToArray() ?? [];

                        if (subjectClaims.Length != 1 ||
                            !Guid.TryParse(subjectClaims[0], out var subject) ||
                            subject == Guid.Empty ||
                            tokenIdClaims.Length != 1 ||
                            !Guid.TryParse(tokenIdClaims[0], out var tokenId) ||
                            tokenId == Guid.Empty ||
                            versionClaims.Length != 1)
                        {
                            context.Fail("The access token identity is invalid.");
                            return;
                        }

                        var store = context.HttpContext.RequestServices
                            .GetRequiredService<ISessionSecurityVersionStore>();
                        var currentStamp = await store.GetCurrentAsync(
                            subject, context.HttpContext.RequestAborted);
                        if (string.IsNullOrWhiteSpace(currentStamp) ||
                            !SessionSecurityVersion.Matches(versionClaims[0], currentStamp))
                        {
                            context.Fail("The access token credential version is invalid.");
                        }
                    },
                    OnChallenge = context =>
                    {
                        context.Response.Headers.CacheControl = "no-store";
                        context.Response.Headers.Pragma = "no-cache";
                        return Task.CompletedTask;
                    },
                    OnForbidden = context =>
                    {
                        context.Response.Headers.CacheControl = "no-store";
                        context.Response.Headers.Pragma = "no-cache";
                        return Task.CompletedTask;
                    },
                };
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ClockSkew = TimeSpan.FromSeconds(30),
                    IssuerSigningKey = signingKey,
                    RequireExpirationTime = true,
                    RequireSignedTokens = true,
                    ValidateAudience = true,
                    ValidateIssuer = true,
                    ValidateIssuerSigningKey = true,
                    ValidateLifetime = true,
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    ValidAudience = settings.Audience,
                    ValidIssuer = settings.Issuer,
                    ValidTypes = ["at+jwt"],
                };
            });

        services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build();
        });
    }

    private static void AddCors(IServiceCollection services, IConfiguration configuration)
    {
        var allowedOrigins = configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>() ?? [];

        allowedOrigins = allowedOrigins
            .Where(origin => !string.IsNullOrWhiteSpace(origin))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        services.AddCors(options => options.AddPolicy(ApiConfiguration.CorsPolicy, policy =>
        {
            if (allowedOrigins.Length > 0)
            {
                policy
                    .WithOrigins(allowedOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .WithExposedHeaders("ETag")
                    .AllowCredentials();
            }
        }));
    }

    private static void AddRateLimiting(IServiceCollection services, IConfiguration configuration)
    {
        var permitLimit = Math.Max(1, configuration.GetValue("RateLimiting:PermitLimit", 100));
        var sessionPermitLimit = Math.Max(
            1,
            configuration.GetValue("RateLimiting:SessionPermitLimit", 10));
        var windowSeconds = Math.Max(1, configuration.GetValue("RateLimiting:WindowSeconds", 60));

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(ApiConfiguration.ApiRateLimitPolicy, httpContext =>
            {
                var isSessionCreation = httpContext.GetEndpoint()?.Metadata
                    .GetMetadata<SessionCreationRateLimitAttribute>() is not null;
                var clientAddress = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: $"{(isSessionCreation ? "session" : "api")}:{clientAddress}",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = isSessionCreation ? sessionPermitLimit : permitLimit,
                        QueueLimit = 0,
                        Window = TimeSpan.FromSeconds(windowSeconds),
                    });
            });

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
