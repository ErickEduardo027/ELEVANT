using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class CommercialMediaEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task UploadRequiresAuthenticationAndPublishesMultipartContract()
    {
        using var client = factory.CreateClient();
        using var body = new MultipartFormDataContent();
        body.Add(new StringContent("service-image"), "purpose");
        body.Add(new ByteArrayContent([137, 80, 78, 71, 13, 10, 26, 10]), "file", "sample.png");
        using var response = await client.PostAsync("/api/v1/media", body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = json.RootElement.GetProperty("paths");
        var upload = paths.GetProperty("/api/v1/media").GetProperty("post");
        Assert.True(upload.GetProperty("requestBody").GetProperty("content")
            .TryGetProperty("multipart/form-data", out _));
        Assert.True(paths.GetProperty("/api/v1/media/{id}").TryGetProperty("get", out _));
    }
}
