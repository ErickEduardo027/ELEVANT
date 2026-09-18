namespace Elevant.Api.Configuration;

/// <summary>Stable configuration and policy names owned by the API host.</summary>
public static class ApiConfiguration
{
    public const string CorsPolicy = "explicit-web-clients";
    public const string ApiRateLimitPolicy = "api-by-client-ip";
    public const string ApiVersion = "v1";
    public const int SessionRequestBodyLimitBytes = 4096;
    public const int OccAssignmentRequestBodyLimitBytes = 1024;
    public const int MobileDeviceRequestBodyLimitBytes = 2048;
}
