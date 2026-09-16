namespace Elevant.Api.Configuration;

/// <summary>Marks endpoints whose responses must never be cached by clients or proxies.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class PrivateResponseAttribute : Attribute;
