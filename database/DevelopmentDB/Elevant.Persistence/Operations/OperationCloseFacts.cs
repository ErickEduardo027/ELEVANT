using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The recorded times and Finance rules an operation is closed with (ADR-0034): block-on and
/// push-back (or the operation's start and hand-off), the arrival, the station's zone, the aircraft
/// category with Finance's allowance and the holiday calendar. Read once, used by the automatic
/// surcharges and frozen in the evidence.
/// </summary>
internal sealed record OperationCloseFacts(
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    DateTimeOffset? ArrivalScheduledAt,
    DateTimeOffset? ArrivalActualAt,
    TimeZoneInfo StationZone,
    AircraftSizeCategory? Category,
    int? AllowedGroundMinutes,
    IReadOnlySet<DateOnly> Holidays)
{
    public const string BlockOn = "BLOCK_ON";
    public const string Pushback = "PUSHBACK";

    public decimal? GroundMinutes => AutomaticSurchargePolicy.GroundMinutes(StartedAt, EndedAt);

    public decimal? ArrivalDelayMinutes => AutomaticSurchargePolicy.GroundMinutes(ArrivalScheduledAt, ArrivalActualAt);

    public AutomaticSurchargeInput ToSurchargeInput() => new(StartedAt, EndedAt, ArrivalScheduledAt, ArrivalActualAt,
        StationZone, Holidays, AllowedGroundMinutes);

    /// <param name="handedOffAt">End used when push-back was not recorded: the hand-off moment.</param>
    public static async Task<OperationCloseFacts> LoadAsync(ElevantDbContext context, long operationId,
        DateTimeOffset? handedOffAt, CancellationToken cancellationToken)
    {
        var core = await (from operation in context.GroundOperations.AsNoTracking()
                          join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                          join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                          where operation.Id == operationId
                          select new
                          {
                              operation.TurnaroundId, operation.ActualStartAt, operation.ActualEndAt, station.IanaTimeZone,
                              Category = context.AircraftTypes.Where(type => type.Id == turnaround.AircraftTypeId)
                                  .Select(type => type.SizeCategory).FirstOrDefault(),
                          }).SingleAsync(cancellationToken);
        var milestones = await context.Set<OperationMilestone>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && item.ActualAt != null &&
                (item.Code == BlockOn || item.Code == Pushback))
            .Select(item => new { item.Code, item.ActualAt }).ToArrayAsync(cancellationToken);
        var arrivals = await context.FlightLegs.AsNoTracking()
            .Where(leg => leg.TurnaroundId == core.TurnaroundId && leg.Direction == FlightDirection.Arrival)
            .Select(leg => new { leg.ScheduledAt, leg.ActualAt }).ToArrayAsync(cancellationToken);
        var arrival = arrivals.Length == 1 ? arrivals[0] : null;
        int? allowed = core.Category is { } category
            ? await context.GroundTimeAllowances.AsNoTracking().Where(item => item.SizeCategory == category)
                .Select(item => (int?)item.AllowedMinutes).FirstOrDefaultAsync(cancellationToken)
            : null;
        var holidays = await context.FinanceHolidays.AsNoTracking().Where(item => item.RemovedAt == null)
            .Select(item => item.Date).ToArrayAsync(cancellationToken);
        var zone = TimeZoneInfo.TryFindSystemTimeZoneById(core.IanaTimeZone, out var found) ? found : TimeZoneInfo.Utc;
        return new OperationCloseFacts(
            milestones.FirstOrDefault(item => item.Code == BlockOn)?.ActualAt ?? core.ActualStartAt,
            milestones.FirstOrDefault(item => item.Code == Pushback)?.ActualAt ?? handedOffAt ?? core.ActualEndAt,
            arrival?.ScheduledAt, arrival?.ActualAt, zone, core.Category, allowed, holidays.ToHashSet());
    }
}
