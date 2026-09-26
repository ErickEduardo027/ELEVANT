using Microsoft.Extensions.Primitives;

namespace Elevant.Api.Hubs;

/// <summary>Rejects browser WebSocket origins outside the exact API allowlist.</summary>
public static class HubOriginGuard
{
    public static bool IsAllowed(
        PathString path,
        bool isWebSocketRequest,
        StringValues origin,
        IReadOnlyCollection<string> allowedOrigins)
    {
        if (!isWebSocketRequest ||
            (!path.StartsWithSegments("/hubs/operations") &&
             !path.StartsWithSegments("/hubs/notifications") &&
             !path.StartsWithSegments("/hubs/public-catalog")))
        {
            return true;
        }

        // Native clients do not send Origin. JWT authentication still applies.
        if (origin.Count == 0)
        {
            return true;
        }

        if (origin.Count != 1 || string.IsNullOrWhiteSpace(origin[0]))
        {
            return false;
        }

        var value = origin[0]!;
        if (value.EndsWith('/') ||
            !Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
            !parsed.IsWellFormedOriginalString() ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) ||
            parsed.UserInfo.Length != 0 ||
            parsed.AbsolutePath != "/" ||
            parsed.Query.Length != 0 ||
            parsed.Fragment.Length != 0)
        {
            return false;
        }

        return allowedOrigins.Contains(value, StringComparer.OrdinalIgnoreCase);
    }
}
