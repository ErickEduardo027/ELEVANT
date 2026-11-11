using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

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

/// <summary>One charter as Finance follows it: what was served and whether the carrier prepaid.</summary>
/// <param name="Id">The charter agreement.</param>
/// <param name="OperationId">The ground operation of the charter flight.</param>
/// <param name="OperationCode">The operation's readable code.</param>
/// <param name="OperationDate">The station's local day of the operation.</param>
/// <param name="StationCode">The station of the operation.</param>
/// <param name="AirlineName">The carrier of the charter flight.</param>
/// <param name="CurrencyCode">The currency of the base tariff and of the prepayment.</param>
/// <param name="ServicesTotal">What was served at the base tariff; a service not performed does not count (3-N24).</param>
/// <param name="RequestSigned">Whether the service request carries both signatures.</param>
/// <param name="PrepaymentStatus">Pending until Finance confirms the prepayment.</param>
/// <param name="PrepaymentAmount">The prepaid amount, once confirmed.</param>
/// <param name="PrepaymentReference">The payment reference Finance recorded.</param>
/// <param name="PrepaymentConfirmedAt">When Finance confirmed the prepayment.</param>
/// <param name="Version">The agreement's version, the expected version of a reopening (3-N24).</param>
public sealed record FinanceCharterResponse(Guid Id, Guid OperationId, string OperationCode, DateOnly OperationDate,
    string StationCode, string AirlineName, string CurrencyCode, decimal? ServicesTotal, bool RequestSigned,
    string PrepaymentStatus, decimal? PrepaymentAmount, string? PrepaymentReference, DateTimeOffset? PrepaymentConfirmedAt,
    string? Version = null);

/// <summary>
/// Finance reopens a confirmed prepayment as a new quotation (3-N24), with its reason (8 to 500 characters) and the
/// version it saw; the amount and the reference stay until the next confirmation.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReopenCharterPrepaymentRequest
{
    public string? Reason { get; init; }

    public string? Version { get; init; }
}

/// <summary>
/// Finance confirms the carrier's prepayment (ADR-0033) with the Idempotency-Key header and the version it saw (4-N22).
/// The same amount and reference again change nothing; another amount or reference corrects a confirmed prepayment that
/// was never applied, with its reason.
/// </summary>
/// <param name="Amount">The prepaid amount, in the charter's currency.</param>
/// <param name="Reference">The payment reference.</param>
/// <param name="Version">The charter's version as Finance saw it; a stale one is 409 <c>version_conflict</c>.</param>
/// <param name="Reason">Why a confirmed prepayment is corrected (5 to 500 characters); not needed to confirm it.</param>
public sealed record ConfirmCharterPrepaymentRequest(
    [Range(0.01, 10000000)] decimal Amount,
    [Required, StringLength(80, MinimumLength = 2)] string Reference,
    string? Version = null,
    string? Reason = null);
