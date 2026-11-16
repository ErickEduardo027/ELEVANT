using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// 3-N04: a contract that stops being in force (suspended, terminated or expired) stops enabling operations. OCC hears
/// it once per operation the airline still had planned or assigned from today on at the contract's stations, unless
/// another contract still covers it (<see cref="ApplicableContracts"/>): the tablet will refuse to start it
/// (<c>contract_not_in_force</c>) and OCC decides what to do with the flight. Operations already in progress end
/// normally and are not listed; a charter flight has no contract (ADR-0033). Runs in the lifecycle change's transaction.
/// </summary>
internal static class ContractOperationsNotice
{
    /// <summary>Operational notice to OCC (never to the tablet).</summary>
    public const string Kind = "contract_not_in_force";

    public static async Task NotifyOccAsync(ElevantDbContext context, Contract contract, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                              join version in context.ContractVersions.AsNoTracking() on link.ContractVersionId equals version.Id
                              where version.ContractId == contract.Id
                              select link.StationId).Distinct().ToArrayAsync(cancellationToken);
        if (stations.Length == 0) return;
        var zones = await context.Stations.AsNoTracking().Where(station => stations.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.IanaTimeZone, cancellationToken);
        // The earliest «today» of the stations; each station's own day decides below.
        var since = BusinessCalendar.Today(now).AddDays(-1);
        var rows = await (from operation in context.GroundOperations.AsNoTracking()
                          join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                          where turnaround.AirlineId == contract.AirlineId && stations.Contains(turnaround.StationId) &&
                                turnaround.OperationDate >= since &&
                                // Enums stored as text: explicit comparisons, never an array Contains.
                                (operation.CurrentStatus == GroundOperationStatus.Planned ||
                                 operation.CurrentStatus == GroundOperationStatus.Assigned) &&
                                turnaround.CurrentStatus != TurnaroundStatus.Completed &&
                                turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                                turnaround.CurrentStatus != TurnaroundStatus.Diverted &&
                                !context.Set<CharterAgreement>().Any(charter => charter.TurnaroundId == turnaround.Id)
                          select new { operation.Id, turnaround.StationId, turnaround.OperationDate })
            .ToArrayAsync(cancellationToken);
        if (rows.Length == 0) return;

        // The contracts this transaction already took out of force are not «another contract» either (the sweep changes
        // several before it saves).
        var leaving = context.ChangeTracker.Entries<Contract>()
            .Where(entry => entry.Entity.Status != ContractStatus.Active).Select(entry => entry.Entity.Id).ToHashSet();
        leaving.Add(contract.Id);
        var leavingIds = leaving.ToArray();
        foreach (var day in rows.Where(row => row.OperationDate >= BusinessCalendar.Today(now, zones.GetValueOrDefault(row.StationId)))
                     .GroupBy(row => (row.StationId, row.OperationDate)))
        {
            if (await ApplicableContracts.For(context, contract.AirlineId, day.Key.StationId, day.Key.OperationDate)
                    .AnyAsync(row => !leavingIds.Contains(row.ContractId), cancellationToken))
                continue;
            // Each change is its own source: a contract suspended, reactivated and suspended again notifies again.
            foreach (var operation in day)
                await OperationalNotificationWriter.NotifyOccAsync(context, day.Key.StationId, operation.Id,
                    Guid.CreateVersion7(), Kind, now, null, cancellationToken);
        }
    }
}
