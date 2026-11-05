using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>Ground time Finance allows per aircraft category (ADR-0034).</summary>
public sealed record GroundTimeAllowanceData(string Category, int AllowedMinutes, DateTimeOffset UpdatedAt, string Version);

public sealed record FinanceHolidayData(Guid Id, DateOnly Date, string Name);

/// <summary>What the automatic surcharges read: allowances and the holiday calendar.</summary>
public sealed record FinanceCloseRulesData(
    IReadOnlyList<GroundTimeAllowanceData> Allowances, IReadOnlyList<FinanceHolidayData> Holidays);

public enum FinanceCloseRulesFailure
{
    InvalidRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
}

public interface IFinanceCloseRulesStore
{
    Task<FinanceCloseRulesData> ReadAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates or changes one category; <paramref name="expectedVersion"/> must match an existing row.</summary>
    Task<(GroundTimeAllowanceData? Data, FinanceCloseRulesFailure? Failure)> SetAllowanceAsync(Guid accountId,
        AircraftSizeCategory category, int allowedMinutes, string? expectedVersion, string? requestId,
        CancellationToken cancellationToken = default);

    /// <summary>Adds a holiday; the same date and name again is a replay, another name on that date a conflict.</summary>
    Task<(FinanceHolidayData? Data, FinanceCloseRulesFailure? Failure)> AddHolidayAsync(Guid accountId, DateOnly date,
        string name, string? requestId, CancellationToken cancellationToken = default);

    Task<FinanceCloseRulesFailure?> RemoveHolidayAsync(Guid accountId, Guid holidayId, string? requestId,
        CancellationToken cancellationToken = default);
}

public static class FinanceCloseRulesPolicy
{
    public const int MinAllowedMinutes = 15;
    public const int MaxAllowedMinutes = 720;

    public static bool IsValidMinutes(int minutes) => minutes is >= MinAllowedMinutes and <= MaxAllowedMinutes;

    public static string? NormalizeName(string? name)
    {
        var value = string.Join(' ', (name ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return value.Length is >= 2 and <= 120 ? value : null;
    }

    public static bool IsValidDate(DateOnly date) => date.Year is >= 2000 and <= 2100;

    public static AircraftSizeCategory? ParseCategory(string? value) =>
        Enum.TryParse<AircraftSizeCategory>(value, true, out var category) && Enum.IsDefined(category) ? category : null;
}

public sealed class FinanceCloseRulesHandler(IActorContextResolver actors, IFinanceCloseRulesStore store)
{
    public const string ReadPermission = "finance.close_rules.read";
    public const string UpdatePermission = "finance.close_rules.update";

    public async Task<(FinanceCloseRulesData? Data, FinanceCloseRulesFailure? Failure)> ReadAsync(Guid accountId,
        CancellationToken cancellationToken = default)
    {
        var failure = await AuthorizeAsync(accountId, ReadPermission, cancellationToken);
        return failure is not null ? (null, failure) : (await store.ReadAsync(cancellationToken), null);
    }

    public async Task<(GroundTimeAllowanceData? Data, FinanceCloseRulesFailure? Failure)> SetAllowanceAsync(
        Guid accountId, string? category, int allowedMinutes, string? expectedVersion, string? requestId,
        CancellationToken cancellationToken = default)
    {
        var parsed = FinanceCloseRulesPolicy.ParseCategory(category);
        if (parsed is null || !FinanceCloseRulesPolicy.IsValidMinutes(allowedMinutes) ||
            (expectedVersion is not null && expectedVersion.Length > 64))
            return (null, FinanceCloseRulesFailure.InvalidRequest);
        var failure = await AuthorizeAsync(accountId, UpdatePermission, cancellationToken);
        return failure is not null ? (null, failure)
            : await store.SetAllowanceAsync(accountId, parsed.Value, allowedMinutes, expectedVersion, requestId,
                cancellationToken);
    }

    public async Task<(FinanceHolidayData? Data, FinanceCloseRulesFailure? Failure)> AddHolidayAsync(Guid accountId,
        DateOnly date, string? name, string? requestId, CancellationToken cancellationToken = default)
    {
        var normalized = FinanceCloseRulesPolicy.NormalizeName(name);
        if (normalized is null || !FinanceCloseRulesPolicy.IsValidDate(date))
            return (null, FinanceCloseRulesFailure.InvalidRequest);
        var failure = await AuthorizeAsync(accountId, UpdatePermission, cancellationToken);
        return failure is not null ? (null, failure)
            : await store.AddHolidayAsync(accountId, date, normalized, requestId, cancellationToken);
    }

    public async Task<FinanceCloseRulesFailure?> RemoveHolidayAsync(Guid accountId, Guid holidayId, string? requestId,
        CancellationToken cancellationToken = default)
    {
        if (holidayId == Guid.Empty) return FinanceCloseRulesFailure.InvalidRequest;
        return await AuthorizeAsync(accountId, UpdatePermission, cancellationToken)
            ?? await store.RemoveHolidayAsync(accountId, holidayId, requestId, cancellationToken);
    }

    private async Task<FinanceCloseRulesFailure?> AuthorizeAsync(Guid accountId, string permission,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return FinanceCloseRulesFailure.Unauthorized;
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return FinanceCloseRulesFailure.Unauthorized;
        return OccPlanningAccess.IsAuthorized(actor!, permission) ? null : FinanceCloseRulesFailure.Forbidden;
    }
}
