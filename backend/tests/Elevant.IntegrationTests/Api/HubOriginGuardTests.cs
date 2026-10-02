using Elevant.Api.Hubs;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace Elevant.IntegrationTests.Api;

public sealed class HubOriginGuardTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly string[] AllowedOrigins =
        ["https://private-web.elevant.test", "http://localhost:5173"];

    [Theory]
    [InlineData("https://private-web.elevant.test")]
    [InlineData("http://localhost:5173")]
    public void AcceptsConfiguredBrowserOrigins(string origin)
    {
        Assert.True(HubOriginGuard.IsAllowed(
            "/hubs/operations", true, origin, AllowedOrigins));
    }

    [Theory]
    [InlineData("https://evil.test")]
    [InlineData("null")]
    [InlineData("*")]
    [InlineData("https://private-web.elevant.test/other")]
    [InlineData("https://private-web.elevant.test?token=bad")]
    [InlineData("https://private-web.elevant.test,https://evil.test")]
    public void RejectsUnexpectedOrMalformedBrowserOrigins(string origin)
    {
        Assert.False(HubOriginGuard.IsAllowed(
            "/hubs/notifications", true, origin, AllowedOrigins));
    }

    [Fact]
    public void RejectsMultipleOriginHeadersAndUnconfiguredOrigin()
    {
        Assert.False(HubOriginGuard.IsAllowed("/hubs/operations", true,
            new StringValues([AllowedOrigins[0], "https://evil.test"]), AllowedOrigins));
        Assert.False(HubOriginGuard.IsAllowed("/hubs/operations", true,
            AllowedOrigins[0], []));
    }

    [Fact]
    public void NativeClientWithoutOriginStillNeedsItsJwt()
    {
        Assert.True(HubOriginGuard.IsAllowed(
            "/hubs/operations", true, StringValues.Empty, AllowedOrigins));
    }

    [Fact]
    public void DoesNotChangeNonHubOrNonWebSocketRequests()
    {
        Assert.True(HubOriginGuard.IsAllowed(
            "/api/v1/auth/session", true, "https://evil.test", AllowedOrigins));
        Assert.True(HubOriginGuard.IsAllowed(
            "/hubs/operations", false, "https://evil.test", AllowedOrigins));
    }

    [Fact]
    public async Task RejectsUnexpectedBrowserOriginBeforeHubAuthentication()
    {
        var socketClient = factory.Server.CreateWebSocketClient();
        socketClient.ConfigureRequest = request => request.Headers.Origin = "https://evil.test";

        var error = await Record.ExceptionAsync(() => socketClient.ConnectAsync(
            new Uri("ws://localhost/hubs/operations"), TestContext.Current.CancellationToken));

        Assert.NotNull(error);
        Assert.Contains("status code: 403", error.Message, StringComparison.Ordinal);
    }
}
