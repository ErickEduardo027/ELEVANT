using Elevant.Domain.Enumerations;

namespace Elevant.Application.Abstractions.Integration;

/// <summary>
/// Units already spent with a provider (ADR-0028): those of one operation today and this month (UTC), and those of every
/// operation of the provider this month, the ceiling all of them share.
/// </summary>
public sealed record ProviderUsageTotals(int OperationToday, int OperationThisMonth, int ProviderThisMonth);

/// <summary>One on-demand reference call, as the usage ledger records it.</summary>
public sealed record ProviderUsageRecord(string Provider, string Operation, Guid? StationId, int Units, int? HttpStatus,
    ProviderCallOutcome Outcome, ProviderCallTrigger Trigger, Guid? RequestedBy, int ItemsReceived, DateTimeOffset OccurredAt);

/// <summary>
/// The usage ledger <c>integration.provider_usage_entries</c> for the reads that are not the flight feed: append-only, one
/// row per call, summed by UTC day and UTC month.
/// </summary>
public interface IProviderUsageLedger
{
    Task<ProviderUsageTotals> GetTotalsAsync(string provider, string operation, DateTimeOffset now,
        CancellationToken cancellationToken = default);

    Task RecordAsync(ProviderUsageRecord record, CancellationToken cancellationToken = default);
}
