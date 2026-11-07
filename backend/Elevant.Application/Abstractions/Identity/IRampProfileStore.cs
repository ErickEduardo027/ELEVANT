namespace Elevant.Application.Abstractions.Identity;

public sealed record RampProfileStation(Guid Id, string Code, string Name);
public sealed record RampProfileTerminal(Guid Id, Guid StationId, string Code, string Name);
/// <summary>A ramp agent's operational profile; <paramref name="Version"/> is the rowversion a save compares.</summary>
public sealed record RampProfileData(Guid Id, string FirstName, string LastName,
    string EmployeeNumber, string Category, DateOnly HireDate, bool IsActive,
    IReadOnlyList<RampProfileStation> Stations, bool HasAccount, string? AvatarMediaUrl = null,
    IReadOnlyList<RampProfileTerminal>? Terminals = null, Guid? SupervisorProfileId = null,
    string? AccountStatus = null, string? Version = null);
public sealed record RampProfileCatalog(IReadOnlyList<RampProfileData> Profiles,
    IReadOnlyList<RampProfileStation> AvailableStations,
    IReadOnlyList<RampProfileTerminal>? AvailableTerminals = null);
public sealed record RampProfileSupervisorSelection(Guid? Id);
/// <summary>
/// The profile form. <paramref name="ExpectedVersion"/> is the <c>version</c> the editor read; it is optional while
/// older screens exist (expand) and required with an Idempotency-Key.
/// </summary>
public sealed record SaveRampProfileInput(string FirstName, string LastName,
    string EmployeeNumber, string Category, DateOnly HireDate, bool IsActive,
    IReadOnlyList<Guid> StationIds, string? AvatarMediaUrl = null,
    IReadOnlyList<Guid>? TerminalIds = null,
    RampProfileSupervisorSelection? Supervisor = null,
    string? ExpectedVersion = null);
public enum RampProfileFailure { Forbidden, Invalid, NotFound, Conflict }
/// <summary>Outcome of a ramp profile save; <paramref name="Code"/> names the rule a failure broke.</summary>
public sealed record RampProfileResult(RampProfileData? Profile, RampProfileFailure? Failure, string? Code = null)
{
    public static RampProfileResult Success(RampProfileData profile) => new(profile, null);
    public static RampProfileResult Failed(RampProfileFailure failure, string? code = null) => new(null, failure, code);
}
public interface IRampProfileStore
{
    Task<RampProfileCatalog?> ListAsync(Guid actorId, CancellationToken cancellationToken = default);
    /// <summary>Creates a profile (no id) or saves one without an Idempotency-Key.</summary>
    Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId,
        SaveRampProfileInput input, CancellationToken cancellationToken = default);
    /// <summary>
    /// Saves the profile under <paramref name="idempotencyKey"/>, optional while older screens exist (expand): with
    /// the key the expected version is required, the same key and body answer the profile again without repeating
    /// the save and the key with another body is <c>idempotency_conflict</c>. A version the profile no longer has is
    /// <c>version_conflict</c>. Deactivating the profile ends the agent's ramp duty through the release path
    /// (2-N06), or fails with <c>agent_has_operation_in_progress</c>. Every refusal names its rule.
    /// </summary>
    Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId,
        SaveRampProfileInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
