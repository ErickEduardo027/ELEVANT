namespace Elevant.Application.Identity;

/// <summary>The public identity of an account whose credential was verified.</summary>
public sealed record VerifiedCredential(Guid AccountId, bool MustChangePassword = false);
