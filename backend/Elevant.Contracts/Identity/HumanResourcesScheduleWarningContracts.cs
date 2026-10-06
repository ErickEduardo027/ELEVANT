namespace Elevant.Contracts.Identity;

public sealed record HumanResourcesScheduleWarningEvidenceResponse(
    Guid ShiftId, Guid StationId, string StationCode,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public sealed record HumanResourcesScheduleWarningResponse(
    Guid AnchorShiftId, Guid RampProfileId, string AgentName,
    string EmployeeNumber, DateOnly WorkDate, string Kind,
    IReadOnlyList<HumanResourcesScheduleWarningEvidenceResponse> Evidence,
    bool HasRestrictedEvidence, int? MeasuredMinutes, int? ThresholdMinutes,
    string RuleVersion, DateOnly RuleEffectiveOn, string? Reason);

public sealed record HumanResourcesScheduleWarningPageResponse(
    Guid StationId, DateOnly From, DateOnly To, int Page, int Limit,
    bool HasMore, DateTimeOffset AsOf, string RuleVersion,
    DateOnly RuleEffectiveOn,
    IReadOnlyList<HumanResourcesScheduleWarningResponse> Warnings);
