using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Finance;

/// <summary>The version (base64 rowversion) of an operation as the caller saw it in «Por facturar».</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FinanceOperationVersionRequest
{
    public Guid OperationId { get; init; }

    [MaxLength(64)]
    public string Version { get; init; } = string.Empty;
}

/// <summary>
/// 4-N07: closes approved operations whose valuation is zero without an invoice, with the reason Finance gives (5 to
/// 500 characters). The Idempotency-Key header replays the first result; each operation carries its version.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CloseOperationsWithoutChargeRequest
{
    public Guid StationId { get; init; }

    [MinLength(1), MaxLength(100)]
    public IReadOnlyList<FinanceOperationVersionRequest> Operations { get; init; } = [];

    [MaxLength(500)]
    public string Reason { get; init; } = string.Empty;
}

/// <summary>The closure (no invoice, no e-NCF) and the operations it took out of «Por facturar».</summary>
public sealed record NoChargeClosureResponse(Guid ClosureId, IReadOnlyList<Guid> OperationIds, bool Replayed);

/// <summary>4-N06: the limits of one invoice, the same the server checks when it issues.</summary>
public sealed record FinanceInvoicingLimitsResponse(int MaxOperations, int MaxLines, int MaxDays);

/// <summary>An airline with pending operations in the period and how many.</summary>
public sealed record FinancePendingAirlineResponse(Guid AirlineId, string AirlineName, int PendingCount);

/// <summary>A billable service of a pending operation and its value before packages, minimums and charges.</summary>
public sealed record FinancePendingServiceResponse(Guid ServiceId, string ServiceCode, string ServiceName, bool Ready,
    string? BlockingReason, decimal? Amount, int ChargeCount);

/// <summary>
/// A pending operation: its version, the invoice lines it adds (each service, its charges and its contractual minimum),
/// the estimated net and every code that blocks it (empty when it is ready).
/// </summary>
public sealed record FinancePendingOperationResponse(Guid OperationId, string Version, string OperationCode,
    DateOnly OperationDate, Guid AirlineId, string AirlineName, string FlightNumber, string? ContractCode,
    string? CurrencyCode, int ServiceCount, int LineEstimate, decimal EstimatedNet, bool Ready,
    IReadOnlyList<string> BlockingReasons, IReadOnlyList<FinancePendingServiceResponse> Services);

/// <summary>
/// «Por facturar» (4-N16): the station's pending operations from the oldest, a page at a time; <c>NextCursor</c> is
/// opaque and null on the last page, and <c>TotalPending</c> counts every pending operation of the filters.
/// </summary>
public sealed record FinancePendingOperationsResponse(Guid StationId, FinanceInvoicingLimitsResponse Limits,
    IReadOnlyList<FinancePendingAirlineResponse> Airlines, IReadOnlyList<FinancePendingOperationResponse> Operations,
    string? NextCursor, int TotalPending);
