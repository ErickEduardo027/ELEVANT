using System.Security.Claims;
using Elevant.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Api;

public sealed class AccountHubUserIdProviderTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("4d7ae30f-7ff5-4c55-8a18-cef039c3fa34");

    [Fact]
    public void UsesJwtSubjectRatherThanNameIdentifier()
    {
        var claims = Principal(
            new Claim("sub", AccountId.ToString("D").ToUpperInvariant()),
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString("D")));

        Assert.Equal(AccountId.ToString("D"), AccountHubUserIdProvider.Resolve(claims));
    }

    [Fact]
    public void RejectsMissingDuplicateEmptyAndMalformedSubjects()
    {
        Assert.Null(AccountHubUserIdProvider.Resolve(Principal()));
        Assert.Null(AccountHubUserIdProvider.Resolve(Principal(
            new Claim("sub", AccountId.ToString("D")),
            new Claim("sub", AccountId.ToString("D")))));
        Assert.Null(AccountHubUserIdProvider.Resolve(Principal(new Claim("sub", Guid.Empty.ToString("D")))));
        Assert.Null(AccountHubUserIdProvider.Resolve(Principal(new Claim("sub", "not-an-account"))));
    }

    [Fact]
    public void ApiRegistersTheSubjectProvider()
    {
        Assert.IsType<AccountHubUserIdProvider>(factory.Services.GetRequiredService<IUserIdProvider>());
    }

    private static ClaimsPrincipal Principal(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, "Bearer"));
}
