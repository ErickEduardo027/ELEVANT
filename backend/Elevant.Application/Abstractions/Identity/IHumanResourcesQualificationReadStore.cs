namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesQualificationData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, Guid EquipmentTypeId, string EquipmentCode,
    string EquipmentName, int CycleNumber, DateOnly TrainingDate, DateOnly ObtainedOn,
    DateOnly ExpiresOn, string CertifyingEntity, string InstructorName);

public sealed record HumanResourcesQualificationPage(int Page, int Limit, bool HasMore,
    IReadOnlyList<HumanResourcesQualificationData> Qualifications);

public sealed record HumanResourcesQualificationEquipmentType(Guid Id, string Code, string Name);

public interface IHumanResourcesQualificationReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Looks up exactly one agent/equipment pair without relying on a global page.</summary>
    Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        Guid rampProfileId, Guid equipmentTypeId,
        CancellationToken cancellationToken = default);

    /// <summary>Returns active qualification-bearing equipment types for an internal HR actor.</summary>
    Task<IReadOnlyList<HumanResourcesQualificationEquipmentType>?> ListEquipmentTypesAsync(
        Guid actorId, CancellationToken cancellationToken = default);
}
