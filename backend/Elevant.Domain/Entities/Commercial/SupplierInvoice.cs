using Elevant.Domain.Enumerations;
namespace Elevant.Domain.Entities.Commercial;
public sealed class SupplierInvoice : AuditableEntity
{
    public long SupplierId { get; set; }
    public string DocumentReference { get; set; } = string.Empty;
    public DateOnly DocumentDate { get; set; }
    public DateOnly DueDate { get; set; }
    public SupplierInvoiceStatus Status { get; set; }
    public long ScopeStationId { get; set; }
    public long? StationId { get; set; }
    public long? AirlineId { get; set; }
    public long? TurnaroundId { get; set; }
    public long? ServiceDefinitionId { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal FxToDop { get; set; }
    public string FxSource { get; set; } = string.Empty;
    public DateOnly FxDate { get; set; }
    public decimal Total { get; set; }
    public decimal TotalDop { get; set; }
    public long CreatedByAccountId { get; set; }
}
