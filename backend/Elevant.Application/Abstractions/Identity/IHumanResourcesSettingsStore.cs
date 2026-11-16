using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Abstractions.Identity;

/// <summary>
/// A permit type of «Gestión Humana › Configuración» (ADR-0045). The two system types (<see cref="IsSystem"/>) have no
/// id or version and are never edited or deactivated; a custom one's code changes only while no cycle or stand uses it
/// (<see cref="InUse"/>). <see cref="Version"/> is the rowversion in base64, the expected version of the next change.
/// </summary>
public sealed record PermitTypeSettingData(Guid? Id, string Code, string Name, string? Description, bool IsActive,
    bool IsSystem, bool InUse, string? Version);

/// <summary>
/// An equipment type of the qualifications (<c>ref.equipment_types</c>). <see cref="IsLocked"/> marks the ones a rule
/// of the platform names by code (the boarding bridge): their code never changes and they are never deactivated.
/// </summary>
public sealed record EquipmentTypeSettingData(Guid Id, string Code, string Name, bool RequiresQualification,
    bool IsActive, bool IsLocked, bool InUse, string Version);

/// <summary>The catalogs of «Configuración» and what the caller may do with them.</summary>
public sealed record PermitTypeSettingsData(IReadOnlyList<PermitTypeSettingData> PermitTypes, bool CanCreate,
    bool CanUpdate);

public sealed record EquipmentTypeSettingsData(IReadOnlyList<EquipmentTypeSettingData> EquipmentTypes, bool CanCreate,
    bool CanUpdate);

public sealed record CreatePermitTypeInput(string Code, string Name, string? Description);

public sealed record UpdatePermitTypeInput(string Code, string Name, string? Description, bool IsActive,
    string ExpectedVersion);

public sealed record CreateEquipmentTypeInput(string Code, string Name, bool RequiresQualification);

public sealed record UpdateEquipmentTypeInput(string Code, string Name, bool RequiresQualification, bool IsActive,
    string ExpectedVersion);

/// <summary>
/// «Gestión Humana › Configuración» (ADR-0045) under <c>human_resources.settings.*</c>: the custom permit types and
/// the qualification equipment types. Nothing is deleted; every change is audited (<c>hr.permit_type.*</c>,
/// <c>hr.equipment_type.*</c>). Codes: <c>invalid_settings</c>, <c>version_conflict</c>, <c>idempotency_conflict</c>,
/// <c>code_taken</c>, <c>code_in_use</c>, <c>system_type_locked</c>, <c>forbidden</c>, <c>not_found</c>.
/// </summary>
public interface IHumanResourcesSettingsStore
{
    Task<MasterDataResult<PermitTypeSettingsData>> ReadPermitTypesAsync(Guid actorId,
        CancellationToken cancellationToken = default);

    Task<MasterDataResult<PermitTypeSettingData>> CreatePermitTypeAsync(Guid actorId, CreatePermitTypeInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<PermitTypeSettingData>> UpdatePermitTypeAsync(Guid actorId, Guid permitTypeId,
        UpdatePermitTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<EquipmentTypeSettingsData>> ReadEquipmentTypesAsync(Guid actorId,
        CancellationToken cancellationToken = default);

    Task<MasterDataResult<EquipmentTypeSettingData>> CreateEquipmentTypeAsync(Guid actorId,
        CreateEquipmentTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<EquipmentTypeSettingData>> UpdateEquipmentTypeAsync(Guid actorId, Guid equipmentTypeId,
        UpdateEquipmentTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default);
}
