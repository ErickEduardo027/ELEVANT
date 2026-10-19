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

    public int PaymentTermDays { get; set; }

    public DateOnly? DueDate { get; set; }
    public decimal? NetTotal { get; set; }
    public decimal? DiscountTotal { get; set; }
    public decimal? TaxTotal { get; set; }
    public bool TaxTreatmentsConfigured { get; set; }
    /// <summary>Frozen issuer/customer identity, station, terms and aggregate amounts. Not proof of fiscal validity.</summary>
    public string? CommercialSnapshotJson { get; set; }
}
