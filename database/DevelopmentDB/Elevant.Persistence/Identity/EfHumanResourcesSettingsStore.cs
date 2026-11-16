using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Identity;

/// <summary>
/// «Gestión Humana › Configuración» (ADR-0045): the custom permit types next to the two system ones and the equipment
/// types of the qualifications, under <c>human_resources.settings.*</c>, with the master-data command pattern
/// (<see cref="MasterDataCommand"/>: Idempotency-Key receipt, expected version, serializable transaction, audit). A
/// code changes only while nothing uses it; nothing is deleted; the boarding bridge keeps its code and stays active.
/// </summary>
internal sealed class EfHumanResourcesSettingsStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IHumanResourcesSettingsStore
{
    private const string ReadPermission = "human_resources.settings.read";
    private const string CreatePermission = "human_resources.settings.create";
    private const string UpdatePermission = "human_resources.settings.update";
    private const string PermitTypeResource = "ref.permit_document_types";
    private const string EquipmentTypeResource = "ref.equipment_types";
    private const string InvalidCode = "invalid_settings";

    /// <summary>Equipment codes a rule of the platform names (the bridge qualification, ADR-0030).</summary>
    private static readonly string[] LockedEquipmentCodes = [EfPositionCoverageStore.BridgeEquipmentTypeCode];

