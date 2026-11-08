using System.Globalization;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 3, block A: OCC plans a flight once (readable code, no duplicates), reschedules, cancels or diverts it before
/// its operation starts, records and corrects the arrival with the stand locked, and the feed links the flight OCC
/// already planned and only alerts OCC when the provider cancels it.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string StationZone = "America/Santo_Domingo";

    /// <summary>3-A, 3-N07, 3-N27: a flight is planned once, rescheduled, cancelled or diverted before it starts.</summary>
    [Fact]
    public async Task OccReschedulesCancelsAndDivertsAFlightBeforeItsOperationStarts()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        IOccTurnaroundStore Turnarounds(IServiceProvider services) => services.GetRequiredService<IOccTurnaroundStore>();
        var occ = SeededOccAccount;
        var station = SeededPujStation;
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone);
        var (demoAirline, stands) = await PlanningFixtureAsync(database.ConnectionString, ct);
        Task<ManualTurnaroundWriteResult> Enter(Guid id, string arrival, string departure, string stand, int hour,
            Guid? airline = null, bool charter = false) => Run(services =>
            services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(new ManualTurnaroundWriteRequest(occ, [station], id,
                station, airline ?? demoAirline, stands[stand], today, arrival, "MIA", LocalAt(today, hour),
                departure, "MIA", LocalAt(today, hour + 2), Guid.NewGuid(), "lifecycle-test", charter), ct));

        // 3-N27 and 3-N07: readable codes numbered per station and day; the same flight of the day is planned once.
        var first = Guid.CreateVersion7();
        var second = Guid.CreateVersion7();
        var prefix = $"PUJ-{today.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}-";
        Assert.Equal(prefix + "001", (await Enter(first, "ZZ701", "ZZ702", "A02", 14)).OperationCode);
        Assert.Equal(prefix + "002", (await Enter(second, "ZZ703", "ZZ704", "B02", 14)).OperationCode);
        var duplicate = await Enter(Guid.CreateVersion7(), "ZZ701", "ZZ799", "B03", 18);
        Assert.Equal((ManualTurnaroundWriteFailure.Conflict, "flight_already_planned"), (duplicate.Failure, duplicate.Code));

        // The detail carries the version and the changes its state allows.
        var detail = (await Run(services => Turnarounds(services).ReadAsync(occ, first, ct))).Value!;
        Assert.Equal(["reschedule", "cancel", "divert"], detail.AllowedActions);
        Assert.Equal("A02", detail.Turnaround.Stand?.Code);
        Assert.Equal(StationZone, detail.Station.IanaTimeZone);
        Assert.Equal(MasterDataFailure.Forbidden,
            (await Run(services => Turnarounds(services).ReadAsync(FinanceAccount, first, ct))).Failure);

        // «Editar vuelo»: the key and the version OCC saw; a replay repeats nothing, another body is a conflict.
        RescheduleTurnaroundInput Move(string version, int hour, Guid? stand = null, string reason = "Cambio de horario de la aerolínea") =>
            new("ZZ701", "MIA", LocalAt(today, hour), "ZZ702", "MIA", LocalAt(today, hour + 2), stand, null, reason, version);
        Assert.Equal("idempotency_key_required",
            (await Run(services => Turnarounds(services).RescheduleAsync(occ, first, Move(detail.Version, 15), null, ct))).Code);
        Assert.Equal("version_conflict", (await Run(services => Turnarounds(services).RescheduleAsync(occ, first,
            Move("AAAAAAAAAAA=", 15), Guid.NewGuid(), ct))).Code);
        var moveKey = Guid.NewGuid();
        var moved = await Run(services => Turnarounds(services).RescheduleAsync(occ, first, Move(detail.Version, 15), moveKey, ct));
        Assert.Null(moved.Failure);
        Assert.Equal(LocalAt(today, 15), moved.Value!.Turnaround.Arrival!.ScheduledAt);
        Assert.NotEqual(detail.Version, moved.Value.Version);
        var replayed = await Run(services => Turnarounds(services).RescheduleAsync(occ, first, Move(detail.Version, 15), moveKey, ct));
        Assert.True(replayed.Replayed);
        Assert.Equal("idempotency_conflict", (await Run(services => Turnarounds(services).RescheduleAsync(occ, first,
            Move(detail.Version, 15, reason: "Otro motivo distinto"), moveKey, ct))).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var operation = await (from item in check.GroundOperations.AsNoTracking()
                                   join turnaround in check.Turnarounds.AsNoTracking() on item.TurnaroundId equals turnaround.Id
                                   where turnaround.PublicId == first
                                   select item).SingleAsync(ct);
            Assert.Equal((LocalAt(today, 15), LocalAt(today, 17)), (operation.PlannedStartAt!.Value, operation.PlannedEndAt!.Value));
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.EntityPublicId == first &&
                entry.Action == "occ.turnaround.rescheduled", ct));
        }

        // The stand is checked for the new window: the second flight cannot take A02 at 15:00.
        var secondDetail = (await Run(services => Turnarounds(services).ReadAsync(occ, second, ct))).Value!;
        var taken = await Run(services => Turnarounds(services).RescheduleAsync(occ, second,
            new RescheduleTurnaroundInput("ZZ703", "MIA", LocalAt(today, 15), "ZZ704", "MIA", LocalAt(today, 17), stands["A02"],
                null, "Cambio de posición", secondDetail.Version), Guid.NewGuid(), ct));
        Assert.Equal("stand_unavailable", taken.Code);
        Assert.Contains("stand_taken", taken.Reasons!);

        // 3-N07: «Editar vuelo» never gives a flight the number of another open flight of the day, however it is typed,
        // in either direction; the refused edits change nothing.
        foreach (var (arrivalNumber, departureNumber) in new[] { ("zz 701", "ZZ704"), ("ZZ703", "ZZ702") })
            Assert.Equal("flight_already_planned", (await Run(services => Turnarounds(services).RescheduleAsync(occ, second,
                new RescheduleTurnaroundInput(arrivalNumber, "MIA", LocalAt(today, 14), departureNumber, "MIA",
                    LocalAt(today, 16), null, null, "Número de vuelo corregido", secondDetail.Version), Guid.NewGuid(), ct))).Code);
        Assert.Equal(secondDetail.Version, (await Run(services => Turnarounds(services).ReadAsync(occ, second, ct))).Value!.Version);

        // An assigned agent keeps the flight only inside their shift: Riley has none today.
        long firstOperation;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await (from item in setup.GroundOperations
                                   join turnaround in setup.Turnarounds on item.TurnaroundId equals turnaround.Id
                                   where turnaround.PublicId == first
                                   select item).SingleAsync(ct);
            firstOperation = operation.Id;
            var riley = await setup.RampAgents.SingleAsync(agent => agent.EmployeeNumber == "DEV-RA-001", ct);
            var occInternal = await setup.Users.Where(user => user.PublicId == occ).Select(user => user.Id).SingleAsync(ct);
            operation.CurrentStatus = GroundOperationStatus.Assigned;
            setup.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, RampAgentId = riley.Id,
                AssignmentRole = "primary", AssignedAt = DateTimeOffset.UtcNow.AddMinutes(-5), AssignedByAccountId = occInternal,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
        }
        var current = (await Run(services => Turnarounds(services).ReadAsync(occ, first, ct))).Value!;
        var unavailable = await Run(services => Turnarounds(services).RescheduleAsync(occ, first, Move(current.Version, 16),
            Guid.NewGuid(), ct));
        Assert.Equal("assigned_agent_unavailable", unavailable.Code);
        Assert.Equal(["shift_not_covering"], unavailable.Reasons!);

        // «Cancelar vuelo»: the stand and the agent are released, both statuses change with their events.
        var flightsBefore = await FlightsOnDateAsync(provider, today, ct);
        Assert.Equal("invalid_turnaround_change", (await Run(services => Turnarounds(services).ChangeStatusAsync(occ, first,
            new TurnaroundStatusChangeInput("Paused", "Vuelo creado por error", current.Version), Guid.NewGuid(), ct))).Code);
        Assert.Equal("reason_required", (await Run(services => Turnarounds(services).ChangeStatusAsync(occ, first,
            new TurnaroundStatusChangeInput("Cancelled", "no", current.Version), Guid.NewGuid(), ct))).Code);
        var cancelKey = Guid.NewGuid();
        var cancel = new TurnaroundStatusChangeInput("Cancelled", "Vuelo creado por error", current.Version);
        var cancelled = await Run(services => Turnarounds(services).ChangeStatusAsync(occ, first, cancel, cancelKey, ct));
        Assert.Null(cancelled.Failure);
        Assert.Equal("Cancelled", cancelled.Value!.Turnaround.Status);
        Assert.Empty(cancelled.Value.AllowedActions);
        Assert.True((await Run(services => Turnarounds(services).ChangeStatusAsync(occ, first, cancel, cancelKey, ct))).Replayed);
        Assert.Equal("turnaround_closed", (await Run(services => Turnarounds(services).ChangeStatusAsync(occ, first,
            new TurnaroundStatusChangeInput("Diverted", "Vuelo creado por error", cancelled.Value.Version), Guid.NewGuid(), ct))).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var turnaround = await check.Turnarounds.AsNoTracking().SingleAsync(item => item.PublicId == first, ct);
            var operation = await check.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == firstOperation, ct);
            Assert.Equal((TurnaroundStatus.Cancelled, GroundOperationStatus.Cancelled), (turnaround.CurrentStatus, operation.CurrentStatus));
            Assert.Equal("Vuelo creado por error", (await check.Set<TurnaroundStatusEvent>().AsNoTracking()
                .SingleAsync(item => item.TurnaroundId == turnaround.Id && item.ToStatus == TurnaroundStatus.Cancelled, ct)).Reason);
            Assert.True(await check.Set<GroundOperationStatusEvent>().AnyAsync(item => item.GroundOperationId == operation.Id &&
                item.FromStatus == GroundOperationStatus.Assigned && item.ToStatus == GroundOperationStatus.Cancelled, ct));
            Assert.False(await check.Set<StandAssignment>().AnyAsync(item => item.TurnaroundId == turnaround.Id &&
                item.AssignedTo == null, ct));
            Assert.False(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == operation.Id &&
                item.ReleasedAt == null, ct));
            Assert.True(await check.OperationalNotifications.AnyAsync(item => item.GroundOperationId == operation.Id &&
                item.Kind == "assignment_released", ct));
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.EntityPublicId == first &&
                entry.Action == "occ.turnaround.cancelled", ct));
        }

        // The map, the ready contracts and the feed's paid reads no longer count it; its stand takes another flight.
        var board = (await Run(services => services.GetRequiredService<IOccPositionStore>().ReadAsync(occ, station, today, ct))).Board!;
        Assert.DoesNotContain(board.Positions.SelectMany(position => position.Turnarounds).Concat(board.Unassigned),
            item => item.TurnaroundId == first);
        Assert.Equal(flightsBefore - 1, await FlightsOnDateAsync(provider, today, ct));
        var feedStation = Assert.Single(await Run(services => services.GetRequiredService<IFlightFeedSyncStore>()
            .ListStationsAsync(DateTimeOffset.UtcNow, ct)), item => item.StationPublicId == station);
        var activity = await Run(services => services.GetRequiredService<IFlightFeedSyncStore>()
            .GetActivityAsync("AeroDataBox", feedStation, DateTimeOffset.UtcNow, ct));
        Assert.DoesNotContain(LocalAt(today, 15), activity.ContractedFlightTimesToday);
        Assert.Contains(LocalAt(today, 14), activity.ContractedFlightTimesToday);
        Assert.True((await Enter(Guid.CreateVersion7(), "ZZ711", "ZZ712", "A02", 15)).IsSuccess);

        // «Marcar desviado» only before the start: a started operation is closed through the review.
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.GroundOperations.Where(item => setup.Turnarounds.Any(turnaround => turnaround.PublicId == second &&
                    turnaround.Id == item.TurnaroundId))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.CurrentStatus, GroundOperationStatus.InProgress), ct);
        secondDetail = (await Run(services => Turnarounds(services).ReadAsync(occ, second, ct))).Value!;
        Assert.Equal("operation_started", (await Run(services => Turnarounds(services).ChangeStatusAsync(occ, second,
            new TurnaroundStatusChangeInput("Diverted", "Desviado a SDQ por clima", secondDetail.Version), Guid.NewGuid(), ct))).Code);
        var third = Guid.CreateVersion7();
        Assert.True((await Enter(third, "ZZ721", "ZZ722", "B02", 19)).IsSuccess);
        var thirdDetail = (await Run(services => Turnarounds(services).ReadAsync(occ, third, ct))).Value!;
        // Only open flights count (3-N07): the number of the cancelled flight is free for another one.
        var renumbered = await Run(services => Turnarounds(services).RescheduleAsync(occ, third,
            new RescheduleTurnaroundInput("ZZ701", "MIA", LocalAt(today, 19), "ZZ722", "MIA", LocalAt(today, 21), null, null,
                "La aerolínea reutiliza el número del vuelo cancelado", thirdDetail.Version), Guid.NewGuid(), ct));
        Assert.Null(renumbered.Failure);
        Assert.Equal("ZZ701", renumbered.Value!.Turnaround.Arrival!.FlightNumber);
        var diverted = await Run(services => Turnarounds(services).ChangeStatusAsync(occ, third,
            new TurnaroundStatusChangeInput("Diverted", "Desviado a SDQ por clima", renumbered.Value.Version), Guid.NewGuid(), ct));
        Assert.Equal("Diverted", diverted.Value!.Turnaround.Status);

        // A cancelled charter with a confirmed prepayment tells Finance; the refund follows Cobros.
        Guid charterAirline;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var organization = new Organization
            {
                PublicId = Guid.CreateVersion7(), Code = "LIFECYCLE-CHARTER", LegalName = "Lifecycle Charter Ltd.",
                DisplayName = "Lifecycle Charter", Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            setup.Organizations.Add(organization);
            await setup.SaveChangesAsync(ct);
            var airline = new Airline
            {
                PublicId = Guid.CreateVersion7(), OrganizationId = organization.Id, IataCode = "L7", IcaoCode = "LQZ",
                Name = "Lifecycle Charter", IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            setup.Airlines.Add(airline);
            await setup.SaveChangesAsync(ct);
            charterAirline = airline.PublicId;
        }
        var charter = Guid.CreateVersion7();
        Assert.True((await Enter(charter, "L7100", "L7101", "A02", 9, charterAirline, true)).IsSuccess);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var financeInternal = await setup.Users.Where(user => user.PublicId == FinanceAccount).Select(user => user.Id)
                .SingleAsync(ct);
            await setup.Set<CharterAgreement>().Where(item => setup.Turnarounds.Any(turnaround => turnaround.PublicId == charter &&
                    turnaround.Id == item.TurnaroundId))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.PrepaymentStatus, CharterPrepaymentStatus.Confirmed)
                    .SetProperty(item => item.PrepaymentAmount, 260m)
                    .SetProperty(item => item.PrepaymentReference, "TRF-LIFECYCLE")
                    .SetProperty(item => item.PrepaymentConfirmedAt, DateTimeOffset.UtcNow)
                    .SetProperty(item => item.PrepaymentConfirmedByAccountId, financeInternal), ct);
        }
        var charterDetail = (await Run(services => Turnarounds(services).ReadAsync(occ, charter, ct))).Value!;
        Assert.True(charterDetail.IsCharter);
        Assert.Null((await Run(services => Turnarounds(services).ChangeStatusAsync(occ, charter,
            new TurnaroundStatusChangeInput("Cancelled", "La aerolínea canceló el charter", charterDetail.Version), Guid.NewGuid(),
            ct))).Failure);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.True(await check.DepartmentNotifications.AnyAsync(item => item.Kind == "charter_cancelled" &&
                item.Department == Department.Finance, ct));
    }

    /// <summary>
    /// 3-N10, 3-N08, 3-B: the stand is serialized for two concurrent assignments; the arrival is recorded at its local
    /// time with its aircraft type and corrected only with a reason and before the first submission.
    /// </summary>
    [Fact]
    public async Task PositionsSerializeTheStandAndCorrectTheArrivalWithItsReason()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        IOccPositionStore Positions(IServiceProvider services) => services.GetRequiredService<IOccPositionStore>();
        var occ = SeededOccAccount;
        var station = SeededPujStation;
        // The flights landed three hours ago, so the arrival is never in the future whatever the time of the run.
        var now = DateTimeOffset.UtcNow;
        var start = new DateTimeOffset(now.UtcTicks - now.UtcTicks % TimeSpan.TicksPerMinute, TimeSpan.Zero).AddHours(-3);
        var today = BusinessCalendar.Today(start, StationZone);
        var (demoAirline, stands) = await PlanningFixtureAsync(database.ConnectionString, ct);
        var (first, second) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        foreach (var (id, number, stand) in new[] { (first, "ZZ801", "A02"), (second, "ZZ803", "B02") })
            Assert.True((await Run(services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
                new ManualTurnaroundWriteRequest(occ, [station], id, station, demoAirline, stands[stand], today, number, "MIA",
                    start, number + "X", "MIA", start.AddHours(2), Guid.NewGuid(), "positions-test"), ct))).IsSuccess);

        // Two coordinators send both flights to the same free stand at once: exactly one wins.
        var target = stands["B03"];
        var race = await Task.WhenAll(
            Run(services => Positions(services).AssignAsync(occ, first, target, "Carrera", OccPositionCommand.None, ct)),
            Run(services => Positions(services).AssignAsync(occ, second, target, "Carrera", OccPositionCommand.None, ct)));
        Assert.Single(race, result => result.Failure is null);
        var loser = Assert.Single(race, result => result.Failure is not null);
        Assert.Equal(OccPositionFailure.Conflict, loser.Failure);
        Assert.True(loser.Code is "stand_unavailable" or "version_conflict", loser.Code);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(1, await check.Set<StandAssignment>().CountAsync(item => item.StandId == stands.Key("B03") &&
                item.AssignedTo == null, ct));
        var winner = race[0].Failure is null ? first : second;

        // The arrival at its local time (the screen converts it) and the seeded narrow-body type.
        var detail = (await Run(services => services.GetRequiredService<IOccTurnaroundStore>().ReadAsync(occ, winner, ct))).Value!;
        var arrivedAt = start.AddMinutes(5);
        var narrow = await AircraftTypeAsync(database.ConnectionString, "A320", ct);
        var wide = await AircraftTypeAsync(database.ConnectionString, "A333", ct);
        Assert.Equal("version_conflict", (await Run(services => Positions(services).RecordArrivalAsync(occ, winner,
            new RecordArrivalInput("hi1055", arrivedAt, narrow), new OccPositionCommand(Guid.NewGuid(), "AAAAAAAAAAA="), ct))).Code);
        Assert.Equal("expected_version_required", (await Run(services => Positions(services).RecordArrivalAsync(occ, winner,
            new RecordArrivalInput("hi1055", arrivedAt, narrow), new OccPositionCommand(Guid.NewGuid(), null), ct))).Code);
        var arrivalKey = Guid.NewGuid();
        var arrival = new RecordArrivalInput("hi1055", arrivedAt, narrow);
        var recorded = await Run(services => Positions(services).RecordArrivalAsync(occ, winner, arrival,
            new OccPositionCommand(arrivalKey, detail.Version), ct));
        Assert.Null(recorded.Failure);
        Assert.NotNull(recorded.Version);
        Assert.NotEqual(detail.Version, recorded.Version);
        Assert.Null((await Run(services => Positions(services).RecordArrivalAsync(occ, winner, arrival,
            new OccPositionCommand(arrivalKey, detail.Version), ct))).Failure);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var turnaround = await check.Turnarounds.AsNoTracking().SingleAsync(item => item.PublicId == winner, ct);
            var leg = await check.FlightLegs.AsNoTracking().SingleAsync(item => item.TurnaroundId == turnaround.Id &&
                item.Direction == FlightDirection.Arrival, ct);
            Assert.Equal((arrivedAt, OperationalDataSource.Manual), (leg.ActualAt!.Value, leg.Source));
            Assert.Equal((TurnaroundStatus.InProgress, "HI1055"), (turnaround.CurrentStatus, turnaround.AircraftRegistration));
            Assert.Equal(await check.AircraftTypes.Where(item => item.PublicId == narrow).Select(item => (long?)item.Id).SingleAsync(ct),
                turnaround.AircraftTypeId);
            // The replay with the same key repeated nothing.
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.EntityPublicId == winner &&
                entry.Action == "occ.turnaround.arrived", ct));
        }

        // A recorded arrival is corrected only with its reason; the wide-body never takes a narrow-body stand.
        Assert.Equal("reason_required", (await Run(services => Positions(services).RecordArrivalAsync(occ, winner,
            new RecordArrivalInput("HI1055", arrivedAt.AddMinutes(-20)), OccPositionCommand.None, ct))).Code);
        var corrected = await Run(services => Positions(services).RecordArrivalAsync(occ, winner,
            new RecordArrivalInput("HI1055", arrivedAt.AddMinutes(-20), null, "La hora real del bloqueo fue antes"),
            OccPositionCommand.None, ct));
        Assert.Null(corrected.Failure);
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.Stands.Where(item => item.PublicId == target)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.MaxAircraftSize, AircraftSizeCategory.Narrowbody), ct);
        var tooWide = await Run(services => Positions(services).RecordArrivalAsync(occ, winner,
            new RecordArrivalInput("HI1055", arrivedAt.AddMinutes(-20), wide, "El avión real es un A330"), OccPositionCommand.None, ct));
        Assert.Equal("stand_unavailable", tooWide.Code);
        Assert.Equal(["stand_narrowbody_only"], tooWide.Reasons!);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var leg = await (from item in check.FlightLegs.AsNoTracking()
                             join turnaround in check.Turnarounds.AsNoTracking() on item.TurnaroundId equals turnaround.Id
                             where turnaround.PublicId == winner && item.Direction == FlightDirection.Arrival
                             select item).SingleAsync(ct);
            Assert.Equal(arrivedAt.AddMinutes(-20), leg.ActualAt);
            Assert.Equal("La hora real del bloqueo fue antes (" + arrivedAt.ToString("O", CultureInfo.InvariantCulture) + " -> " +
                arrivedAt.AddMinutes(-20).ToString("O", CultureInfo.InvariantCulture) + ")",
                (await check.AuditEntries.AsNoTracking().SingleAsync(entry => entry.EntityPublicId == winner &&
                    entry.Action == "occ.turnaround.arrival_corrected", ct)).Reason);
        }

        // From the first submission the arrival and the aircraft type are evidence.
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.GroundOperations.Where(item => setup.Turnarounds.Any(turnaround => turnaround.PublicId == winner &&
                    turnaround.Id == item.TurnaroundId))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.CurrentStatus, GroundOperationStatus.PendingReview), ct);
        Assert.Equal("arrival_locked", (await Run(services => Positions(services).RecordArrivalAsync(occ, winner,
            new RecordArrivalInput("HI1055", arrivedAt, null, "Otra corrección tardía"), OccPositionCommand.None, ct))).Code);
        // Release is idempotent with its key and keeps the history.
        var releaseKey = Guid.NewGuid();
        var version = (await Run(services => services.GetRequiredService<IOccTurnaroundStore>().ReadAsync(occ, winner, ct))).Value!.Version;
        Assert.Null((await Run(services => Positions(services).ReleaseAsync(occ, winner, new OccPositionCommand(releaseKey, version),
            ct))).Failure);
        Assert.Null((await Run(services => Positions(services).ReleaseAsync(occ, winner, new OccPositionCommand(releaseKey, version),
            ct))).Failure);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.EntityPublicId == winner &&
                entry.Action == "occ.stand.released", ct));

        // 3-N08: the time the flight feed reported on the other flight is replaced only with its reason, and kept as it is
        // it needs none. From the first submission it is evidence too, and so is a leg without a time.
        var other = winner == first ? second : first;
        var runway = start.AddMinutes(2);
        async Task FeedReportsAsync(DateTimeOffset? actualAt)
        {
            await using var setup = CreateContext(database.ConnectionString);
            await setup.FlightLegs.Where(item => item.Direction == FlightDirection.Arrival &&
                    setup.Turnarounds.Any(turnaround => turnaround.PublicId == other && turnaround.Id == item.TurnaroundId))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Source, OperationalDataSource.ExternalProvider)
                    .SetProperty(item => item.ActualAt, actualAt), ct);
        }
        async Task<FlightLeg> OtherArrivalAsync()
        {
            await using var check = CreateContext(database.ConnectionString);
            return await (from item in check.FlightLegs.AsNoTracking()
                          join turnaround in check.Turnarounds.AsNoTracking() on item.TurnaroundId equals turnaround.Id
                          where turnaround.PublicId == other && item.Direction == FlightDirection.Arrival
                          select item).SingleAsync(ct);
        }
        await FeedReportsAsync(runway);
        Assert.Contains("correctArrival", (await Run(services => services.GetRequiredService<IOccTurnaroundStore>()
            .ReadAsync(occ, other, ct))).Value!.AllowedActions);
        Assert.Equal("reason_required", (await Run(services => Positions(services).RecordArrivalAsync(occ, other,
            new RecordArrivalInput("HI2042", runway.AddMinutes(6)), OccPositionCommand.None, ct))).Code);
        Assert.Null((await Run(services => Positions(services).RecordArrivalAsync(occ, other,
            new RecordArrivalInput("HI2042", runway), OccPositionCommand.None, ct))).Failure);
        var kept = await OtherArrivalAsync();
        Assert.Equal((runway, OperationalDataSource.Manual), (kept.ActualAt!.Value, kept.Source));
        await FeedReportsAsync(runway);
        Assert.Null((await Run(services => Positions(services).RecordArrivalAsync(occ, other,
            new RecordArrivalInput("HI2042", runway.AddMinutes(6), null, "Hora de calzos, no la de pista"),
            OccPositionCommand.None, ct))).Failure);
        Assert.Equal(runway.AddMinutes(6), (await OtherArrivalAsync()).ActualAt);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.EntityPublicId == other &&
                entry.Action == "occ.turnaround.arrived", ct));
            Assert.Equal("Hora de calzos, no la de pista (" + runway.ToString("O", CultureInfo.InvariantCulture) + " -> " +
                runway.AddMinutes(6).ToString("O", CultureInfo.InvariantCulture) + ")",
                (await check.AuditEntries.AsNoTracking().SingleAsync(entry => entry.EntityPublicId == other &&
                    entry.Action == "occ.turnaround.arrival_corrected", ct)).Reason);
        }
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.GroundOperations.Where(item => setup.Turnarounds.Any(turnaround => turnaround.PublicId == other &&
                    turnaround.Id == item.TurnaroundId))
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.CurrentStatus, GroundOperationStatus.PendingReview), ct);
        await FeedReportsAsync(runway);
        Assert.Equal("arrival_locked", (await Run(services => Positions(services).RecordArrivalAsync(occ, other,
            new RecordArrivalInput("HI2042", runway.AddMinutes(8), null, "Corrección después de la entrega"),
            OccPositionCommand.None, ct))).Code);
        await FeedReportsAsync(null);
        Assert.Equal("arrival_locked", (await Run(services => Positions(services).RecordArrivalAsync(occ, other,
            new RecordArrivalInput("HI2042", null), OccPositionCommand.None, ct))).Code);
        var untouched = await OtherArrivalAsync();
        Assert.Equal(((DateTimeOffset?)null, OperationalDataSource.ExternalProvider), (untouched.ActualAt, untouched.Source));

        // 3-N10: whoever sends the positions commands reads the version they carry, also without Planificación; with
        // the map's «Ver» alone the flight's version is not readable.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var account = await setup.Users.Where(user => user.PublicId == occ).Select(user => user.Id).SingleAsync(ct);
            await setup.DepartmentAssignments.Where(item => item.AccountId == account)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Kind, DepartmentAssignmentKind.Member), ct);
            setup.AccountPermissionGrants.AddRange(
                new AccountPermissionGrant { AccountId = account, PermissionCode = "operations.positions_map.read" },
                new AccountPermissionGrant { AccountId = account, PermissionCode = "operations.positions_map.assign" });
            await setup.SaveChangesAsync(ct);
        }
        var mapOnly = await Run(services => services.GetRequiredService<IOccTurnaroundStore>().ReadAsync(occ, winner, ct));
        Assert.Null(mapOnly.Failure);
        Assert.Null((await Run(services => Positions(services).AssignAsync(occ, winner, stands["A03"], null,
            new OccPositionCommand(Guid.NewGuid(), mapOnly.Value!.Version), ct))).Failure);
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.AccountPermissionGrants.Where(item => item.PermissionCode == "operations.positions_map.assign" &&
                    setup.Users.Any(user => user.PublicId == occ && user.Id == item.AccountId))
                .ExecuteDeleteAsync(ct);
        Assert.Equal(MasterDataFailure.Forbidden, (await Run(services => services.GetRequiredService<IOccTurnaroundStore>()
            .ReadAsync(occ, winner, ct))).Failure);
    }

    /// <summary>
    /// 3-N07, 3-N27, 3-A: the feed's pair of a flight OCC typed by hand joins that turnaround; a new pair gets a readable
    /// code; when the provider cancels an imported flight OCC is told once and nothing is cancelled by the feed.
    /// </summary>
    [Fact]
    public async Task TheFeedLinksThePlannedFlightAndOnlyAlertsOccWhenTheProviderCancelsIt()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddSingleton<IAirportFlightFeed, DisabledFeed>()
            .AddSingleton(FlightFeedBudget.Default)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
            }).Build()).BuildServiceProvider();
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var now = DateTimeOffset.UtcNow;
        var today = BusinessCalendar.Today(now, StationZone);
        var (demoAirline, stands) = await PlanningFixtureAsync(database.ConnectionString, ct);
        var manual = Guid.CreateVersion7();
        Assert.True((await Run(services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
            new ManualTurnaroundWriteRequest(SeededOccAccount, [SeededPujStation], manual, SeededPujStation, demoAirline,
                stands["A02"], today, "ZZ1234", "MIA", LocalAt(today, 12), "ZZ1235", "MIA", LocalAt(today, 14), Guid.NewGuid(),
                "feed-link-test"), ct))).IsSuccess);

        var station = Assert.Single(await Run(services => services.GetRequiredService<IFlightFeedSyncStore>()
            .ListStationsAsync(now, ct)), item => item.StationPublicId == SeededPujStation);
        var origin = new FeedAirport("XQA", "XQAA", "Synthetic Origin", "Origin City", "DO", StationZone, 18.5m, -69.5m);
        FeedFlight Leg(FlightDirection direction, string number, DateTimeOffset at, string status = "Expected") =>
            new(direction, number, new FeedAirline("Demo Airlines", "ZZ", null), origin, at, null, null, status, "HI2042",
                "Airbus A320", "B", "22", false, "IsOperator");
        var localNoon = LocalAt(today, 12);
        var call = new FlightFeedCall("AeroDataBox", station, TimeZoneInfo.ConvertTime(localNoon, BusinessCalendar.Zone(StationZone))
            .DateTime.AddHours(-2), TimeZoneInfo.ConvertTime(localNoon, BusinessCalendar.Zone(StationZone)).DateTime.AddHours(10),
            ProviderCallTrigger.Scheduled, null, now);
        // The provider writes «ZZ 1234»; OCC typed «ZZ1234»: the same flight.
        Assert.Equal(4, (await Run(services => services.GetRequiredService<IFlightFeedSyncStore>().RecordAsync(call,
            new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
            [
                Leg(FlightDirection.Arrival, "ZZ 1234", localNoon), Leg(FlightDirection.Departure, "ZZ 1235", localNoon.AddHours(2)),
                Leg(FlightDirection.Arrival, "ZZ 1300", localNoon.AddHours(3)),
                Leg(FlightDirection.Departure, "ZZ 1301", localNoon.AddHours(5)),
            ]), ct))).NewProposals);
        var proposals = await Run(async services =>
        {
            var context = services.GetRequiredService<Elevant.Infrastructure.Persistence.ElevantDbContext>();
            return await context.Set<ExternalFlightProposal>().AsNoTracking()
                .Select(item => new { item.PublicId, item.FlightNumber, item.RowVersion }).ToArrayAsync(ct);
        });
        Guid Proposal(string number) => proposals.Single(item => item.FlightNumber == number).PublicId;
        string ProposalVersion(string number) => Convert.ToBase64String(proposals.Single(item => item.FlightNumber == number).RowVersion);

        // The planned flight takes the pair: nothing new is created and the replay answers the same.
        var key = Guid.NewGuid();
        var input = new OccFlightImportInput(Proposal("ZZ 1234"), Proposal("ZZ 1235"), null, null, false,
            ProposalVersion("ZZ 1234"), ProposalVersion("ZZ 1235"));
        var linked = await Run(services => services.GetRequiredService<IOccFlightFeedStore>().ImportAsync(SeededOccAccount, input,
            key, ct));
        Assert.Equal((manual, true, (OccFlightFeedFailure?)null), (linked.TurnaroundId!.Value, linked.Linked, linked.Failure));
        var replay = await Run(services => services.GetRequiredService<IOccFlightFeedStore>().ImportAsync(SeededOccAccount, input,
            key, ct));
        Assert.Equal((manual, true, true), (replay.TurnaroundId!.Value, replay.Replayed, replay.Linked));
        var other = await Run(services => services.GetRequiredService<IOccFlightFeedStore>().ImportAsync(SeededOccAccount,
            new OccFlightImportInput(Proposal("ZZ 1300"), Proposal("ZZ 1301")), null, ct));
        Assert.Null(other.Failure);
        Assert.False(other.Linked);
        Assert.Equal($"PUJ-{today.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}-002", other.OperationCode);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var turnaround = await check.Turnarounds.AsNoTracking().SingleAsync(item => item.PublicId == manual, ct);
            Assert.Equal(2, await check.Turnarounds.CountAsync(item => item.StationId == turnaround.StationId &&
                item.OperationDate == today, ct));
            Assert.Equal("HI2042", turnaround.AircraftRegistration);
            Assert.All(await check.Set<ExternalFlightProposal>().AsNoTracking()
                    .Where(item => item.FlightNumber == "ZZ 1234" || item.FlightNumber == "ZZ 1235").ToArrayAsync(ct),
                item => Assert.Equal((ExternalFlightProposalStatus.Confirmed, (long?)turnaround.Id), (item.Status, item.TurnaroundId)));
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.EntityPublicId == manual &&
                entry.Action == "occ.turnaround.feed_linked", ct));
        }
        // The manual entry of a flight already imported is refused.
        var again = await Run(services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
            new ManualTurnaroundWriteRequest(SeededOccAccount, [SeededPujStation], Guid.CreateVersion7(), SeededPujStation, demoAirline,
                stands["B02"], today, "ZZ1300", "MIA", LocalAt(today, 15), "ZZ1399", "MIA", LocalAt(today, 17), Guid.NewGuid(),
                "feed-link-test"), ct));
        Assert.Equal("flight_already_planned", again.Code);

        // The provider cancels the imported flight: OCC hears it once, the turnaround stays as OCC left it.
        for (var read = 1; read <= 2; read++)
            await Run(services => services.GetRequiredService<IFlightFeedSyncStore>().RecordAsync(
                call with { OccurredAt = now.AddMinutes(5 * read) },
                new AirportFeedResponse(ProviderCallOutcome.Succeeded, 2, 200, null,
                    [Leg(FlightDirection.Arrival, "ZZ 1300", localNoon.AddHours(3), "Canceled")]), ct));
        await using (var check = CreateContext(database.ConnectionString))
        {
            var alerts = await check.OperationalNotifications.AsNoTracking()
                .Where(item => item.Kind == "flight_cancelled_by_provider").ToArrayAsync(ct);
            Assert.NotEmpty(alerts);
            Assert.All(alerts, item => Assert.Equal(Proposal("ZZ 1300"), item.SourceId));
            Assert.Equal(alerts.Length, alerts.Select(item => item.RecipientAccountId).Distinct().Count());
            Assert.Equal(TurnaroundStatus.Confirmed, (await check.Turnarounds.AsNoTracking()
                .SingleAsync(item => item.PublicId == other.TurnaroundId, ct)).CurrentStatus);
        }
    }

    private static async Task SeedDevelopmentAsync(TemporaryDatabase database, CancellationToken cancellationToken)
    {
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
        await using var seeder = CreateContext(connection);
        await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, cancellationToken);
    }

    /// <summary>An instant of the station's local day, in UTC as the API stores it.</summary>
    private static DateTimeOffset LocalAt(DateOnly day, int hour, int minute = 0) =>
        BusinessCalendar.StartOfDay(day, StationZone).AddHours(hour).AddMinutes(minute).ToUniversalTime();

    /// <summary>The stands of PUJ by code: the public id the commands take and the key the checks read.</summary>
    private sealed class PlanningStands(Dictionary<string, (long Id, Guid PublicId)> stands)
    {
        public Guid this[string code] => stands[code].PublicId;

        public long Key(string code) => stands[code].Id;
    }

    /// <summary>
    /// The seeded contracted airline of PUJ and the station's stands by code, with a third stand in each terminal (A03,
    /// B03) the seed does not have.
    /// </summary>
    private static async Task<(Guid Airline, PlanningStands Stands)> PlanningFixtureAsync(string connectionString,
        CancellationToken cancellationToken)
    {
        await using var context = CreateContext(connectionString);
        var puj = await context.Stations.SingleAsync(item => item.PublicId == SeededPujStation, cancellationToken);
        foreach (var (code, terminalCode) in new[] { ("A03", "A"), ("B03", "B") })
        {
            if (await context.Stands.AnyAsync(item => item.StationId == puj.Id && item.Code == code, cancellationToken)) continue;
            var terminal = await context.Terminals.SingleAsync(item => item.StationId == puj.Id && item.Code == terminalCode,
                cancellationToken);
            context.Stands.Add(new Stand
            {
                PublicId = Guid.CreateVersion7(), StationId = puj.Id, TerminalId = terminal.Id, Code = code, StandType = "Contact",
                IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
        }
        await context.SaveChangesAsync(cancellationToken);
        var airline = await (from turnaround in context.Turnarounds.AsNoTracking()
                             join item in context.Airlines.AsNoTracking() on turnaround.AirlineId equals item.Id
                             where turnaround.OperationCode == "DEV-TAT-0001"
                             select item.PublicId).SingleAsync(cancellationToken);
        var stands = await (from stand in context.Stands.AsNoTracking()
                            join station in context.Stations.AsNoTracking() on stand.StationId equals station.Id
                            where station.PublicId == SeededPujStation && stand.IsActive
                            select new { stand.Code, stand.Id, stand.PublicId }).ToArrayAsync(cancellationToken);
        return (airline, new PlanningStands(stands.ToDictionary(item => item.Code, item => (item.Id, item.PublicId))));
    }

    private static async Task<Guid> AircraftTypeAsync(string connectionString, string icaoCode, CancellationToken cancellationToken)
    {
        await using var context = CreateContext(connectionString);
        return await context.AircraftTypes.AsNoTracking().Where(item => item.IcaoCode == icaoCode).Select(item => item.PublicId)
            .SingleAsync(cancellationToken);
    }

    private static async Task<int> FlightsOnDateAsync(ServiceProvider provider, DateOnly date, CancellationToken cancellationToken)
    {
        await using var scope = provider.CreateAsyncScope();
        var ready = await scope.ServiceProvider.GetRequiredService<IOccReadyContractsStore>()
            .ListAsync(SeededOccAccount, SeededPujStation, date, cancellationToken);
        return ready!.Contracts.Sum(contract => contract.FlightsOnDate);
    }
}
