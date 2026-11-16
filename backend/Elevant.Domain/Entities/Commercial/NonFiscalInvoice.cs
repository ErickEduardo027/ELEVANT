namespace Elevant.Domain.Entities.Commercial;

/// <summary>
/// Immutable invoice issued by Finance from completed operations. Since ADR-0035 it carries a
/// simulated e-CF identity (e-NCF type 31, security code, signature time) without fiscal validity.
/// </summary>
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

    /// <summary>Simulated e-NCF, type 31 (crédito fiscal): E31 + 10 digits. Null on invoices before ADR-0035.</summary>
    public string? FiscalNumber { get; set; }

    /// <summary>Simulated 6-character security code printed with the e-NCF.</summary>
    public string? SecurityCode { get; set; }

    /// <summary>When the simulated e-CF was 'signed' (issued).</summary>
    public DateTimeOffset? FiscalSignedAt { get; set; }
}
