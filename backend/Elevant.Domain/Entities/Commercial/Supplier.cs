namespace Elevant.Domain.Entities.Commercial;
public sealed class Supplier : AuditableEntity
{
    public long ScopeStationId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? TaxReference { get; set; }
    public string? ContactEmail { get; set; }
    public bool IsActive { get; set; } = true;
    public long CreatedByAccountId { get; set; }
}
