using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Elevant.IntegrationTests.Api;

public sealed class CommercialIntakeEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task AnonymousApplicantReceivesAReferenceWithoutAnAccount()
    {
        var stub = new IntakeStub();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICommercialIntakeStore>();
                services.AddSingleton<ICommercialIntakeStore>(stub);
            }));
        using var client = application.CreateClient();
        var requestId = Guid.NewGuid();
        var airlineProfileId = Guid.NewGuid();
        var serviceId = Guid.NewGuid();

        using var response = await client.PostAsJsonAsync("/api/v1/public/commercial-requests",
            new { requestId, airlineProfileId, serviceIds = new[] { serviceId },
                representativeName = "Ana López", representativeTitle = "Representante legal",
                representativeEmail = "ana@example.test", representativePhone = "+1 809 555 0100",
                authorityDeclared = true }, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(airlineProfileId, stub.Written?.AirlineProfileId);
        Assert.Equal(serviceId, Assert.Single(stub.Written!.ServiceIds));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("REQ-2026-0001", json.RootElement.GetProperty("reference").GetString());
    }

    private sealed class IntakeStub : ICommercialIntakeStore
    {
        public SubmitCommercialRequestCommand? Written { get; private set; }

        public Task<CommercialSubmissionResult> SubmitAsync(
            SubmitCommercialRequestCommand command,
            CancellationToken cancellationToken = default)
        {
            Written = command;
            return Task.FromResult(CommercialSubmissionResult.Success("REQ-2026-0001", false));
        }
    }
}
