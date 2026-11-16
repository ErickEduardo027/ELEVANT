using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;

namespace Elevant.Api.Hubs;

/// <summary>Uses the account subject in ELEVANT access tokens for SignalR routing.</summary>
public sealed class AccountHubUserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection) => Resolve(connection.User);

    public static string? Resolve(ClaimsPrincipal? principal)
    {
        var subjects = principal?.FindAll("sub").Select(claim => claim.Value).ToArray() ?? [];
        return subjects.Length == 1 &&
            Guid.TryParseExact(subjects[0], "D", out var accountId) &&
            accountId != Guid.Empty
                ? accountId.ToString("D")
                : null;
    }
}
