using System.Globalization;
using System.Text;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>
/// «Por facturar» (4-N06, 4-N16, 4-N18): one row per approved operation not invoiced nor closed without charge, from
/// the oldest to the newest, in pages of <see cref="Limit"/> after the opaque <see cref="Cursor"/>. The dates and the
/// airline are optional filters; without them every pending operation of the station is listed.
/// </summary>
public sealed record GetFinancePendingOperationsQuery(Guid AccountId, Guid StationId, DateOnly? From, DateOnly? To,
    Guid? AirlineId, string? Cursor, int Limit = GetFinancePendingOperationsHandler.DefaultLimit);

/// <summary>A billable service of the operation: what it is worth before packages, minimums and charges.</summary>
public sealed record FinancePendingServiceData(Guid ServiceId, string ServiceCode, string ServiceName, bool Ready,
    string? BlockingReason, decimal? Amount, int ChargeCount);

/// <summary>
/// A pending operation: its version (the expected version of an issuance or a closure), the lines it adds to an
/// invoice (<see cref="LineEstimate"/>: each service, its charges and its contractual minimum), the estimated net and
/// every reason that blocks it, valuation of its charges included (4-N18).
/// </summary>
public sealed record FinancePendingOperationData(Guid OperationId, string Version, string OperationCode,
    DateOnly OperationDate, Guid AirlineId, string AirlineName, string FlightNumber, string? ContractCode,
    string? CurrencyCode, int ServiceCount, int LineEstimate, decimal EstimatedNet, bool Ready,
    IReadOnlyList<string> BlockingReasons, IReadOnlyList<FinancePendingServiceData> Services);

/// <summary>The airlines with pending operations in the period, whatever the airline filter.</summary>
public sealed record FinancePendingAirlineData(Guid AirlineId, string AirlineName, int PendingCount);

public sealed record FinancePendingOperationsData(Guid StationId, IReadOnlyList<FinancePendingAirlineData> Airlines,
    IReadOnlyList<FinancePendingOperationData> Operations, string? NextCursor, int TotalPending);

public enum FinancePendingOperationsFailure { Unauthorized, Forbidden, InvalidRequest, NotFound }

public sealed record FinancePendingOperationsResult(FinancePendingOperationsData? Data,
    FinancePendingOperationsFailure? Failure)
{
    public bool IsSuccess => Data is not null && Failure is null;

    public static FinancePendingOperationsResult Success(FinancePendingOperationsData data) => new(data, null);

    public static FinancePendingOperationsResult Failed(FinancePendingOperationsFailure failure) => new(null, failure);
}

public interface IFinancePendingOperationsReadStore
{
    /// <summary>The page, or null when the account has no live access to the station.</summary>
    Task<FinancePendingOperationsData?> GetAsync(GetFinancePendingOperationsQuery query,
        CancellationToken cancellationToken = default);

    /// <summary>How many operations of the station wait for an invoice, or null without access (for Inicio).</summary>
    Task<int?> CountAsync(Guid accountId, Guid stationId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The position of a pending operation in «Por facturar»: operation date, operation code and operation id. The
/// cursor is that key in base64url; clients treat it as opaque.
/// </summary>
public readonly record struct FinancePendingKey(DateOnly OperationDate, string OperationCode, Guid OperationId)
    : IComparable<FinancePendingKey>
{
    public int CompareTo(FinancePendingKey other)
    {
        var byDate = OperationDate.CompareTo(other.OperationDate);
        if (byDate != 0) return byDate;
        var byCode = string.CompareOrdinal(OperationCode, other.OperationCode);
        return byCode != 0 ? byCode
            : string.CompareOrdinal(OperationId.ToString("D"), other.OperationId.ToString("D"));
    }

    public static bool operator <(FinancePendingKey left, FinancePendingKey right) => left.CompareTo(right) < 0;

    public static bool operator <=(FinancePendingKey left, FinancePendingKey right) => left.CompareTo(right) <= 0;

    public static bool operator >(FinancePendingKey left, FinancePendingKey right) => left.CompareTo(right) > 0;

    public static bool operator >=(FinancePendingKey left, FinancePendingKey right) => left.CompareTo(right) >= 0;

    public string Encode() => Convert.ToBase64String(Encoding.UTF8.GetBytes(
            $"{OperationDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}|{OperationId:D}|{OperationCode}"))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static bool TryDecode(string? cursor, out FinancePendingKey key)
    {
        key = default;
        if (string.IsNullOrWhiteSpace(cursor) || cursor.Length > 512 ||
            cursor.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_')))
            return false;
        var base64 = cursor.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        string text;
        try { text = Encoding.UTF8.GetString(Convert.FromBase64String(base64)); }
        catch (FormatException) { return false; }
        var parts = text.Split('|', 3);
        if (parts.Length != 3 || parts[2].Length is < 1 or > 64 ||
            !DateOnly.TryParseExact(parts[0], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None,
                out var date) ||
            !Guid.TryParseExact(parts[1], "D", out var id) || id == Guid.Empty)
            return false;
        key = new FinancePendingKey(date, parts[2], id);
        return true;
    }
}

/// <summary>«Por facturar» requires «Facturación» (finance.invoicing.read), AVIAM staff and the station's live scope.</summary>
public sealed class GetFinancePendingOperationsHandler(IActorContextResolver actors, IFinancePendingOperationsReadStore store)
{
    public const string ReadPermission = "finance.invoicing.read";
    public const int DefaultLimit = 50;
    public const int MaxLimit = 100;

    public async Task<FinancePendingOperationsResult> HandleAsync(GetFinancePendingOperationsQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.AccountId == Guid.Empty)
            return FinancePendingOperationsResult.Failed(FinancePendingOperationsFailure.Unauthorized);
        if (!IsValid(query)) return FinancePendingOperationsResult.Failed(FinancePendingOperationsFailure.InvalidRequest);

        var actor = await actors.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
            return FinancePendingOperationsResult.Failed(FinancePendingOperationsFailure.Unauthorized);
        if (!actor!.HasPermission(ReadPermission) || !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return FinancePendingOperationsResult.Failed(FinancePendingOperationsFailure.Forbidden);
        if (!actor.StationScopes.Any(scope => scope.StationId == query.StationId))
            return FinancePendingOperationsResult.Failed(FinancePendingOperationsFailure.NotFound);

        var data = await store.GetAsync(query, cancellationToken);
        return data is null
            ? FinancePendingOperationsResult.Failed(FinancePendingOperationsFailure.NotFound)
            : FinancePendingOperationsResult.Success(data);
    }

    /// <summary>A station, a page of 1 to 100, an ordered period and a cursor this read wrote.</summary>
    public static bool IsValid(GetFinancePendingOperationsQuery query) =>
        query.StationId != Guid.Empty && query.Limit is >= 1 and <= MaxLimit &&
        query.From != DateOnly.MinValue && query.To != DateOnly.MinValue &&
        (query.From is not { } from || query.To is not { } to || from <= to) &&
        query.AirlineId != Guid.Empty &&
        (query.Cursor is null || FinancePendingKey.TryDecode(query.Cursor, out _));
}
