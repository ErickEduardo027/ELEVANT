using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// A flight served without a ground-handling contract (ADR-0033). The signed «Solicitud de Servicio
/// y Descargo de Responsabilidad» is that flight's agreement: services are priced at Finance's base
/// tariff and the carrier pays in advance, which Finance confirms here.
/// </summary>
public sealed class CharterAgreement : AuditableEntity
{
    public long TurnaroundId { get; set; }

    public long AirlineId { get; set; }

    /// <summary>Currency of Finance's base tariff the services are priced in.</summary>
    public string CurrencyCode { get; set; } = string.Empty;

    /// <summary>Carrier address as the representative gives it on the ramp.</summary>
    public string? CarrierAddress { get; set; }

    /// <summary>Who pays the charges («Cargos pagaderos por»), when not the carrier itself.</summary>
    public string? ChargesPayableBy { get; set; }

    public CharterPrepaymentStatus PrepaymentStatus { get; set; }

    public decimal? PrepaymentAmount { get; set; }

    public string? PrepaymentReference { get; set; }

    public DateTimeOffset? PrepaymentConfirmedAt { get; set; }

    public long? PrepaymentConfirmedByAccountId { get; set; }

    public long CreatedByAccountId { get; set; }
}
