using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations;

/// <summary>
/// A charter is a flight without a ground-handling contract (ADR-0033): OCC enters it as such, the
/// agent adds the services at Finance's base tariff, the carrier's representative signs the
/// «Solicitud de Servicio y Descargo de Responsabilidad» and pays in advance, Finance confirms it.
/// </summary>
public static partial class CharterRules
{
    /// <summary>The form states every charge in US dollars.</summary>
    public const string CurrencyCode = "USD";

    public const decimal MaxQuantity = 999m;

    [GeneratedRegex("^[A-Z0-9-]{4,40}$")]
    private static partial Regex Identification();

    [GeneratedRegex("^[A-Za-z0-9 /#.-]{2,80}$")]
    private static partial Regex Reference();

    /// <summary>ID or passport number as printed: uppercase letters, digits and dashes.</summary>
    public static string? NormalizeIdentification(string? value)
    {
        var normalized = value?.Replace(" ", string.Empty, StringComparison.Ordinal).Trim().ToUpperInvariant();
        return normalized is not null && Identification().IsMatch(normalized) ? normalized : null;
    }

    public static string? NormalizeText(string? value, int maxLength)
    {
        var normalized = string.Join(' ', (value ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return normalized.Length == 0 ? null : normalized.Length <= maxLength ? normalized : null;
    }

    public static bool IsValidQuantity(decimal quantity) =>
        quantity > 0 && quantity <= MaxQuantity && decimal.Round(quantity, 2) == quantity;

    public static string? NormalizeReference(string? value)
    {
        var normalized = value?.Trim();
        return normalized is not null && Reference().IsMatch(normalized) ? normalized : null;
    }

    /// <summary>The reason Finance reopens a confirmed prepayment (3-N24): 8 to 500 characters.</summary>
    public static string? NormalizeReopenReason(string? value) => NormalizeReason(value, 8);

    /// <summary>
    /// 4-N22: the reason Finance corrects a confirmed prepayment that was not applied yet: 5 to 500 characters, like the
    /// other reasons of phase 4.
    /// </summary>
    public static string? NormalizeCorrectionReason(string? value) => NormalizeReason(value, 5);

    /// <summary>A prepayment Finance can confirm: positive, at most 10 000 000 and with two decimals.</summary>
    public static bool IsValidPrepaymentAmount(decimal amount) =>
        amount > 0 && amount <= 10_000_000m && decimal.Round(amount, 2) == amount;

    /// <summary>The length of a treasury receipt's reference (<c>commercial.finance_treasury_receipts.reference</c>).</summary>
    public const int ReceiptReferenceLength = 120;

    /// <summary>
    /// 4-N22: the reference of the receipt a confirmed prepayment becomes, «PREPAGO» and the bank reference. With
    /// <paramref name="receiptId"/> (the airline already has a receipt with that reference: one transfer paid two of its
    /// charters, or Finance reversed the prepayment and confirmed it again with the same bank reference) the receipt's
    /// own id follows, so every receipt keeps a reference of its own; the bank reference is shortened to fit the column,
    /// never the id.
    /// </summary>
    public static string PrepaymentReceiptReference(string? bankReference, Guid? receiptId = null)
    {
        var reference = $"PREPAGO {bankReference}".Trim();
        var suffix = receiptId is { } id ? $" · {id:N}" : string.Empty;
        var room = ReceiptReferenceLength - suffix.Length;
        return (reference.Length <= room ? reference : reference[..room].TrimEnd()) + suffix;
    }

    private static string? NormalizeReason(string? value, int minimumLength)
    {
        var normalized = value?.Trim();
        return normalized is { Length: <= 500 } && normalized.Length >= minimumLength &&
               !normalized.Any(character => char.IsControl(character) && character is not ('\t' or '\n' or '\r'))
            ? normalized : null;
    }
}

/// <summary>Problem Details codes of the charter commands (3-N24, 4-N22).</summary>
public static class CharterCodes
{
    /// <summary>The prepayment is confirmed: no service is added until Finance reopens the quotation.</summary>
    public const string PrepaymentConfirmed = "charter_prepayment_confirmed";

    /// <summary>Only a confirmed prepayment is reopened.</summary>
    public const string PrepaymentNotConfirmed = "charter_prepayment_not_confirmed";

    /// <summary>
    /// 4-N22: the prepayment already became a receipt on the charter's invoice. It is not corrected nor reopened in
    /// place: Finance reverses that receipt in «Cobros», then reopens the prepayment and confirms it again.
    /// </summary>
    public const string PrepaymentApplied = "charter_prepayment_applied";

    /// <summary>
    /// 4-N22: the prepayment's receipt met a receipt of the airline posted at the same moment (the same reference, or
    /// the treasury account of the same invoice). Nothing was written: Finance re-reads the charter and confirms again.
    /// </summary>
    public const string PrepaymentReceiptConflict = "charter_prepayment_receipt_conflict";

    /// <summary>4-N22: an amount or a reference Finance cannot confirm (the charter commands' fallback code).</summary>
    public const string InvalidRequest = "invalid_charter_request";
}

/// <summary>A catalog service the agent can add to a charter, priced at Finance's base tariff.</summary>
public sealed record CharterCatalogItem(Guid ServiceDefinitionId, string Code, string Name, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);

public sealed record CharterView(Guid OperationId, Guid CharterId, string CurrencyCode, string? CarrierAddress,
    string? ChargesPayableBy, string PrepaymentStatus, decimal? PrepaymentAmount, IReadOnlyList<CharterCatalogItem> Catalog);

public sealed record CharterServiceWriteRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, Guid ServiceDefinitionId, decimal Quantity, Guid InstallationId, Guid IdempotencyKey,
    string? RequestId);

public sealed record CharterDetailsWriteRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, string? CarrierAddress, string? ChargesPayableBy, Guid InstallationId, Guid IdempotencyKey,
    string? RequestId);

