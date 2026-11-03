using System.ComponentModel.DataAnnotations;

namespace Elevant.Contracts.Operations;

// MVC validates positional records through their constructor parameters; property-targeted
// attributes on a record parameter make model binding throw instead of returning 400.
public sealed record PresenceHeartbeatRequest(
    // A per-client counter that starts at 0: int is enough, and Operations contracts expose no
    // long values (OccPlanningContractSafetyTests), so they cannot carry internal bigint keys.
    Guid ClientId, [Range(0, int.MaxValue)] int Sequence,
    [Required, RegularExpression("^(foreground|background|closed)$")] string Mode,
    bool ActivityObserved);
public sealed record ParticipantPresenceResponse(
    Guid AccountId, string Name, string Role, string State, DateTimeOffset? LastActivityAt,
    string? Availability, string? Message);
/// <summary>Null availability returns the account to automatic, connection-derived presence.</summary>
public sealed record PresenceStatusRequest(
    [RegularExpression("^(available|busy|doNotDisturb|beRightBack|away|appearOffline)$")] string? Availability,
    [MaxLength(80)] string? Message);
public sealed record OwnPresenceResponse(string State, string? Availability, string? Message);
public sealed record OperationPresenceResponse(
    Guid OperationId, IReadOnlyList<ParticipantPresenceResponse> Participants);
public sealed record OperationPresenceListResponse(
    DateTimeOffset AsOf, IReadOnlyList<OperationPresenceResponse> Operations);
