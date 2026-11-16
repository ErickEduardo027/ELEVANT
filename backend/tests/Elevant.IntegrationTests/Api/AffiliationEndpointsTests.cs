using System.Net;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Elevant.IntegrationTests.Api;

public sealed class AffiliationEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task AnonymousCatalogListsPublicActiveChoicesWithoutCommercialRates()
    {
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IAffiliationStore>();
                services.AddScoped<IAffiliationStore>(_ => new OptionsStore());
            }));
        using var client = application.CreateClient();

        using var response = await client.GetAsync(
            "/api/v1/commercial/affiliation-options", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        await using var stream = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(JsonValueKind.Array, document.RootElement.GetProperty("stations").ValueKind);
        Assert.Equal(JsonValueKind.Array, document.RootElement.GetProperty("services").ValueKind);
        Assert.Equal("PUJ", document.RootElement.GetProperty("stations")[0].GetProperty("code").GetString());
        Assert.Equal("BAGGAGE", document.RootElement.GetProperty("services")[0].GetProperty("code").GetString());
        Assert.DoesNotContain("unitPrice", document.RootElement.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("password", document.RootElement.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    private sealed class OptionsStore : IAffiliationStore
    {
        public Task<AffiliationOptionsData> GetOptionsAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new AffiliationOptionsData(
                [new AffiliationStationOptionData(
                    Guid.Parse("20000000-0000-7000-8000-000000000003"), "PUJ", "Punta Cana")],
                [new AffiliationServiceOptionData(
                    Guid.Parse("20000000-0000-7000-8000-000000000006"),
                    "BAGGAGE", "Baggage handling", "operation")]));
    }
}