/// <summary>
/// Outcome of a charter write from the tablet; <c>Code</c> is the receipt code of a refusal the tablet explains
/// (<c>charter_prepayment_confirmed</c>, 3-N24), and a replay of the device receipt answers the same one.
/// </summary>
public sealed record CharterWriteResult(CharterView? Data, RampExecutionWriteFailure? Failure, Guid? ReceiptId,
    string? Code = null)
{
    public bool IsSuccess => Data is not null;
}

/// <summary>
/// A charter as Finance follows it: what was served (a service not performed does not count, 3-N24), at what price,
/// and whether it was prepaid. <c>Version</c> is the agreement's rowversion in base64, the expected version of a
/// reopening.
/// </summary>
public sealed record CharterPrepaymentItem(Guid Id, Guid OperationId, string OperationCode, DateOnly OperationDate,
    string StationCode, string AirlineName, string CurrencyCode, decimal? ServicesTotal, bool RequestSigned,
    string PrepaymentStatus, decimal? PrepaymentAmount, string? PrepaymentReference, DateTimeOffset? PrepaymentConfirmedAt,
    string? Version = null);

public interface ICharterStore
{
    Task<CharterView?> ReadForAgentAsync(Guid accountId, IReadOnlyCollection<Guid> stations, Guid operationId,
        CancellationToken cancellationToken = default);

    Task<CharterWriteResult> AddServiceAsync(CharterServiceWriteRequest request, CancellationToken cancellationToken = default);

