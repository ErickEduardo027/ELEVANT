using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>Phase 3, block A: what OCC may change on a turnaround and when (3-A, 3-B, 3-N08, 3-N21).</summary>
public sealed class OccTurnaroundRulesTests
{
    [Theory]
    [InlineData(TurnaroundStatus.Scheduled, GroundOperationStatus.Planned, null)]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.Assigned, null)]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.Planned, null)]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.Assigned, null)]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, "operation_started")]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.PendingReview, "operation_started")]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.Returned, "operation_started")]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.Approved, "operation_started")]
    [InlineData(TurnaroundStatus.Completed, GroundOperationStatus.Approved, "turnaround_closed")]
    [InlineData(TurnaroundStatus.Cancelled, GroundOperationStatus.Cancelled, "turnaround_closed")]
    [InlineData(TurnaroundStatus.Diverted, GroundOperationStatus.Cancelled, "turnaround_closed")]
    public void AFlightChangesOnlyBeforeItsOperationStarts(TurnaroundStatus turnaround, GroundOperationStatus operation,
        string? failure)
    {
        Assert.Equal(failure, OccTurnaroundRules.BeforeStartFailure(turnaround, operation));
        Assert.Equal(failure is null, OccTurnaroundRules.CanChangeBeforeStart(turnaround, operation));
    }

    [Fact]
    public void ATurnaroundWithoutOperationIsStillAPlan()
    {
        Assert.True(OccTurnaroundRules.CanChangeBeforeStart(TurnaroundStatus.Confirmed, null));
        Assert.Null(OccTurnaroundRules.BeforeStartFailure(TurnaroundStatus.Scheduled, null));
    }

    [Theory]
    [InlineData("Cancelled", TurnaroundStatus.Cancelled)]
    [InlineData("Diverted", TurnaroundStatus.Diverted)]
    [InlineData("cancelled", null)]
    [InlineData("Completed", null)]
    [InlineData("4", null)]
    [InlineData(null, null)]
    public void TheOutcomeIsCancelledOrDivertedByName(string? value, TurnaroundStatus? expected) =>
        Assert.Equal(expected, OccTurnaroundRules.ParseOutcome(value));

    [Fact]
    public void TheReasonHasFiveToFiveHundredCharacters()
    {
        Assert.Null(OccTurnaroundRules.Reason(null));
        Assert.Null(OccTurnaroundRules.Reason("  ab  "));
        Assert.Equal("Error de carga", OccTurnaroundRules.Reason("  Error de carga  "));
        Assert.Equal(500, OccTurnaroundRules.Reason(new string('x', 500))!.Length);
        Assert.Null(OccTurnaroundRules.Reason(new string('x', 501)));
    }

    [Fact]
    public void TheScheduleIsUtcAndAtMostADayLong()
    {
        var arrival = new DateTimeOffset(2026, 11, 5, 16, 0, 0, TimeSpan.Zero);
        Assert.True(OccTurnaroundRules.IsValidSchedule(arrival, arrival.AddHours(2)));
        Assert.True(OccTurnaroundRules.IsValidSchedule(arrival, arrival.AddHours(24)));
        Assert.False(OccTurnaroundRules.IsValidSchedule(arrival, arrival.AddHours(24).AddMinutes(1)));
        Assert.False(OccTurnaroundRules.IsValidSchedule(arrival, arrival));
        Assert.False(OccTurnaroundRules.IsValidSchedule(arrival.ToOffset(TimeSpan.FromHours(-4)), arrival.AddHours(2)));
    }

    [Theory]
    [InlineData(GroundOperationStatus.Planned, false, true)]
    [InlineData(GroundOperationStatus.Assigned, false, true)]
    [InlineData(GroundOperationStatus.InProgress, false, true)]
    [InlineData(GroundOperationStatus.InProgress, true, false)]
    [InlineData(GroundOperationStatus.Returned, true, false)]
    [InlineData(GroundOperationStatus.PendingReview, true, false)]
    [InlineData(GroundOperationStatus.Approved, true, false)]
    public void ARecordedArrivalIsCorrectedOnlyBeforeTheFirstSubmission(GroundOperationStatus operation, bool submitted,
        bool expected) =>
        Assert.Equal(expected, OccTurnaroundRules.CanCorrectArrival(TurnaroundStatus.InProgress, operation, submitted));

    [Fact]
    public void AClosedTurnaroundNeverCorrectsItsArrival() =>
        Assert.False(OccTurnaroundRules.CanCorrectArrival(TurnaroundStatus.Cancelled, GroundOperationStatus.Cancelled, false));

    [Theory]
    [InlineData(null, false, 0, false)]
    [InlineData(null, true, 0, false)]
    [InlineData(0, false, 0, false)]
    [InlineData(0, false, 7, true)]
    [InlineData(0, true, 0, true)]
    [InlineData(0, true, -20, true)]
    public void ReplacingATimeAlreadyOnTheLegNeedsItsReason(int? recordedMinute, bool recordedByOcc, int arrivedMinute,
        bool expected)
    {
        // 3-N08: the leg's first time and the feed's time kept as it is need none; OCC's own record and another time than
        // the feed's are corrections.
        var landing = new DateTimeOffset(2026, 11, 5, 16, 0, 0, TimeSpan.Zero);
        DateTimeOffset? recorded = recordedMinute is { } minute ? landing.AddMinutes(minute) : null;
        Assert.Equal(expected,
            OccTurnaroundRules.ArrivalNeedsReason(recorded, recordedByOcc, landing.AddMinutes(arrivedMinute)));
    }

    [Theory]
    [InlineData(GroundOperationStatus.Planned, false, false)]
    [InlineData(GroundOperationStatus.InProgress, false, false)]
    [InlineData(GroundOperationStatus.InProgress, true, true)]
    [InlineData(GroundOperationStatus.PendingReview, false, true)]
    [InlineData(GroundOperationStatus.InReview, false, true)]
    [InlineData(GroundOperationStatus.Approved, false, true)]
    public void TheAircraftTypeIsFrozenFromTheFirstSubmission(GroundOperationStatus operation, bool submitted, bool locked) =>
        Assert.Equal(locked, OccTurnaroundRules.IsAircraftTypeLocked(operation, submitted));

    [Fact]
    public void TheScreenIsOfferedOnlyTheChangesTheStateAllows()
    {
        Assert.Equal(["reschedule", "cancel", "divert"],
            OccTurnaroundRules.AllowedActions(TurnaroundStatus.Confirmed, GroundOperationStatus.Assigned, false, false));
        Assert.Equal(["reschedule", "cancel", "divert", "correctArrival"],
            OccTurnaroundRules.AllowedActions(TurnaroundStatus.InProgress, GroundOperationStatus.Planned, true, false));
        Assert.Equal(["correctArrival"],
            OccTurnaroundRules.AllowedActions(TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, true, false));
        Assert.Empty(OccTurnaroundRules.AllowedActions(TurnaroundStatus.InProgress, GroundOperationStatus.PendingReview, true,
            true));
        Assert.Empty(OccTurnaroundRules.AllowedActions(TurnaroundStatus.Cancelled, GroundOperationStatus.Cancelled, false,
            false));
    }

    [Fact]
    public void ACharterCarrierNeedsANameAndAThreeLetterIcaoDesignator()
    {
        Assert.Equal("Sky High Charter", OccTurnaroundRules.AirlineName("  Sky   High  Charter "));
        Assert.Null(OccTurnaroundRules.AirlineName("S"));
        Assert.Null(OccTurnaroundRules.AirlineName(new string('a', 161)));
        Assert.Equal("SHC", OccTurnaroundRules.AirlineIcao(" shc "));
        Assert.Null(OccTurnaroundRules.AirlineIcao("SH"));
        Assert.Null(OccTurnaroundRules.AirlineIcao("SH1"));
        Assert.Null(OccTurnaroundRules.AirlineIcao(null));
        Assert.True(OccTurnaroundRules.TryAirlineIata(null, out var none));
        Assert.Null(none);
        Assert.True(OccTurnaroundRules.TryAirlineIata(" 9z ", out var iata));
        Assert.Equal("9Z", iata);
        Assert.False(OccTurnaroundRules.TryAirlineIata("ABC", out _));
        Assert.False(OccTurnaroundRules.TryAirlineIata("A-", out _));
    }

    [Fact]
    public void AFlightIsWrittenOnceWhoeverTypesIt()
    {
        Assert.Equal("EV311", FlightIdentity.NormalizeFlightNumber(" ev 311 "));
        Assert.Equal(string.Empty, FlightIdentity.NormalizeFlightNumber(null));
        Assert.True(FlightIdentity.IsFlightNumber("EV311"));
        Assert.False(FlightIdentity.IsFlightNumber("E"));
        Assert.False(FlightIdentity.IsFlightNumber("EV-311"));
        Assert.Equal("MIA", FlightIdentity.NormalizeIata(" mia "));
        Assert.True(FlightIdentity.IsIata("MIA"));
        Assert.False(FlightIdentity.IsIata("MI1"));
    }

    [Theory]
    [InlineData(GroundOperationStatus.Planned, false)]
    [InlineData(GroundOperationStatus.Assigned, true)]
    [InlineData(GroundOperationStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.Returned, true)]
    [InlineData(GroundOperationStatus.PendingReview, false)]
    [InlineData(GroundOperationStatus.Approved, false)]
    [InlineData(GroundOperationStatus.Cancelled, false)]
    public void AnOperationHoldsItsAgentWhileAssignedInProgressOrReturned(GroundOperationStatus status, bool holds)
    {
        Assert.Equal(holds, OperationOccupancyRules.HoldsAgent(status));
        Assert.Equal(3, OperationOccupancyRules.MaxSimultaneousOperations);
    }

    /// <summary>A tablet that sends an empty aircraft type is refused before any store work (3-B).</summary>
    [Fact]
    public async Task TheTabletNeverSendsAnEmptyAircraftType()
    {
        var store = new FlightDataStore();
        var handler = new RampExecutionHandler(new NoActors(), store);
        var (data, failure, code) = await handler.UpdateFlightDataAsync(Guid.NewGuid(), Guid.NewGuid(), 120, 118, 70_000,
            "HI1055", Guid.Empty, Guid.NewGuid(), Guid.NewGuid(), "test", TestContext.Current.CancellationToken);
        Assert.Null(data);
        Assert.Equal(RampOperationsFailure.InvalidRequest, failure);
        Assert.Null(code);
        Assert.False(store.Called);
    }

    private sealed class NoActors : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(null);
    }

    private sealed class FlightDataStore : IRampExecutionCommandStore
    {
        public bool Called { get; private set; }

        public Task<RampExecutionWriteResult> RecordMilestoneAsync(RampMilestoneWriteRequest request,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<RampExecutionWriteResult> UpdateFlightDataAsync(RampFlightDataWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Called = true;
            return Task.FromResult(RampExecutionWriteResult.Failed(RampExecutionWriteFailure.Conflict));
        }
    }
}
