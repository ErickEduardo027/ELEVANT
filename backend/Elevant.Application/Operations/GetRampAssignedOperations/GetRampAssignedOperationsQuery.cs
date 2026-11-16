namespace Elevant.Application.Operations.GetRampAssignedOperations;

/// <summary>
/// Requests the active assignments owned by the authenticated account. Agent and station
/// identifiers are intentionally absent because both scopes are resolved server-side.
/// </summary>
public sealed record GetRampAssignedOperationsQuery(Guid AccountId);
