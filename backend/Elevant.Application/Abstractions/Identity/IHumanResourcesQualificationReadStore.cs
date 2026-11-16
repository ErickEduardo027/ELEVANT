using Elevant.Domain.Governance;

namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesQualificationData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, Guid EquipmentTypeId, string EquipmentCode,
    string EquipmentName, int CycleNumber, DateOnly TrainingDate, DateOnly ObtainedOn,
    DateOnly ExpiresOn, string CertifyingEntity, string InstructorName, string? Notes,
    DateTimeOffset RecordedAt, string Validity);

public sealed record HumanResourcesQualificationPage(int Page, int Limit, bool HasMore,
    IReadOnlyList<HumanResourcesQualificationData> Qualifications);

public sealed record HumanResourcesQualificationEquipmentType(Guid Id, string Code, string Name);

/// <summary>Filters for current qualification cycles; validity is evaluated on <paramref name="AsOf"/>.</summary>
public sealed record HumanResourcesQualificationQuery(DateOnly AsOf, string? Search = null,
    Guid? RampProfileId = null, Guid? EquipmentTypeId = null, DocumentValidity? Validity = null);

/// <summary>Counts of current cycles by validity; a projection, never stored.</summary>
public sealed record HumanResourcesDocumentSummary(DateOnly AsOf, int ExpiringSoonDays,
    int Total, int Valid, int ExpiringSoon, int Expired, int Upcoming);

public sealed record HumanResourcesQualificationCycle(Guid Id, int CycleNumber, bool IsCurrent,
    DateOnly TrainingDate, DateOnly ObtainedOn, DateOnly ExpiresOn, string CertifyingEntity,
    string InstructorName, string? Notes, DateTimeOffset RecordedAt, string? RecordedByName);

public sealed record HumanResourcesQualificationHistory(Guid RampProfileId, string AgentName,
    string EmployeeNumber, Guid EquipmentTypeId, string EquipmentCode, string EquipmentName,
    IReadOnlyList<HumanResourcesQualificationCycle> Cycles);

/// <summary>Read outcome that tells "not allowed" apart from "not found".</summary>
public sealed record HumanResourcesReadResult<T>(T? Value, bool Forbidden) where T : class
{
    public static HumanResourcesReadResult<T> Denied() => new(null, true);
    public static HumanResourcesReadResult<T> Missing() => new(null, false);
    public static HumanResourcesReadResult<T> Found(T value) => new(value, false);
}

public interface IHumanResourcesQualificationReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Looks up exactly one agent/equipment pair without relying on a global page.</summary>
    Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        Guid rampProfileId, Guid equipmentTypeId,
        CancellationToken cancellationToken = default);

    /// <summary>Lists current cycles matching the query; null when the actor may not read them.</summary>
    Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        HumanResourcesQualificationQuery query, CancellationToken cancellationToken = default);

    /// <summary>Counts current cycles by validity, ignoring the query's validity filter.</summary>
    Task<HumanResourcesDocumentSummary?> SummarizeAsync(Guid actorId,
        HumanResourcesQualificationQuery query, CancellationToken cancellationToken = default);

    /// <summary>Returns every cycle of the agent/equipment lineage the given cycle belongs to.</summary>
    Task<HumanResourcesReadResult<HumanResourcesQualificationHistory>> GetHistoryAsync(
        Guid actorId, Guid qualificationId, CancellationToken cancellationToken = default);

    /// <summary>Returns active qualification-bearing equipment types for an internal HR actor.</summary>
    Task<IReadOnlyList<HumanResourcesQualificationEquipmentType>?> ListEquipmentTypesAsync(
        Guid actorId, CancellationToken cancellationToken = default);
}
