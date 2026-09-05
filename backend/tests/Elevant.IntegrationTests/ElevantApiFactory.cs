using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Elevant.IntegrationTests;

public sealed class ElevantApiFactory : WebApplicationFactory<Program>
{
    internal const string PrivateWebOrigin = "https://private-web.elevant.test";
    internal const string PublicWebOrigin = "https://public-web.elevant.test";

    private const string TestConnectionString =
        "Server=127.0.0.1,65535;Database=ElevantIntegrationTests;Integrated Security=true;Encrypt=true;TrustServerCertificate=true;Connect Timeout=1";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:ElevantDatabase", TestConnectionString);
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = TestConnectionString,
                ["Cors:AllowedOrigins:0"] = PrivateWebOrigin,
                ["Cors:AllowedOrigins:1"] = PublicWebOrigin,
                ["ELEVANT_DATABASE_ENVIRONMENT"] = "Development",
                ["ForwardedHeaders:Enabled"] = "false",
                ["HttpsRedirection:Enabled"] = "false",
                ["Swagger:Enabled"] = "true",
            });
        });
    }
}
