using Elevant.Api.Configuration;
using Elevant.Api.HealthChecks;
using Elevant.Api.Hubs;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Extensions;

/// <summary>Composes the HTTP middleware and endpoint pipeline.</summary>
public static class ApplicationBuilderExtensions
{
    /// <summary>Builds the API pipeline with environment-safe diagnostics.</summary>
    public static WebApplication UseApiPipeline(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        if (app.Configuration.GetValue("ForwardedHeaders:Enabled", false))
        {
            app.UseForwardedHeaders();
        }

        app.UseExceptionHandler();
        app.UseStatusCodePages(async context =>
        {
            var problemDetailsService = context.HttpContext.RequestServices
                .GetRequiredService<IProblemDetailsService>();

            await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = context.HttpContext,
                ProblemDetails = new ProblemDetails
                {
                    Status = context.HttpContext.Response.StatusCode,
                    Title = "The HTTP request could not be completed.",
                    Instance = context.HttpContext.Request.Path,
                },
            });
        });

        if (app.Configuration.GetValue("HttpsRedirection:Enabled", false))
        {
            app.UseHttpsRedirection();
        }

        var exposeSwagger = app.Environment.IsDevelopment() ||
            (app.Environment.IsEnvironment("Testing") &&
             app.Configuration.GetValue("Swagger:Enabled", false));

        if (exposeSwagger && !app.Environment.IsProduction())
        {
            app.UseSwagger();
            app.UseSwaggerUI(options =>
                options.SwaggerEndpoint("/swagger/v1/swagger.json", "Elevant API v1"));
        }

        app.UseRouting();
        app.UseCors(ApiConfiguration.CorsPolicy);
        app.UseRateLimiter();
        app.UseAuthorization();

        app.MapControllers()
            .RequireRateLimiting(ApiConfiguration.ApiRateLimitPolicy);

        app.MapHealthChecks("/health", new HealthCheckOptions
        {
            Predicate = _ => false,
            ResponseWriter = HealthCheckResponseWriter.WriteAsync,
        });

        app.MapHealthChecks("/health/ready", new HealthCheckOptions
        {
            Predicate = registration => registration.Tags.Contains("ready"),
            ResponseWriter = HealthCheckResponseWriter.WriteAsync,
        });

        app.MapHub<OperationsHub>("/hubs/operations");
        app.MapHub<NotificationsHub>("/hubs/notifications");

        return app;
    }
}
