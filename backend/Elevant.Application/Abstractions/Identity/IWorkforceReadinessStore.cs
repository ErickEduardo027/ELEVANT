namespace Elevant.Application.Abstractions.Identity;

/// <summary>
/// One requirement for a ramp agent to operate (ADR-0026). <see cref="Status"/> is <c>Ok</c>,
/// <c>Expiring</c> (valid but within 30 days of its end), <c>Missing</c> or <c>Info</c> (shown,
/// never blocking).
/// </summary>
public sealed record RampAgentReadinessItem(string Key, string Status, string? Detail, DateOnly? ExpiresOn = null);

/// <summary>Whether the agent can be assigned to operations today, and what is missing otherwise.</summary>
public sealed record RampAgentReadinessData(Guid RampProfileId, string AgentName, string EmployeeNumber,
    bool Ready, IReadOnlyList<RampAgentReadinessItem> Items);

public sealed record RampAgentShiftData(Guid Id, DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal,
    string Block, string StationCode, string TerminalCode);

/// <param name="Kind"><c>AirportId</c>, <c>RampDriverLicense</c> or <c>Qualification</c>.</param>
/// <param name="Validity"><c>Current</c>, <c>Expiring</c> or <c>Expired</c>.</param>
public sealed record RampAgentDocumentData(string Kind, string Label, string? Number, DateOnly ExpiresOn, string Validity);

/// <summary>The agent's own shifts and documents for the tablet (read-only).</summary>
public sealed record RampAgentScheduleData(Guid RampProfileId, string AgentName, DateOnly From, DateOnly To,
    IReadOnlyList<RampAgentShiftData> Shifts, IReadOnlyList<RampAgentDocumentData> Documents);

public interface IWorkforceReadinessStore
{
    /// <summary>
    /// Readiness of every active ramp agent, for Gestión Humana (<c>human_resources.ramp_profiles.read</c>).
    /// Null when the actor may not read it.
    /// </summary>
    Task<IReadOnlyList<RampAgentReadinessData>?> ListReadinessAsync(Guid actorId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Shifts and documents of the ramp agent behind the account (RAMP_AGENT on the mobile app);
    /// null when the account is not an active ramp agent.
    /// </summary>
    Task<RampAgentScheduleData?> GetOwnScheduleAsync(Guid accountId, DateOnly from, DateOnly to,
        CancellationToken cancellationToken = default);
}
