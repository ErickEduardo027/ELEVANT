namespace Elevant.Domain.Entities.Commercial;
/// <summary>Frozen on submission. Only draft replacement can remove a line.</summary>
public sealed class SupplierInvoiceLine : Entity<long>
{
    public Guid PublicId { get; init; }
    public long DocumentId { get; init; }
    public int LineNumber { get; init; }
    public string Description { get; init; } = string.Empty;
    public decimal Quantity { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal TaxAmount { get; init; }
    public decimal Total { get; init; }
}
