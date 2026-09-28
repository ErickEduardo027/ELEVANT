namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesQualificationData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, Guid EquipmentTypeId, string EquipmentCode,
    string EquipmentName, int CycleNumber, DateOnly TrainingDate, DateOnly ObtainedOn,
    DateOnly ExpiresOn, string CertifyingEntity, string InstructorName);

public sealed record HumanResourcesQualificationPage(int Page, int Limit, bool HasMore,
    IReadOnlyList<HumanResourcesQualificationData> Qualifications);

public interface IHumanResourcesQualificationReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesQualificationPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);
}
