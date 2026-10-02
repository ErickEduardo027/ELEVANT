namespace Elevant.Domain.Entities.Commercial;

/// <summary>Immutable non-fiscal Development invoice from one accepted preinvoice.</summary>
public sealed class NonFiscalInvoice : AuditableEntity
{
    public long PreinvoiceId { get; set; }
    public long AirlineId { get; set; }
    public long StationId { get; set; }
    public long IssuedByAccountId { get; set; }
    public Guid RequestId { get; set; }
    public string Number { get; set; } = string.Empty;
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal Total { get; set; }
}
