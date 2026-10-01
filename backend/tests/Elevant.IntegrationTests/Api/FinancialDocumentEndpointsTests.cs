using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class FinancialDocumentEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task PdfRoutesAreProtectedAndDeclaredAsBinaryResponses()
    {
        using var client = factory.CreateClient();
        var id = Guid.NewGuid();
        var routes = new[]
        {
            $"/api/v1/airline/portal/preinvoices/{id:D}/invoice/document",
            $"/api/v1/airline/portal/invoices/{id:D}/receipt",
            $"/api/v1/finance/invoices/by-preinvoice/{id:D}/document",
            $"/api/v1/finance/payments/by-invoice/{id:D}/receipt",
        };
        foreach (var route in routes)
        {
            using var response = await client.GetAsync(route,
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = json.RootElement.GetProperty("paths");
        foreach (var route in routes)
        {
            var template = route.Replace(id.ToString("D"),
                route.Contains("preinvoices/", StringComparison.Ordinal) ||
                route.Contains("by-preinvoice/", StringComparison.Ordinal)
                    ? "{preinvoiceId}" : "{invoiceId}");
            var response = paths.GetProperty(template).GetProperty("get")
                .GetProperty("responses").GetProperty("200");
            Assert.True(response.GetProperty("content")
                .TryGetProperty("application/pdf", out _));
        }
    }
}
