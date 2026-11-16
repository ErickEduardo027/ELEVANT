using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>Non-fiscal finance grouping of immutable approved-service snapshots.</summary>
public sealed class Preinvoice : AuditableEntity
{
    public long AirlineId { get; set; }

    public long StationId { get; set; }

    public long CreatedByAccountId { get; set; }

    public Guid RequestId { get; set; }

    public string PayloadHash { get; set; } = string.Empty;

    public DateOnly From { get; set; }

    public DateOnly To { get; set; }

    public string CurrencyCode { get; set; } = string.Empty;

    public decimal Total { get; set; }

    public PreinvoiceStatus Status { get; set; } = PreinvoiceStatus.Draft;
}
