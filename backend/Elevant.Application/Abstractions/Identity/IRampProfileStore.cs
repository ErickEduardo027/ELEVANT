namespace Elevant.Application.Abstractions.Identity;

public sealed record RampProfileStation(Guid Id, string Code, string Name);
public sealed record RampProfileTerminal(Guid Id, Guid StationId, string Code, string Name);
public sealed record RampProfileData(Guid Id, string FirstName, string LastName,
    string EmployeeNumber, string Category, DateOnly HireDate, bool IsActive,
    IReadOnlyList<RampProfileStation> Stations, bool HasAccount, string? AvatarMediaUrl = null,
    IReadOnlyList<RampProfileTerminal>? Terminals = null, Guid? SupervisorProfileId = null,
    string? AccountStatus = null);
public sealed record RampProfileCatalog(IReadOnlyList<RampProfileData> Profiles,
    IReadOnlyList<RampProfileStation> AvailableStations,
    IReadOnlyList<RampProfileTerminal>? AvailableTerminals = null);
public sealed record RampProfileSupervisorSelection(Guid? Id);
public sealed record SaveRampProfileInput(string FirstName, string LastName,
    string EmployeeNumber, string Category, DateOnly HireDate, bool IsActive,
    IReadOnlyList<Guid> StationIds, string? AvatarMediaUrl = null,
    IReadOnlyList<Guid>? TerminalIds = null,
    RampProfileSupervisorSelection? Supervisor = null);
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
    Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId,
        SaveRampProfileInput input, CancellationToken cancellationToken = default);
}
