using System.Text.Json.Serialization;

namespace Elevant.Contracts.Identity;

/// <summary>
/// «Ajustar horario» (3-E): the new local start and end of a shift of today or a later day (an end at or before the
/// start crosses midnight), the reason (5 to 500 characters) and the shift's <c>version</c> the screen read. Sent with
/// an Idempotency-Key; Gestión Humana and OCC use the same command.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AdjustHumanResourcesShiftRequest(TimeOnly StartsAtLocal, TimeOnly EndsAtLocal, string? Reason,
    string? ExpectedVersion);
