namespace Elevant.Domain.Entities.Reference;

/// <summary>
/// A permit or badge type Gestión Humana adds to the two system types (ADR-0045). Its code is what a permit cycle
/// (<c>hr.airport_permit_cycles.document_type</c>) and a stand's requirement keep; it never takes a system code.
/// Nothing is deleted: an inactive type takes no new cycles but its history and requirements stay.
/// </summary>
public sealed class PermitTypeDefinition : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; }
}
