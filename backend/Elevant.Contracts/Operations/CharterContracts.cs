using System.ComponentModel.DataAnnotations;

namespace Elevant.Contracts.Operations;

/// <summary>A charter flight on the tablet (ADR-0033): its carrier data and the services it can add.</summary>
/// <param name="PrepaymentStatus">Pending or Confirmed.</param>
public sealed record RampCharterResponse(Guid OperationId, Guid CharterId, string CurrencyCode, string? CarrierAddress,
    string? ChargesPayableBy, string PrepaymentStatus, decimal? PrepaymentAmount,
    IReadOnlyList<CharterCatalogItemResponse> Catalog);

/// <summary>A service the agent can add to a charter, priced at Finance's base tariff.</summary>
public sealed record CharterCatalogItemResponse(Guid ServiceDefinitionId, string Code, string Name, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);

public sealed record AddCharterServiceRequest(
    Guid ServiceDefinitionId,
    [Range(0.01, 999)] decimal Quantity);

public sealed record UpdateCharterDetailsRequest(
    [StringLength(300)] string? CarrierAddress,
    [StringLength(160)] string? ChargesPayableBy);

/// <summary>Charters as Finance follows them: what was served and whether the carrier prepaid.</summary>
public sealed record FinanceCharterListResponse(IReadOnlyList<FinanceCharterResponse> Charters);

/// <param name="RequestSigned">Whether the service request carries both signatures.</param>
public sealed record FinanceCharterResponse(Guid Id, Guid OperationId, string OperationCode, DateOnly OperationDate,
    string StationCode, string AirlineName, string CurrencyCode, decimal? ServicesTotal, bool RequestSigned,
    string PrepaymentStatus, decimal? PrepaymentAmount, string? PrepaymentReference, DateTimeOffset? PrepaymentConfirmedAt);

public sealed record ConfirmCharterPrepaymentRequest(
    [Range(0.01, 10000000)] decimal Amount,
    [Required, StringLength(80, MinimumLength = 2)] string Reference);
