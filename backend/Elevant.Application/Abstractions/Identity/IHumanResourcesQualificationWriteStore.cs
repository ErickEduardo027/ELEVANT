namespace Elevant.Application.Abstractions.Identity;

public sealed record RecordHumanResourcesQualificationInput(
    Guid RampProfileId, Guid EquipmentTypeId, Guid? ExpectedCurrentId,
    DateOnly TrainingDate, DateOnly ObtainedOn, DateOnly ExpiresOn,
    string CertifyingEntity, string InstructorName, string? Notes);

public sealed record HumanResourcesQualificationRecorded(Guid Id, int CycleNumber);

public enum HumanResourcesQualificationWriteFailure
{
    Forbidden, Invalid, NotFound, Conflict,
}

public sealed record HumanResourcesQualificationWriteResult(
    HumanResourcesQualificationRecorded? Qualification,
    HumanResourcesQualificationWriteFailure? Failure)
{
    public static HumanResourcesQualificationWriteResult Success(Guid id, int cycleNumber) =>
        new(new HumanResourcesQualificationRecorded(id, cycleNumber), null);

    public static HumanResourcesQualificationWriteResult Failed(
        HumanResourcesQualificationWriteFailure failure) => new(null, failure);
}

public interface IHumanResourcesQualificationWriteStore
{
    Task<HumanResourcesQualificationWriteResult> RecordAsync(Guid actorId, Guid qualificationId,
        RecordHumanResourcesQualificationInput input, CancellationToken cancellationToken = default);
}
