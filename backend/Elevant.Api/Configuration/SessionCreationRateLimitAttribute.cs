namespace Elevant.Api.Configuration;

/// <summary>Marks the credential exchange endpoint for the stricter client-IP limit.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class SessionCreationRateLimitAttribute : Attribute;
