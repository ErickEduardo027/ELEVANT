namespace Elevant.Application.Abstractions.Identity;

public sealed record RampProfileStation(Guid Id, string Code, string Name);
public sealed record RampProfileData(Guid Id, string FirstName, string LastName,
    string EmployeeNumber, string Category, DateOnly HireDate, bool IsActive,
    IReadOnlyList<RampProfileStation> Stations, bool HasAccount, string? AvatarMediaUrl = null);
public sealed record RampProfileCatalog(IReadOnlyList<RampProfileData> Profiles,
    IReadOnlyList<RampProfileStation> AvailableStations);
public sealed record SaveRampProfileInput(string FirstName, string LastName,
    string EmployeeNumber, string Category, DateOnly HireDate, bool IsActive,
    IReadOnlyList<Guid> StationIds, string? AvatarMediaUrl = null);
public enum RampProfileFailure { Forbidden, Invalid, NotFound, Conflict }
public sealed record RampProfileResult(RampProfileData? Profile, RampProfileFailure? Failure)
{
    public static RampProfileResult Success(RampProfileData profile) => new(profile, null);
    public static RampProfileResult Failed(RampProfileFailure failure) => new(null, failure);
}
public interface IRampProfileStore
{
    Task<RampProfileCatalog?> ListAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId,
        SaveRampProfileInput input, CancellationToken cancellationToken = default);
}
