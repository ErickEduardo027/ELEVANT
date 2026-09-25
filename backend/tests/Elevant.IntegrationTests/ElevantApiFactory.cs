using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.IntegrationTests;

public sealed class ElevantApiFactory : WebApplicationFactory<Program>
{
    internal const string PrivateWebOrigin = "https://private-web.elevant.test";
    internal const string PublicWebOrigin = "https://public-web.elevant.test";
    internal const string AuthenticationIssuer = "Elevant.IntegrationTests";
    internal const string AuthenticationAudience = "Elevant.IntegrationTests.Clients";
    internal const string AuthenticationSigningKeyBase64 =
        "RUxFVkFOVCBzeW50aGV0aWMgc2lnbmluZyBtYXRlcmlhbCBmb3IgdGVzdHMgb25seSAyMDI2LTA5LTE2";
    internal const string TestSecurityStamp = "integration-test-security-stamp";

    private const string TestConnectionString =
        "Server=127.0.0.1,65535;Database=ElevantIntegrationTests;Integrated Security=true;Encrypt=true;TrustServerCertificate=true;Connect Timeout=1";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ISessionSecurityVersionStore>();
            services.AddScoped<ISessionSecurityVersionStore, TestSecurityVersionStore>();
        });
        // Test hosts must not write to Windows Event Log, which is unavailable to
        // unprivileged runners and can hide the actual HTTP assertion failure.
        builder.ConfigureLogging(logging => logging.ClearProviders());
        builder.UseSetting("ConnectionStrings:ElevantDatabase", TestConnectionString);
        builder.UseSetting("Authentication:Issuer", AuthenticationIssuer);
        builder.UseSetting("Authentication:Audience", AuthenticationAudience);
        builder.UseSetting("Authentication:SigningKeyBase64", AuthenticationSigningKeyBase64);
        builder.UseSetting("Authentication:AccessTokenMinutes", "15");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = TestConnectionString,
                ["Authentication:Issuer"] = AuthenticationIssuer,
                ["Authentication:Audience"] = AuthenticationAudience,
                ["Authentication:SigningKeyBase64"] = AuthenticationSigningKeyBase64,
                ["Authentication:AccessTokenMinutes"] = "15",
                ["RateLimiting:SessionPermitLimit"] = "100",
                ["Cors:AllowedOrigins:0"] = PrivateWebOrigin,
                ["Cors:AllowedOrigins:1"] = PublicWebOrigin,
                ["ELEVANT_DATABASE_ENVIRONMENT"] = "Development",
                ["ForwardedHeaders:Enabled"] = "false",
                ["HttpsRedirection:Enabled"] = "false",
                ["Swagger:Enabled"] = "true",
            });
        });
    }

    private sealed class TestSecurityVersionStore : ISessionSecurityVersionStore
    {
        public Task<string?> GetCurrentAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(accountId == Guid.Empty ? null : TestSecurityStamp);
    }
}