    public async Task<MasterDataResult<PermitTypeSettingsData>> ReadPermitTypesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, ReadPermission))
            return MasterDataResult<PermitTypeSettingsData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        var types = await context.PermitTypeDefinitions.AsNoTracking().OrderBy(item => item.Name)
            .ThenBy(item => item.Code).ToArrayAsync(cancellationToken);
        var used = await PermitCodesInUseAsync(cancellationToken);
        var items = PermitDocumentTypes.System
            .Select(item => new PermitTypeSettingData(null, item.Code, item.Name, null, true, true, true, null))
            .Concat(types.Select(item => PermitTypeItem(item, used.Contains(item.Code)))).ToArray();
        return MasterDataResult<PermitTypeSettingsData>.Success(new PermitTypeSettingsData(items,
            actor!.HasPermission(CreatePermission), actor.HasPermission(UpdatePermission)));
    }

    public async Task<MasterDataResult<PermitTypeSettingData>> CreatePermitTypeAsync(Guid actorId,
        CreatePermitTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (IsSystemCode(input.Code))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Conflict, "code_taken");
        var code = PermitDocumentTypes.CustomCode(input.Code);
        var name = MasterDataRules.Name(input.Name, PermitDocumentTypes.NameMaxLength);
        if (code is null || name is null || !TryDescription(input.Description, out var description))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Invalid, InvalidCode);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { code, name, description });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "hr.permit_type.create", hash,
            "code_taken", now, async () =>
            {
                if (await context.PermitTypeDefinitions.AnyAsync(item => item.Code == code, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "code_taken");
                var type = new PermitTypeDefinition
                {
                    PublicId = Guid.CreateVersion7(), Code = code, Name = name, Description = description, IsActive = true,
                    CreatedAt = now, UpdatedAt = now,
                };
                context.PermitTypeDefinitions.Add(type);
                MasterDataCommand.Audit(context, accountId, "hr.permit_type.created", PermitTypeResource, type.PublicId,
                    null, now, new("permit_type.code", null, code), new("permit_type.name", null, name),
                    new("permit_type.description", null, description), new("permit_type.active", null, "true"));
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(type.PublicId);
            }, PermitTypeAsync, cancellationToken);
    }

    public async Task<MasterDataResult<PermitTypeSettingData>> UpdatePermitTypeAsync(Guid actorId, Guid permitTypeId,
        UpdatePermitTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        if (IsSystemCode(input.Code))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Conflict, "system_type_locked");
        var code = PermitDocumentTypes.CustomCode(input.Code);
        var name = MasterDataRules.Name(input.Name, PermitDocumentTypes.NameMaxLength);
        if (code is null || name is null || !TryDescription(input.Description, out var description))
            return MasterDataResult<PermitTypeSettingData>.Failed(MasterDataFailure.Invalid, InvalidCode);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            permitTypeId, code, name, description, input.IsActive, expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "hr.permit_type.update", hash,
            "code_taken", now, async () =>
            {
                var type = await context.PermitTypeDefinitions.SingleOrDefaultAsync(item => item.PublicId == permitTypeId,
                    cancellationToken);
                if (type is null) return Step.Fail(MasterDataFailure.NotFound, "not_found");
                if (MasterDataCommand.Version(type.RowVersion) != input.ExpectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                if (code != type.Code)
                {
                    if (await PermitCodeInUseAsync(type.Code, cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, "code_in_use");
                    if (await context.PermitTypeDefinitions.AnyAsync(item => item.Code == code && item.Id != type.Id,
                            cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, "code_taken");
                }
                // A type a stand requires stays active: nobody could renew it and the stand would admit nobody.
                if (type.IsActive && !input.IsActive && await context.StandRequiredPermits.AnyAsync(item =>
                        item.DocumentTypeCode == type.Code, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "code_in_use");
                if (type.Code == code && type.Name == name && type.Description == description &&
                    type.IsActive == input.IsActive)
                    return Step.Done(type.PublicId);
                MasterDataCommand.Audit(context, accountId, MasterDataCommand.Event("hr.permit_type", type.IsActive,
                        input.IsActive), PermitTypeResource, type.PublicId, null, now,
                    new("permit_type.code", type.Code, code), new("permit_type.name", type.Name, name),
                    new("permit_type.description", type.Description, description),
                    new("permit_type.active", Flag(type.IsActive), Flag(input.IsActive)));
                (type.Code, type.Name, type.Description, type.IsActive, type.UpdatedAt) =
                    (code, name, description, input.IsActive, now);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(type.PublicId);
            }, PermitTypeAsync, cancellationToken);
    }

    public async Task<MasterDataResult<EquipmentTypeSettingsData>> ReadEquipmentTypesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, ReadPermission))
            return MasterDataResult<EquipmentTypeSettingsData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        var types = await context.EquipmentTypes.AsNoTracking().OrderBy(item => item.Name).ThenBy(item => item.Code)
            .ToArrayAsync(cancellationToken);
        var used = await EquipmentInUseAsync(null, cancellationToken);
        return MasterDataResult<EquipmentTypeSettingsData>.Success(new EquipmentTypeSettingsData(
            types.Select(item => EquipmentItem(item, used.Contains(item.Id))).ToArray(),
            actor!.HasPermission(CreatePermission), actor.HasPermission(UpdatePermission)));
    }

    public async Task<MasterDataResult<EquipmentTypeSettingData>> CreateEquipmentTypeAsync(Guid actorId,
        CreateEquipmentTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission))
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        var code = EquipmentCode(input.Code);
        var name = MasterDataRules.Name(input.Name, 160);
        if (code is null || name is null)
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Invalid, InvalidCode);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { code, name, input.RequiresQualification });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "hr.equipment_type.create", hash,
            "code_taken", now, async () =>
            {
                if (await context.EquipmentTypes.AnyAsync(item => item.Code == code, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "code_taken");
                var type = new EquipmentType
                {
                    PublicId = Guid.CreateVersion7(), Code = code, Name = name,
                    RequiresQualification = input.RequiresQualification, IsActive = true, CreatedAt = now, UpdatedAt = now,
                };
                context.EquipmentTypes.Add(type);
                MasterDataCommand.Audit(context, accountId, "hr.equipment_type.created", EquipmentTypeResource,
                    type.PublicId, null, now, new("equipment_type.code", null, code), new("equipment_type.name", null, name),
                    new("equipment_type.qualification", null, Flag(input.RequiresQualification)),
                    new("equipment_type.active", null, "true"));
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(type.PublicId);
            }, EquipmentTypeAsync, cancellationToken);
    }

    public async Task<MasterDataResult<EquipmentTypeSettingData>> UpdateEquipmentTypeAsync(Guid actorId,
        Guid equipmentTypeId, UpdateEquipmentTypeInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, UpdatePermission))
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        var code = EquipmentCode(input.Code);
        var name = MasterDataRules.Name(input.Name, 160);
        if (code is null || name is null)
            return MasterDataResult<EquipmentTypeSettingData>.Failed(MasterDataFailure.Invalid, InvalidCode);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            equipmentTypeId, code, name, input.RequiresQualification, input.IsActive, expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, "hr.equipment_type.update", hash,
            "code_taken", now, async () =>
            {
                var type = await context.EquipmentTypes.SingleOrDefaultAsync(item => item.PublicId == equipmentTypeId,
                    cancellationToken);
                if (type is null) return Step.Fail(MasterDataFailure.NotFound, "not_found");
                if (MasterDataCommand.Version(type.RowVersion) != input.ExpectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                if (LockedEquipmentCodes.Contains(type.Code, StringComparer.Ordinal) && (code != type.Code || !input.IsActive))
                    return Step.Fail(MasterDataFailure.Conflict, "system_type_locked");
                if (code != type.Code)
                {
                    if ((await EquipmentInUseAsync(type.Id, cancellationToken)).Contains(type.Id))
                        return Step.Fail(MasterDataFailure.Conflict, "code_in_use");
                    if (await context.EquipmentTypes.AnyAsync(item => item.Code == code && item.Id != type.Id,
                            cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, "code_taken");
                }
                if (type.Code == code && type.Name == name && type.RequiresQualification == input.RequiresQualification &&
                    type.IsActive == input.IsActive)
                    return Step.Done(type.PublicId);
                MasterDataCommand.Audit(context, accountId, MasterDataCommand.Event("hr.equipment_type", type.IsActive,
                        input.IsActive), EquipmentTypeResource, type.PublicId, null, now,
                    new("equipment_type.code", type.Code, code), new("equipment_type.name", type.Name, name),
                    new("equipment_type.qualification", Flag(type.RequiresQualification), Flag(input.RequiresQualification)),
                    new("equipment_type.active", Flag(type.IsActive), Flag(input.IsActive)));
                (type.Code, type.Name, type.RequiresQualification, type.IsActive, type.UpdatedAt) =
                    (code, name, input.RequiresQualification, input.IsActive, now);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(type.PublicId);
            }, EquipmentTypeAsync, cancellationToken);
    }

    private async Task<PermitTypeSettingData?> PermitTypeAsync(Guid id)
    {
        var type = await context.PermitTypeDefinitions.AsNoTracking().SingleOrDefaultAsync(item => item.PublicId == id);
        return type is null ? null : PermitTypeItem(type, await PermitCodeInUseAsync(type.Code, CancellationToken.None));
    }

    private async Task<EquipmentTypeSettingData?> EquipmentTypeAsync(Guid id)
    {
        var type = await context.EquipmentTypes.AsNoTracking().SingleOrDefaultAsync(item => item.PublicId == id);
        return type is null
            ? null
            : EquipmentItem(type, (await EquipmentInUseAsync(type.Id, CancellationToken.None)).Contains(type.Id));
    }

    private static PermitTypeSettingData PermitTypeItem(PermitTypeDefinition type, bool inUse) =>
        new(type.PublicId, type.Code, type.Name, type.Description, type.IsActive, false, inUse,
            MasterDataCommand.Version(type.RowVersion));

    private static EquipmentTypeSettingData EquipmentItem(EquipmentType type, bool inUse) =>
        new(type.PublicId, type.Code, type.Name, type.RequiresQualification, type.IsActive,
            LockedEquipmentCodes.Contains(type.Code, StringComparer.Ordinal), inUse,
            MasterDataCommand.Version(type.RowVersion));

    /// <summary>The permit codes a cycle or a stand requirement keeps.</summary>
    private async Task<HashSet<string>> PermitCodesInUseAsync(CancellationToken cancellationToken)
    {
        var cycles = await context.AirportPermitCycles.AsNoTracking().Select(item => item.DocumentType).Distinct()
            .ToArrayAsync(cancellationToken);
        var stands = await context.StandRequiredPermits.AsNoTracking().Select(item => item.DocumentTypeCode).Distinct()
            .ToArrayAsync(cancellationToken);
        return cycles.Concat(stands).ToHashSet(StringComparer.Ordinal);
    }

    private async Task<bool> PermitCodeInUseAsync(string code, CancellationToken cancellationToken) =>
        await context.AirportPermitCycles.AsNoTracking().AnyAsync(item => item.DocumentType == code, cancellationToken) ||
        await context.StandRequiredPermits.AsNoTracking().AnyAsync(item => item.DocumentTypeCode == code, cancellationToken);

    /// <summary>The equipment types a qualification cycle, an asset or an operational position uses.</summary>
    private async Task<HashSet<long>> EquipmentInUseAsync(long? only, CancellationToken cancellationToken)
    {
        var cycles = await context.QualificationCycles.AsNoTracking()
            .Where(item => only == null || item.EquipmentTypeId == only).Select(item => item.EquipmentTypeId).Distinct()
            .ToArrayAsync(cancellationToken);
        var assets = await context.Set<EquipmentAsset>().AsNoTracking()
            .Where(item => only == null || item.EquipmentTypeId == only).Select(item => item.EquipmentTypeId).Distinct()
            .ToArrayAsync(cancellationToken);
        var positions = await context.OperationalPositions.AsNoTracking()
            .Where(item => item.RequiredEquipmentTypeId != null && (only == null || item.RequiredEquipmentTypeId == only))
            .Select(item => item.RequiredEquipmentTypeId!.Value).Distinct().ToArrayAsync(cancellationToken);
        return cycles.Concat(assets).Concat(positions).ToHashSet();
    }

    private static bool IsSystemCode(string? value) =>
        PermitDocumentTypes.System.Any(item => string.Equals(item.Code, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>An equipment code: the permit-code shape, up to 40 characters (the catalog's column).</summary>
    private static string? EquipmentCode(string? value)
    {
        var code = value?.Trim().ToUpperInvariant();
        return code is { Length: >= 2 and <= 40 } && char.IsAsciiLetterOrDigit(code[0]) &&
               code.All(character => char.IsAsciiLetterUpper(character) || char.IsAsciiDigit(character) || character == '-')
            ? code
            : null;
    }

    private static bool TryDescription(string? value, out string? description)
    {
        description = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        return description is null ||
               (description.Length <= PermitDocumentTypes.DescriptionMaxLength &&
                !description.Any(character => char.IsControl(character) && character is not ('\n' or '\r')));
    }

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now()
    {
        var value = timeProvider.GetUtcNow();
        return new DateTimeOffset(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static string Flag(bool value) => value ? "true" : "false";
}
