namespace Elevant.Domain.Entities.Reference;

public sealed class EquipmentAsset : AuditableEntity
{
    public long EquipmentTypeId { get; set; }

    public long StationId { get; set; }

    public string AssetCode { get; set; } = string.Empty;

    public string? SerialNumber { get; set; }

    public string Status { get; set; } = string.Empty;

    public bool IsActive { get; set; }
}
