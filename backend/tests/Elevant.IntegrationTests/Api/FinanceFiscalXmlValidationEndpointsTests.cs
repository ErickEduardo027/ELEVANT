using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class FinanceFiscalXmlValidationEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private const string Route = "/api/v1/finance/fiscal-xml/validate";
    private const int MaxBytes = 2 * 1024 * 1024;
    private static readonly Guid Account = Guid.Parse("deadbeef-0000-4000-8000-000000000031");

    [Fact]
    public async Task RequiresJwtFinanceReadAndCurrentInternalOperatorMembership()
    {
        var access = new Access();
        await using var app = App(access);
        using var client = app.CreateClient();
        using var anonymous = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", "not-a-jwt");
        using var invalidToken = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.Unauthorized, invalidToken.StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token());
        access.CanRead = false;
        using var missingPermission = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.Forbidden, missingPermission.StatusCode);
        access.CanRead = true;
        access.Internal = false;
        using var airline = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.Forbidden, airline.StatusCode);
        access.Internal = true;
        access.Operator = false;
        using var foreignOrganization = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.Forbidden, foreignOrganization.StatusCode);
        access.Operator = true;
        access.Exists = false;
        using var missingActor = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.Forbidden, missingActor.StatusCode);
        access.Exists = true;
        using var reader = await Post(client, new { documentType = "E31", xmlUtf8 = "<ECF/>" });
        Assert.Equal(HttpStatusCode.OK, reader.StatusCode); // Read permission suffices; no simulate/manage grant.
        Assert.Equal(Account, access.ResolvedAccount);
    }

    [Theory]
    [InlineData(31)]
    [InlineData(32)]
    [InlineData(33)]
    [InlineData(34)]
    public async Task MapsRealOfficialSchemaResultsWithoutClaimingSignatureOrFiscalAcceptance(int type)
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        using var response = await Post(client, new { documentType = $"E{type}", xmlUtf8 = Fixture(type) });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var result = json.RootElement;
        Assert.Equal($"DGII.ECF.E{type}", result.GetProperty("schemaId").GetString());
        Assert.Equal("1.0", result.GetProperty("schemaVersion").GetString());
        Assert.Equal(64, result.GetProperty("schemaSha256").GetString()!.Length);
        Assert.Equal("Passed", result.GetProperty("schemaValidation").GetString());
        Assert.False(result.GetProperty("isStructurallyValid").GetBoolean());
        Assert.False(result.GetProperty("signatureElementPresent").GetBoolean());
        Assert.Equal("SignatureMissing", result.GetProperty("structuralErrors")[0].GetProperty("code").GetString());
        Assert.Equal("NotPerformed", result.GetProperty("cryptographicValidation").GetString());
        Assert.Equal("NotPerformed", result.GetProperty("fiscalAcceptance").GetString());
        Assert.False(result.TryGetProperty("xmlUtf8", out _));
        Assert.False(result.TryGetProperty("xmlBase64", out _));
        Assert.False(result.TryGetProperty("documentId", out _)); // No persistence/dispatch.
    }

    [Fact]
    public async Task Base64AndTextMapToTheSameResultsWithoutChangingOriginalUtf8Bytes()
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        var xml = Fixture(31).Replace("TEST EMITTER", "TEST EMITTER Á");
        using var text = await Post(client, new { documentType = "E31", xmlUtf8 = xml });
        using var binary = await Post(client, new { documentType = "E31", xmlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(xml)) });
        Assert.Equal(HttpStatusCode.OK, binary.StatusCode);
        Assert.Equal(await text.Content.ReadAsStringAsync(TestContext.Current.CancellationToken),
            await binary.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("E41", "<ECF/>", null)]
    [InlineData("31", "<ECF/>", null)]
    [InlineData("e31", "<ECF/>", null)]
    [InlineData("https://untrusted.invalid/schema.xsd", "<ECF/>", null)]
    [InlineData("E31", null, null)]
    [InlineData("E31", "", null)]
    [InlineData("E31", "<ECF/>", "PEVDRi8+")]
    [InlineData("E31", null, "!!!!")]
    [InlineData("E31", null, "/w==")]
    public async Task InvalidDtoOrEncodingFailsBeforeValidation(string type, string? text, string? base64)
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        using var response = await Post(client, new { documentType = type, xmlUtf8 = text, xmlBase64 = base64 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.DoesNotContain("schemaValidation", body);
        Assert.DoesNotContain("untrusted.invalid", body);
    }

    [Fact]
    public async Task MalformedXmlAndMissingRequiredFieldsReturnFailedStructuralResults()
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        foreach (var xml in new[] { "<ECF>", Fixture(31).Replace("<MontoTotal>100.00</MontoTotal>", "") })
        {
            using var response = await Post(client, new { documentType = "E31", xmlUtf8 = xml });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
            Assert.Equal("Failed", result.RootElement.GetProperty("schemaValidation").GetString());
            Assert.False(result.RootElement.GetProperty("isStructurallyValid").GetBoolean());
            Assert.NotEmpty(result.RootElement.GetProperty("structuralErrors").EnumerateArray());
        }
    }

    [Fact]
    public async Task XxeAndExternalDtdAreRejectedWithoutAnyNetworkConnection()
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        using var trap = new TcpListener(IPAddress.Loopback, 0);
        trap.Start();
        var uri = $"http://127.0.0.1:{((IPEndPoint)trap.LocalEndpoint).Port}/secret";
        foreach (var xml in new[]
        {
            $"<!DOCTYPE ECF SYSTEM '{uri}'><ECF/>",
            $"<!DOCTYPE ECF [<!ENTITY xxe SYSTEM '{uri}'>]><ECF>&xxe;</ECF>",
            "<!DOCTYPE ECF [<!ENTITY xxe SYSTEM 'file:///synthetic-test-secret'>]><ECF>&xxe;</ECF>",
        })
        {
            using var response = await Post(client, new { documentType = "E31", xmlUtf8 = xml });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
            Assert.False(json.RootElement.GetProperty("isStructurallyValid").GetBoolean());
            Assert.Contains(json.RootElement.GetProperty("structuralErrors").EnumerateArray(),
                e => e.GetProperty("code").GetString() == "XmlRejected");
        }
        Assert.False(trap.Pending());
    }

    [Fact]
    public async Task DecodedByteLimitAppliesToTextMultibyteAndBase64()
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        foreach (var request in new object[]
        {
            new { documentType = "E31", xmlUtf8 = new string('x', MaxBytes + 1) },
            new { documentType = "E31", xmlUtf8 = new string('é', MaxBytes / 2 + 1) },
            new { documentType = "E31", xmlBase64 = Convert.ToBase64String(new byte[MaxBytes + 1]) },
        })
        {
            using var response = await Post(client, request);
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        }
        var exactlyAtLimit = "<ECF>" + new string(' ', MaxBytes - 11) + "</ECF>";
        using var boundary = await Post(client, new { documentType = "E31", xmlUtf8 = exactlyAtLimit });
        Assert.Equal(HttpStatusCode.OK, boundary.StatusCode);
    }

    [Fact]
    public async Task HttpEnvelopeHasABoundedRequestSize()
    {
        await using var app = App(new Access());
        using var client = Authorized(app);
        using var content = new StringContent(new string(' ', 13 * 1024 * 1024), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(Route, content, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task OpenApiUsesDedicatedPublicContracts()
    {
        await using var app = App(new Access());
        using var client = app.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.True(json.RootElement.GetProperty("paths").TryGetProperty(Route, out _));
        var schemas = json.RootElement.GetProperty("components").GetProperty("schemas");
        Assert.True(schemas.TryGetProperty("FinanceFiscalXmlValidationRequest", out _));
        Assert.True(schemas.TryGetProperty("FinanceFiscalXmlValidationResponse", out _));
        Assert.False(schemas.TryGetProperty("OfficialEcfXmlValidationResult", out _));
    }

    private WebApplicationFactory<Program> App(Access access) => factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<IActorContextResolver>();
        s.AddSingleton<IActorContextResolver>(access);
        // Use the real validator and its parent-owned resource/DI registration.
    }));
    private static HttpClient Authorized(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token());
        return client;
    }
    private static Task<HttpResponseMessage> Post(HttpClient client, object body) =>
        client.PostAsJsonAsync(Route, body, TestContext.Current.CancellationToken);

    private static string Token()
    {
        var now = DateTimeOffset.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience, Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime, Issuer = ElevantApiFactory.AuthenticationIssuer, NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new(new SymmetricSecurityKey(Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity([new(JwtRegisteredClaimNames.Sub, Account.ToString("D")),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp))]),
            TokenType = "at+jwt",
        });
    }

    private sealed class Access : IActorContextResolver
    {
        public bool CanRead { get; set; } = true;
        public bool Internal { get; set; } = true;
        public bool Operator { get; set; } = true;
        public bool Exists { get; set; } = true;
        public Guid ResolvedAccount { get; private set; }
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default)
        {
            ResolvedAccount = accountId;
            return Task.FromResult<ActorContext?>(!Exists ? null : new(accountId, "synthetic@test.invalid", "Synthetic reader", [],
                [new(Guid.NewGuid(), Guid.NewGuid(), "TEST", "Test organization",
                    Operator ? OrganizationType.AviamOperator : OrganizationType.AirlineCustomer,
                    Internal ? MembershipKind.InternalStaff : MembershipKind.AirlineClient)], [],
                new(DepartmentAssignmentKind.Member, Department.Finance,
                    new HashSet<string>(CanRead ? ["finance.fiscal.read"] : []))));
        }
    }

    // TEST ONLY. The explicit marker satisfies the official skipped wildcard;
    // the endpoint must still report SignatureMissing and crypto NotPerformed.
    private static string Fixture(int type)
    {
        var expiry = type is 31 or 33 ? "<FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia>" : "";
        var credit = type == 34 ? "<IndicadorNotaCredito>0</IndicadorNotaCredito>" : "";
        var income = type is 31 or 32 ? "<TipoIngresos>01</TipoIngresos>" : "";
        var buyer = type is 31 or 32 ? "<Comprador><RNCComprador>000000000</RNCComprador><RazonSocialComprador>TEST BUYER</RazonSocialComprador></Comprador>" : "";
        var reference = type is 33 or 34 ? "<InformacionReferencia><NCFModificado>E310000000001</NCFModificado><FechaNCFModificado>17-10-2026</FechaNCFModificado><CodigoModificacion>3</CodigoModificacion></InformacionReferencia>" : "";
        return $"""
            <ECF><Encabezado><Version>1.0</Version>
            <IdDoc><TipoeCF>{type}</TipoeCF><eNCF>E{type}0000000001</eNCF>{expiry}{credit}{income}<TipoPago>1</TipoPago></IdDoc>
            <Emisor><RNCEmisor>000000000</RNCEmisor><RazonSocialEmisor>TEST EMITTER</RazonSocialEmisor><DireccionEmisor>TEST ONLY</DireccionEmisor><FechaEmision>18-10-2026</FechaEmision></Emisor>
            {buyer}<Totales><MontoExento>100.00</MontoExento><MontoTotal>100.00</MontoTotal></Totales></Encabezado>
            <DetallesItems><Item><NumeroLinea>1</NumeroLinea><IndicadorFacturacion>4</IndicadorFacturacion><NombreItem>SYNTHETIC</NombreItem><IndicadorBienoServicio>2</IndicadorBienoServicio><CantidadItem>1.00</CantidadItem><PrecioUnitarioItem>100.00</PrecioUnitarioItem><MontoItem>100.00</MontoItem></Item></DetallesItems>
            {reference}<FechaHoraFirma>18-10-2026 12:00:00</FechaHoraFirma>
            <UnsignedSyntheticFixture xmlns="urn:elevant:tests:unsigned">TEST ONLY - NO SIGNATURE OR FISCAL VALIDITY</UnsignedSyntheticFixture></ECF>
            """;
    }
}
