namespace Elevant.Domain.Entities.Commercial;

public sealed class ContractServiceRate : AuditableEntity
{
    public long ContractVersionId { get; set; }

    public long ServiceDefinitionId { get; set; }

    public string BillingUnit { get; set; } = string.Empty;

    public decimal UnitPrice { get; set; }

    public decimal MinimumQuantity { get; set; }
}