    Task<CharterWriteResult> UpdateDetailsAsync(CharterDetailsWriteRequest request,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CharterPrepaymentItem>> ListForFinanceAsync(IReadOnlyCollection<Guid> stations,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 4-N22: Finance confirms the prepayment with an Idempotency-Key and the version it saw. A pending one becomes
    /// confirmed and, when the charter's operation is already invoiced, settles that invoice in the same transaction (the
    /// excess stays as the airline's credit). The same amount and reference again change nothing; another amount or
    /// reference corrects it with <paramref name="reason"/> while it was never applied (<c>charter_prepayment_applied</c>).
    /// </summary>
    Task<MasterDataResult<CharterPrepaymentItem>> ConfirmPrepaymentAsync(Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid charterId, decimal amount, string reference, string? reason,
        string expectedVersion, Guid idempotencyKey, string? requestId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 3-N24: Finance reopens a confirmed prepayment (a new quotation) with its reason and the version it saw; the
    /// amount and reference stay until the next confirmation.
    /// </summary>
    Task<MasterDataResult<CharterPrepaymentItem>> ReopenPrepaymentAsync(Guid accountId, IReadOnlyCollection<Guid> stations,
        Guid charterId, string reason, string expectedVersion, Guid idempotencyKey, string? requestId,
        CancellationToken cancellationToken = default);
}

/// <summary>The charter from the tablet (agent) and from Finance (prepayment).</summary>
public sealed class CharterHandler(IActorContextResolver actors, ICharterStore store)
{
    public const string FinanceReadPermission = "finance.charters.read";
    public const string FinanceConfirmPermission = "finance.charters.confirm";

    public async Task<(CharterView? Data, RampOperationsFailure? Failure)> ReadForAgentAsync(Guid accountId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty) return (null, RampOperationsFailure.InvalidRequest);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        var view = await store.ReadForAgentAsync(accountId, stations!, operationId, cancellationToken);
        return view is null ? (null, RampOperationsFailure.NotFound) : (view, null);
    }

    /// <summary>
    /// Adds a service to the charter; with the prepayment confirmed it is refused with <c>charter_prepayment_confirmed</c>
    /// (3-N24) until Finance reopens the quotation.
    /// </summary>
    public async Task<(CharterView? Data, RampOperationsFailure? Failure, string? Code)> AddServiceAsync(Guid accountId,
        Guid operationId, Guid serviceDefinitionId, decimal quantity, Guid installationId, Guid idempotencyKey,
        string? requestId, CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty || serviceDefinitionId == Guid.Empty || installationId == Guid.Empty ||
            idempotencyKey == Guid.Empty || !CharterRules.IsValidQuantity(quantity))
            return (null, RampOperationsFailure.InvalidRequest, null);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure, null);
        var result = await store.AddServiceAsync(new CharterServiceWriteRequest(accountId, stations!, operationId,
            serviceDefinitionId, quantity, installationId, idempotencyKey, requestId), cancellationToken);
        var (data, writeFailure) = Map(result);
        return (data, writeFailure, result.IsSuccess ? null : result.Code);
    }

    public async Task<(CharterView? Data, RampOperationsFailure? Failure)> UpdateDetailsAsync(Guid accountId,
        Guid operationId, string? carrierAddress, string? chargesPayableBy, Guid installationId, Guid idempotencyKey,
        string? requestId, CancellationToken cancellationToken = default)
    {
        var address = CharterRules.NormalizeText(carrierAddress, 300);
        var payableBy = CharterRules.NormalizeText(chargesPayableBy, 160);
        if (operationId == Guid.Empty || installationId == Guid.Empty || idempotencyKey == Guid.Empty ||
            (carrierAddress is not null && carrierAddress.Trim().Length > 0 && address is null) ||
            (chargesPayableBy is not null && chargesPayableBy.Trim().Length > 0 && payableBy is null))
            return (null, RampOperationsFailure.InvalidRequest);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        return Map(await store.UpdateDetailsAsync(new CharterDetailsWriteRequest(accountId, stations!, operationId, address,
            payableBy, installationId, idempotencyKey, requestId), cancellationToken));
    }

    public async Task<(IReadOnlyList<CharterPrepaymentItem>? Items, OccReviewFailure? Failure)> ListForFinanceAsync(
        Guid accountId, CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await FinanceStationsAsync(accountId, FinanceReadPermission, cancellationToken);
        return failure is not null ? (null, failure) : (await store.ListForFinanceAsync(stations!, cancellationToken), null);
    }

