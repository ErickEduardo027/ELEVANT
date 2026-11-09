using System.Security.Cryptography;
using System.Text;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>
/// Simulated e-CF of the DGII for AVIAM's invoices (ADR-0035): e-NCF type 31 (crédito fiscal),
/// fixed ITBIS 18 % on the net of every service and charge, and a security code. It has no fiscal
/// validity: nothing is transmitted and every document says so.
/// </summary>
public static class FinanceInvoicePolicy
{
    public const decimal ItbisRate = 18m;
    public const string ItbisBasis = "ITBIS 18 % · e-CF simulado";
    public const string FiscalNumberPrefix = "E31";
    public const string Disclaimer = "Simulación — sin validez fiscal";

    /// <summary>Simulated RNC printed for AVIAM; the commercial model has no reviewed tax registration yet.</summary>
    public const string SimulatedIssuerRnc = "130000001";

    /// <summary>Marks the tax snapshot as the fixed ITBIS rule, not a configurable policy.</summary>
    public static readonly Guid ItbisPolicyId = Guid.Parse("0f5c2e31-0018-4e31-9e31-000000000018");

    /// <summary>4-N02: «Por facturar» and its reads are governed by Facturación, never by a retired module.</summary>
    public const string ReadPermission = "finance.invoicing.read";

    /// <summary>
    /// 4-N02: who may read an issued invoice (its PDF, its emails): «Facturas», or «Por facturar» that issued it.
    /// </summary>
    public static readonly IReadOnlyList<string> InvoiceReaderPermissions =
        ["finance.reconciliation.read", ReadPermission, IssueInvoiceHandler.IssuePermission];

    public static bool CanReadInvoice(Identity.ActorContext actor)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return InvoiceReaderPermissions.Any(actor.HasPermission);
    }

    /// <summary>
    /// 4-N06: the one set of limits of an invoice, checked by the server and published by «Por facturar»: up to 100
    /// operations, 500 invoice lines (every billable service is at least one line) and operations of at most 31
    /// calendar days, so a week or a month of one airline fits.
    /// </summary>
    public const int MaxOperations = 100;

    public const int MaxLines = 500;

    public const int MaxDays = 31;

    /// <summary>Whether operations from <paramref name="from"/> to <paramref name="to"/> fit one invoice (4-N06).</summary>
    public static bool FitsWindow(DateOnly from, DateOnly to) =>
        to >= from && to.DayNumber - from.DayNumber < MaxDays;

    public static string FormatFiscalNumber(long sequence)
    {
        if (sequence is < 1 or > 9_999_999_999) throw new ArgumentOutOfRangeException(nameof(sequence));
        return FiscalNumberPrefix + sequence.ToString("D10", System.Globalization.CultureInfo.InvariantCulture);
    }

    public static bool IsFiscalNumber(string? value) =>
        value is { Length: 13 } && value.StartsWith(FiscalNumberPrefix, StringComparison.Ordinal) &&
        value[3..].All(char.IsAsciiDigit);

    /// <summary>The next e-NCF after the highest one issued (null when none).</summary>
    public static string NextFiscalNumber(string? highest) =>
        FormatFiscalNumber(IsFiscalNumber(highest) ? long.Parse(highest![3..], System.Globalization.CultureInfo.InvariantCulture) + 1 : 1);

    /// <summary>Six characters derived from what the e-CF certifies: number, total, time and customer.</summary>
    public static string SecurityCode(string fiscalNumber, decimal total, DateTimeOffset signedAt, string customer)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var source = $"{fiscalNumber}|{total.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)}|" +
            $"{signedAt.ToUniversalTime():yyyy-MM-ddTHH:mm:ss.fffZ}|{customer}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(source));
        return new string(hash.Take(6).Select(value => alphabet[value % alphabet.Length]).ToArray());
    }

    public static decimal Tax(decimal net) => decimal.Round(net * ItbisRate / 100m, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Replaces the line's tax snapshot with ITBIS 18 % on its pretax amount. An excluded line keeps
    /// a zero net, so it is shown but adds nothing.
    /// </summary>
    public static void ApplyItbis(PreinvoiceLine line, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(line);
        var net = line.IsExcluded ? 0m : decimal.Round(line.ComputedAmount ?? line.NetAmount ?? line.Amount, 2,
            MidpointRounding.AwayFromZero);
        line.TaxPolicyPublicId = ItbisPolicyId;
        line.TaxTreatment = FinanceTaxTreatment.Taxable;
        line.TaxRate = ItbisRate;
        line.TaxBasis = ItbisBasis;
        line.NetAmount = net;
        line.DiscountAmount = 0m;
        line.TaxAmount = Tax(net);
        line.GrossAmount = net + line.TaxAmount;
        line.Amount = line.GrossAmount.Value;
        line.TaxCapturedAt = now;
    }
}

