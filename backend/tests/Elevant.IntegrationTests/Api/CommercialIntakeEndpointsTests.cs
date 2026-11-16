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
                authorityDeclared = true, representativeDocumentType = "NationalId",
                representativeDocumentNumber = "001-1234567-3", taxRegistration = "1-31-23456-9",
                taxRegistrationCountryCode = "DO" }, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        // The RNC is stored as its 9 digits; a catalog airline is not sent to the registries.
        Assert.Equal(("131234569", "DO"), (stub.Written?.TaxRegistration, stub.Written?.TaxRegistrationCountryCode));
        Assert.Null(stub.Written?.RegistryCheck);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(airlineProfileId, stub.Written?.AirlineProfileId);
        Assert.Equal(serviceId, Assert.Single(stub.Written!.ServiceIds));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("REQ-2026-0001", json.RootElement.GetProperty("reference").GetString());
    }

    [Fact]
    public async Task AnAirlineOutsideTheCatalogIsProposedAndAnIncompleteOneIsACodedProblem()
    {
        var stub = new IntakeStub();
        var registry = new FakeRegistry();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICommercialIntakeStore>();
                services.AddSingleton<ICommercialIntakeStore>(stub);
                services.RemoveAll<IAirlineRegistryLookup>();
                services.AddSingleton<IAirlineRegistryLookup>(registry);
            }));
        using var client = application.CreateClient();
        object Payload(object? proposedAirline, string? tax = "131234569", string? taxCountry = "DO") => new
        {
            requestId = Guid.NewGuid(), airlineProfileId = (Guid?)null, serviceIds = new[] { Guid.NewGuid() },
            representativeName = "Ana López", representativeTitle = "Representante legal",
            representativeEmail = "ana@caribecargo.example.com", representativePhone = "+1 809 555 0100",
            authorityDeclared = true, representativeDocumentType = "NationalId",
            representativeDocumentNumber = "001-1234567-3", proposedAirline,
            taxRegistration = tax, taxRegistrationCountryCode = taxCountry,
        };

        using var proposed = await client.PostAsJsonAsync("/api/v1/public/commercial-requests",
            Payload(new { name = "Caribe Cargo Express", countryCode = "DO", iataCode = (string?)null, icaoCode = "CCX",
                websiteUrl = "https://caribecargo.example.com" }), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, proposed.StatusCode);
        Assert.Equal(Guid.Empty, stub.Written?.AirlineProfileId);
        Assert.Equal(new CommercialAirlineProposal("Caribe Cargo Express", "DO", null, "CCX",
            "https://caribecargo.example.com"), stub.Written?.ProposedAirline);
        // ADR-0023: a proposed airline is checked against the registries (a fake here) when it is submitted.
        Assert.Equal(("Caribe Cargo Express", "CCX"), registry.Asked);
        Assert.Equal("NotFound", stub.Written?.RegistryCheck?.Status);

        // The tax identifier is required, and a Dominican airline gives an RNC of 9 digits.
        var caribe = new { name = "Caribe Cargo Express", countryCode = "DO", iataCode = (string?)null, icaoCode = "CCX" };
        foreach (var (tax, country) in new[] { ((string?)null, (string?)null), ("13123456", "DO"), ("B-12345678", "ES") })
        {
            using var refused = await client.PostAsJsonAsync("/api/v1/public/commercial-requests",
                Payload(caribe, tax, country), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
            using var taxProblem = JsonDocument.Parse(await refused.Content.ReadAsStringAsync(
                TestContext.Current.CancellationToken));
            Assert.Equal("invalid_tax_registration", taxProblem.RootElement.GetProperty("code").GetString());
        }
        // A foreign airline gives its own identifier, trimmed.
        using var foreign = await client.PostAsJsonAsync("/api/v1/public/commercial-requests",
            Payload(new { name = "Iberia Express", countryCode = "ES", iataCode = "I2", icaoCode = "IBS" }, " B-85850394 ", "ES"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, foreign.StatusCode);
        Assert.Equal(("B-85850394", "ES"), (stub.Written?.TaxRegistration, stub.Written?.TaxRegistrationCountryCode));

        using var incomplete = await client.PostAsJsonAsync("/api/v1/public/commercial-requests", Payload(null),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, incomplete.StatusCode);
        using var problem = JsonDocument.Parse(await incomplete.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("invalid_application", problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task ReceiptLookupIsReadOnlyAndReturnsNotFoundWithoutOriginalSubmission()
    {
        var stub = new IntakeStub();
        await using var application = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ICommercialIntakeStore>();
                services.AddSingleton<ICommercialIntakeStore>(stub);
            }));
        using var client = application.CreateClient();
        var payload = new { requestId = Guid.NewGuid(), airlineProfileId = Guid.NewGuid(),
            serviceIds = new[] { Guid.NewGuid() }, representativeName = "Ana LÃ³pez",
            representativeTitle = "Representante legal", representativeEmail = "ana@example.test",
            representativePhone = "+1 809 555 0100", authorityDeclared = true,
            representativeDocumentType = "NationalId", representativeDocumentNumber = "001-1234567-3",
            taxRegistration = "131234569", taxRegistrationCountryCode = "DO" };

        using var missing = await client.PostAsJsonAsync(
            "/api/v1/public/commercial-requests/receipt", payload,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Null(stub.Written);
        Assert.Equal(payload.requestId, stub.LookedUp?.RequestId);

        stub.Reference = "REQ-2026-0001";
        using var found = await client.PostAsJsonAsync(
            "/api/v1/public/commercial-requests/receipt", payload,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, found.StatusCode);
        using var json = JsonDocument.Parse(await found.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.True(json.RootElement.GetProperty("replayed").GetBoolean());
        Assert.Equal(stub.Reference, json.RootElement.GetProperty("reference").GetString());
        Assert.Null(stub.Written);
    }

    /// <summary>Answers NotFound without asking Wikidata or OpenFlights.</summary>
    private sealed class FakeRegistry : IAirlineRegistryLookup
    {
        public (string, string?)? Asked { get; private set; }

        public Task<AirlineRegistryCheck> CheckAsync(string name, string? iataCode, string? icaoCode,
            CancellationToken cancellationToken = default)
        {
            Asked = (name, icaoCode);
            return Task.FromResult(new AirlineRegistryCheck("NotFound", "OpenFlights", null, null, null, null, null,
                ["Ninguna aerolínea del registro usa el ICAO CCX."], DateTimeOffset.UtcNow));
        }
    }

    private sealed class IntakeStub : ICommercialIntakeStore
    {
        public SubmitCommercialRequestCommand? Written { get; private set; }
        public SubmitCommercialRequestCommand? LookedUp { get; private set; }
        public string? Reference { get; set; }

        public Task<CommercialSubmissionResult> SubmitAsync(
            SubmitCommercialRequestCommand command,
            CancellationToken cancellationToken = default)
        {
            Written = command;
            return Task.FromResult(CommercialSubmissionResult.Success("REQ-2026-0001", false));
        }

        public Task<string?> LookupReceiptAsync(SubmitCommercialRequestCommand command,
            CancellationToken cancellationToken = default)
        {
            LookedUp = command;
            return Task.FromResult(Reference);
        }
    }
}
