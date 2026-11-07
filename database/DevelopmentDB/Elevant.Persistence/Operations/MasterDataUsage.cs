using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// When master data is in use or has history (2-A). In use blocks a deactivation: an unfinished flight from
/// the day before the station's business day on, an open coverage or a scheduled shift, a live contract. History
/// (anything that ever pointed at it) fixes a code or a time zone, so the past keeps reading the same.
/// </summary>
internal static class MasterDataUsage
{
    /// <summary>Overnight operations started the day before still hold their stand.</summary>
    public static DateOnly Since(DateOnly today) => today.AddDays(-1);

    /// <summary>A stand is in use while an unfinished flight holds it or an open coverage includes it.</summary>
    public static async Task<bool> StandInUseAsync(ElevantDbContext context, long standId, DateOnly since, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        await (from assignment in context.Set<StandAssignment>().AsNoTracking()
               join turnaround in context.Turnarounds.AsNoTracking() on assignment.TurnaroundId equals turnaround.Id
               where assignment.StandId == standId && assignment.AssignedTo == null && turnaround.OperationDate >= since &&
                     (turnaround.CurrentStatus == TurnaroundStatus.Scheduled ||
                      turnaround.CurrentStatus == TurnaroundStatus.Confirmed ||
                      turnaround.CurrentStatus == TurnaroundStatus.InProgress) &&
                     !context.GroundOperations.Any(operation => operation.TurnaroundId == turnaround.Id &&
                         (operation.CurrentStatus == GroundOperationStatus.PendingReview ||
                          operation.CurrentStatus == GroundOperationStatus.InReview ||
                          operation.CurrentStatus == GroundOperationStatus.Approved ||
                          operation.CurrentStatus == GroundOperationStatus.Cancelled))
               select assignment.Id).AnyAsync(cancellationToken) ||
        await (from link in context.Set<PositionCoverageStand>().AsNoTracking()
               join coverage in context.Set<PositionCoverage>().AsNoTracking() on link.PositionCoverageId equals coverage.Id
               where link.StandId == standId && coverage.ReleasedAt == null && coverage.EndsAt > now
               select link.Id).AnyAsync(cancellationToken);

    /// <summary>A terminal is in use while it has active stands, an open coverage or shifts from today on.</summary>
    public static async Task<bool> TerminalInUseAsync(ElevantDbContext context, long terminalId, DateOnly today,
        DateTimeOffset now, CancellationToken cancellationToken) =>
        await context.Stands.AsNoTracking().AnyAsync(stand => stand.TerminalId == terminalId && stand.IsActive,
            cancellationToken) ||
        await context.Set<PositionCoverage>().AsNoTracking().AnyAsync(coverage => coverage.TerminalId == terminalId &&
            coverage.ReleasedAt == null && coverage.EndsAt > now, cancellationToken) ||
        await context.ShiftAssignments.AsNoTracking().AnyAsync(shift => shift.TerminalId == terminalId &&
            shift.WorkDate >= today, cancellationToken);

    /// <summary>An aircraft type is in use while an unfinished flight from <paramref name="since"/> on has it.</summary>
    public static Task<bool> AircraftTypeInUseAsync(ElevantDbContext context, long aircraftTypeId, DateOnly since,
        CancellationToken cancellationToken) =>
        context.Turnarounds.AsNoTracking().AnyAsync(turnaround => turnaround.AircraftTypeId == aircraftTypeId &&
            turnaround.OperationDate >= since &&
            (turnaround.CurrentStatus == TurnaroundStatus.Scheduled ||
             turnaround.CurrentStatus == TurnaroundStatus.Confirmed ||
             turnaround.CurrentStatus == TurnaroundStatus.InProgress), cancellationToken);

    /// <summary>A station is in use while a live contract covers it or an unfinished flight is planned there.</summary>
    public static async Task<bool> StationInUseAsync(ElevantDbContext context, long stationId, DateOnly since,
        CancellationToken cancellationToken) =>
        await (from contract in context.Contracts.AsNoTracking()
               join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
               where (contract.Status == ContractStatus.Draft || contract.Status == ContractStatus.Active ||
                      contract.Status == ContractStatus.Suspended) &&
                     context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id &&
                         link.StationId == stationId)
               select contract.Id).AnyAsync(cancellationToken) ||
        await context.Turnarounds.AsNoTracking().AnyAsync(turnaround => turnaround.StationId == stationId &&
            turnaround.OperationDate >= since &&
            (turnaround.CurrentStatus == TurnaroundStatus.Scheduled ||
             turnaround.CurrentStatus == TurnaroundStatus.Confirmed ||
             turnaround.CurrentStatus == TurnaroundStatus.InProgress), cancellationToken);

