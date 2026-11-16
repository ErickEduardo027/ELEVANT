namespace Elevant.Application.Identity.GetCurrentSession;

/// <summary>The validated public account identity carried by an authenticated request.</summary>
public sealed record GetCurrentSessionQuery(Guid AccountId);