/// <summary>
/// The version (base64 rowversion) of an operation as the caller saw it: a stale one is <c>version_conflict</c>.
/// </summary>
public sealed record InvoiceOperationVersion(Guid OperationId, string Version);

/// <summary>
/// The request id is the idempotency key (ADR-0035). <see cref="OperationVersions"/> is optional while older
/// clients exist (expand, 4-N29); when sent it covers every operation exactly once.
/// </summary>
public sealed record IssueInvoiceRequest(Guid AccountId, Guid StationId, IReadOnlyList<Guid> OperationIds, Guid RequestId,
    IReadOnlyList<InvoiceOperationVersion>? OperationVersions = null);

public enum IssueInvoiceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
    Unprocessable,
}

public sealed record IssueInvoiceResult(Guid? InvoiceId, string? Number, string? FiscalNumber, decimal? Total,
    string? CurrencyCode, bool Replayed, IssueInvoiceFailure? Failure, string? Reason = null)
{
    public bool IsSuccess => InvoiceId.HasValue && Failure is null;

    public static IssueInvoiceResult Success(Guid id, string number, string fiscalNumber, decimal total, string currency,
        bool replayed) => new(id, number, fiscalNumber, total, currency, replayed, null);

    public static IssueInvoiceResult Failed(IssueInvoiceFailure failure, string? reason = null) =>
        new(null, null, null, null, null, false, failure, reason);
}

public interface IInvoiceIssuanceStore
{
    Task<IssueInvoiceResult> IssueAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default);

    /// <summary>4-N07: closes operations whose valuation is zero without an invoice, with a reason.</summary>
    Task<NoChargeClosureResult> CloseWithoutChargeAsync(NoChargeClosureCommand request,
        CancellationToken cancellationToken = default);
}

/// <summary>Finance issues one invoice for one operation or for several of the same airline (ADR-0035).</summary>
public sealed class IssueInvoiceHandler(
    Abstractions.Identity.IActorContextResolver actors, IInvoiceIssuanceStore store)
{
    public const string IssuePermission = "finance.invoicing.issue";

    public async Task<IssueInvoiceResult> HandleAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.AccountId == Guid.Empty) return IssueInvoiceResult.Failed(IssueInvoiceFailure.Unauthorized);
        if (request.StationId == Guid.Empty || request.RequestId == Guid.Empty || request.OperationIds is null ||
            request.OperationIds.Count < 1 || request.OperationIds.Any(id => id == Guid.Empty) ||
            request.OperationIds.Distinct().Count() != request.OperationIds.Count ||
            !CoversEveryOperation(request.OperationIds, request.OperationVersions))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.InvalidRequest);
        if (request.OperationIds.Count > FinanceInvoicePolicy.MaxOperations)
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.TooManyOperations);
        var actor = await actors.ResolveAsync(request.AccountId, cancellationToken);
        if (!Identity.ActorContextValidator.IsValid(actor, request.AccountId))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Unauthorized);
        if (!actor!.HasPermission(IssuePermission) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Forbidden, InvoicingCodes.Forbidden);
        return await store.IssueAsync(request, cancellationToken);
    }

    /// <summary>No versions (an older client), or one non-empty version per requested operation and nothing else.</summary>
    internal static bool CoversEveryOperation(IReadOnlyList<Guid> operationIds,
        IReadOnlyList<InvoiceOperationVersion>? versions) =>
        versions is null ||
        versions.Count == operationIds.Count && versions.All(item => item is not null &&
            !string.IsNullOrWhiteSpace(item.Version) && item.Version.Length <= 64) &&
        versions.Select(item => item.OperationId).Distinct().Count() == versions.Count &&
        versions.All(item => operationIds.Contains(item.OperationId));
}
