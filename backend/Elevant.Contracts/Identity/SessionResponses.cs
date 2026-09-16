using System.Text.Json.Serialization;

namespace Elevant.Contracts.Identity;

/// <summary>A newly issued bearer token and the actor it represents.</summary>
public sealed record SessionResponse(
    string AccessToken,
    string TokenType,
    DateTimeOffset ExpiresAt,
    SessionActorResponse Actor)
{
    /// <summary>Returns a diagnostic representation that omits identity data and credentials.</summary>
    public override string ToString() =>
        $"{nameof(SessionResponse)} {{ AccessToken = [REDACTED], Actor = [REDACTED] }}";
}

/// <summary>The current actor resolved from server-side identity state.</summary>
public sealed record CurrentSessionResponse(SessionActorResponse Actor);

/// <summary>Public account identity and effective authorization scope.</summary>
public sealed record SessionActorResponse(
    Guid AccountId,
    string Email,
    string DisplayName,
    IReadOnlyList<SessionRoleResponse> Roles,
    IReadOnlyList<SessionMembershipResponse> Memberships,
    IReadOnlyList<SessionStationScopeResponse> StationScopes);

public sealed record SessionRoleResponse(
    Guid RoleId,
    string Code,
    string Name,
    SessionPortal Portal,
    string UserType);

public sealed record SessionMembershipResponse(
    Guid MembershipId,
    Guid OrganizationId,
    string OrganizationCode,
    string OrganizationName,
    SessionOrganizationType OrganizationType,
    SessionMembershipKind Kind);

public sealed record SessionStationScopeResponse(Guid StationId, string StationCode);

/// <summary>Stable client surface selected by a role.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SessionPortal>))]
public enum SessionPortal
{
    [JsonStringEnumMemberName("back_office")]
    BackOffice,

    [JsonStringEnumMemberName("ramp_mobile_app")]
    RampMobileApp,

    [JsonStringEnumMemberName("airline_portal")]
    AirlinePortal,
}

/// <summary>Stable organization classification exposed over HTTP.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SessionOrganizationType>))]
public enum SessionOrganizationType
{
    [JsonStringEnumMemberName("aviam_operator")]
    AviamOperator,

    [JsonStringEnumMemberName("airline_customer")]
    AirlineCustomer,
}

/// <summary>Stable membership classification exposed over HTTP.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SessionMembershipKind>))]
public enum SessionMembershipKind
{
    [JsonStringEnumMemberName("internal_staff")]
    InternalStaff,

    [JsonStringEnumMemberName("airline_client")]
    AirlineClient,
}
