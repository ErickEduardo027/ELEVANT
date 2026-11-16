using Elevant.Application.Abstractions.Integration;
using Elevant.Domain.Entities.Integration;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>
/// The usage ledger of the on-demand reference reads (ADR-0028, note of 15 November 2026): the same append-only
/// <c>integration.provider_usage_entries</c> as the flight feed, one row per call, with the read as its operation.
/// </summary>
internal sealed class EfProviderUsageLedger(ElevantDbContext context) : IProviderUsageLedger
{
    public async Task<ProviderUsageTotals> GetTotalsAsync(string provider, string operation, DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var (dayStart, monthStart) = EfFlightFeedSyncStore.UsagePeriods(now);
        var month = context.Set<ProviderUsageEntry>().AsNoTracking()
            .Where(entry => entry.Provider == provider && entry.OccurredAt >= monthStart);
        var providerMonth = await month.SumAsync(entry => entry.Units, cancellationToken);
        var operationMonth = await month.Where(entry => entry.Operation == operation)
            .SumAsync(entry => entry.Units, cancellationToken);
        var operationToday = await month.Where(entry => entry.Operation == operation && entry.OccurredAt >= dayStart)
            .SumAsync(entry => entry.Units, cancellationToken);
        return new ProviderUsageTotals(operationToday, operationMonth, providerMonth);
    }

    public async Task RecordAsync(ProviderUsageRecord record, CancellationToken cancellationToken = default)
    {
        var stationId = record.StationId is { } station
            ? await context.Stations.AsNoTracking().Where(item => item.PublicId == station).Select(item => (long?)item.Id)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        var requestedBy = record.RequestedBy is { } actor
            ? await context.Users.AsNoTracking().Where(user => user.PublicId == actor).Select(user => (long?)user.Id)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        context.Set<ProviderUsageEntry>().Add(new ProviderUsageEntry
        {
            PublicId = Guid.CreateVersion7(), Provider = record.Provider, Operation = record.Operation, StationId = stationId,
            Units = Math.Max(0, record.Units), HttpStatus = record.HttpStatus, Outcome = record.Outcome,
            Trigger = record.Trigger, RequestedByAccountId = requestedBy, OccurredAt = record.OccurredAt,
            FlightsReceived = Math.Max(0, record.ItemsReceived), CreatedAt = record.OccurredAt, UpdatedAt = record.OccurredAt,
        });
        await context.SaveChangesAsync(cancellationToken);
    }
}