    /// <summary>Stations something ever pointed at: flights, shifts, coverages, contracts, requests, proposals.</summary>
    public static async Task<HashSet<long>> StationsWithHistoryAsync(ElevantDbContext context,
        CancellationToken cancellationToken)
    {
        var ids = new HashSet<long>();
        ids.UnionWith(await context.Turnarounds.AsNoTracking().Select(item => item.StationId).Distinct()
            .ToArrayAsync(cancellationToken));
        ids.UnionWith(await context.ShiftAssignments.AsNoTracking().Select(item => item.StationId).Distinct()
            .ToArrayAsync(cancellationToken));
        ids.UnionWith(await context.Set<PositionCoverage>().AsNoTracking().Select(item => item.StationId).Distinct()
            .ToArrayAsync(cancellationToken));
        ids.UnionWith(await context.Set<ContractVersionStation>().AsNoTracking().Select(item => item.StationId).Distinct()
            .ToArrayAsync(cancellationToken));
        ids.UnionWith(await context.Set<ServiceRequestStation>().AsNoTracking().Select(item => item.StationId).Distinct()
            .ToArrayAsync(cancellationToken));
        ids.UnionWith(await context.Set<ExternalFlightProposal>().AsNoTracking().Select(item => item.StationId).Distinct()
            .ToArrayAsync(cancellationToken));
        return ids;
    }

    /// <summary>Stands of the station that flights or coverages ever used.</summary>
    public static async Task<HashSet<long>> StandsWithHistoryAsync(ElevantDbContext context, long stationId,
        CancellationToken cancellationToken)
    {
        var ids = new HashSet<long>(await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                                           join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                                           where stand.StationId == stationId
                                           select stand.Id).Distinct().ToArrayAsync(cancellationToken));
        ids.UnionWith(await (from link in context.Set<PositionCoverageStand>().AsNoTracking()
                             join stand in context.Stands.AsNoTracking() on link.StandId equals stand.Id
                             where stand.StationId == stationId
                             select stand.Id).Distinct().ToArrayAsync(cancellationToken));
        return ids;
    }

    /// <summary>Terminals of the station with coverages or shifts, or with a stand that has history.</summary>
    public static async Task<HashSet<long>> TerminalsWithHistoryAsync(ElevantDbContext context, long stationId,
        IReadOnlySet<long> standsWithHistory, CancellationToken cancellationToken)
    {
        var ids = new HashSet<long>(await context.Set<PositionCoverage>().AsNoTracking()
            .Where(item => item.StationId == stationId).Select(item => item.TerminalId).Distinct()
            .ToArrayAsync(cancellationToken));
        ids.UnionWith(await context.ShiftAssignments.AsNoTracking().Where(item => item.StationId == stationId)
            .Select(item => item.TerminalId).Distinct().ToArrayAsync(cancellationToken));
        var standIds = standsWithHistory.ToArray();
        ids.UnionWith(await context.Stands.AsNoTracking()
            .Where(stand => standIds.Contains(stand.Id) && stand.TerminalId != null)
            .Select(stand => stand.TerminalId!.Value).Distinct().ToArrayAsync(cancellationToken));
        return ids;
    }
}