    /// <summary>
    /// 4-N22: Finance confirms the prepayment with an Idempotency-Key and the version it saw (<c>finance.charters.confirm</c>).
    /// A reason (5 to 500 characters) is what corrects a confirmed prepayment that was never applied; without one, a
    /// correction is <c>reason_required</c>.
    /// </summary>
    public async Task<(CharterPrepaymentItem? Item, OccReviewFailure? Failure, string? Code)> ConfirmPrepaymentAsync(
        Guid accountId, Guid charterId, decimal amount, string? reference, string? reason, string? expectedVersion,
        Guid? idempotencyKey, string? requestId, CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await FinanceStationsAsync(accountId, FinanceConfirmPermission, cancellationToken);
        if (failure is not null) return (null, failure, null);
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return (null, OccReviewFailure.InvalidRequest, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(expectedVersion))
            return (null, OccReviewFailure.InvalidRequest, "expected_version_required");
        var normalized = CharterRules.NormalizeReference(reference);
        if (!CharterRules.IsValidPrepaymentAmount(amount) || normalized is null)
            return (null, OccReviewFailure.InvalidRequest, CharterCodes.InvalidRequest);
        string? correction = null;
        if (!string.IsNullOrWhiteSpace(reason) && (correction = CharterRules.NormalizeCorrectionReason(reason)) is null)
            return (null, OccReviewFailure.InvalidRequest, "reason_required");
        if (charterId == Guid.Empty) return (null, OccReviewFailure.NotFound, "not_found");
        var result = await store.ConfirmPrepaymentAsync(accountId, stations!, charterId, amount, normalized, correction,
            expectedVersion.Trim(), key, requestId, cancellationToken);
        return Map(result);
    }

    /// <summary>
    /// 3-N24: Finance reopens a confirmed prepayment with a reason (8 to 500 characters), the version it saw and an
    /// Idempotency-Key; <c>finance.charters.confirm</c> is the permission, the same one that confirms it.
    /// </summary>
    public async Task<(CharterPrepaymentItem? Item, OccReviewFailure? Failure, string? Code)> ReopenPrepaymentAsync(
        Guid accountId, Guid charterId, string? reason, string? expectedVersion, Guid? idempotencyKey, string? requestId,
        CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await FinanceStationsAsync(accountId, FinanceConfirmPermission, cancellationToken);
        if (failure is not null) return (null, failure, null);
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return (null, OccReviewFailure.InvalidRequest, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(expectedVersion))
            return (null, OccReviewFailure.InvalidRequest, "expected_version_required");
        if (CharterRules.NormalizeReopenReason(reason) is not { } normalized)
            return (null, OccReviewFailure.InvalidRequest, "reason_required");
        if (charterId == Guid.Empty) return (null, OccReviewFailure.NotFound, "not_found");
        var result = await store.ReopenPrepaymentAsync(accountId, stations!, charterId, normalized, expectedVersion.Trim(),
            key, requestId, cancellationToken);
        return Map(result);
    }

    private static (CharterPrepaymentItem? Item, OccReviewFailure? Failure, string? Code) Map(
        MasterDataResult<CharterPrepaymentItem> result) => result.Failure switch
    {
        null => (result.Value, null, null),
        MasterDataFailure.NotFound => (null, OccReviewFailure.NotFound, result.Code),
        MasterDataFailure.Forbidden => (null, OccReviewFailure.Forbidden, null),
        MasterDataFailure.Invalid => (null, OccReviewFailure.InvalidRequest, result.Code),
        _ => (null, OccReviewFailure.Conflict, result.Code),
    };

    private async Task<(Guid[]? Stations, RampOperationsFailure? Failure)> RampStationsAsync(Guid accountId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (null, RampOperationsFailure.Unauthorized);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return (null, RampOperationsFailure.Unauthorized);
        if (!RampOperationsAccess.IsAuthorized(actor!)) return (null, RampOperationsFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0 ? (null, RampOperationsFailure.NotFound) : (stations, null);
    }

    private async Task<(Guid[]? Stations, OccReviewFailure? Failure)> FinanceStationsAsync(Guid accountId,
        string permission, CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (null, OccReviewFailure.Unauthorized);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return (null, OccReviewFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!, permission)) return (null, OccReviewFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0 ? (null, OccReviewFailure.NotFound) : (stations, null);
    }

    private static (CharterView?, RampOperationsFailure?) Map(CharterWriteResult result) => result.IsSuccess
        ? (result.Data, null)
        : (null, result.Failure switch
        {
            RampExecutionWriteFailure.Forbidden => RampOperationsFailure.Forbidden,
            RampExecutionWriteFailure.NotFound => RampOperationsFailure.NotFound,
            _ => RampOperationsFailure.Conflict,
        });
}
