using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 3, block B: the stand reassignment applies the manual assignment's rules (3-N05), a coverage needs the
/// terminal's scope and documents until it ends, the coverage and release commands replay their Idempotency-Key (3-J)
/// and OCC hands a started operation to another eligible agent (3-F).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// A second ramp agent OCC may assign at PUJ on <paramref name="day"/>: a validated app account
    /// (<see cref="RampAccountAsync"/>), scopes in <paramref name="terminals"/>, a senior hire date, current documents and
    /// a 05:00-21:00 shift in <paramref name="shiftTerminal"/>.
    /// </summary>
    private static async Task<(Guid Account, long Agent, Guid Profile)> EligibleRampAgentAsync(ServiceProvider provider,
        string connectionString, string firstName, string number, string identification, string email, DateOnly day,
        string shiftTerminal, string[] terminals, CancellationToken ct)
    {
        var (_, account, agent) = await RampAccountAsync(provider, firstName, number, identification, email, ct);
        Guid profile;
        await using (var context = CreateContext(connectionString))
        {
            var station = await context.Stations.Where(item => item.PublicId == SeededPujStation).Select(item => item.Id)
                .SingleAsync(ct);
            var row = await context.RampAgents.SingleAsync(item => item.Id == agent, ct);
            row.HireDate = new DateOnly(2026, 1, 1);
            profile = row.PublicId;
            if (!await context.Set<RampAgentStationScope>().AnyAsync(item => item.RampAgentId == agent &&
                    item.StationId == station && item.ValidTo == null, ct))
                context.Add(new RampAgentStationScope { RampAgentId = agent, StationId = station, ValidFrom = new DateOnly(2026, 1, 1) });
            foreach (var code in terminals)
            {
                var terminal = await context.Terminals.Where(item => item.StationId == station && item.Code == code)
                    .Select(item => item.Id).SingleAsync(ct);
                if (!await context.Set<RampAgentTerminalScope>().AnyAsync(item => item.RampAgentId == agent &&
                        item.TerminalId == terminal && item.ValidTo == null, ct))
                    context.Add(new RampAgentTerminalScope
                    {
                        RampAgentId = agent, TerminalId = terminal, ValidFrom = new DateOnly(2026, 1, 1),
                    });
            }
            foreach (var type in new[] { PermitDocumentType.AirportId, PermitDocumentType.RampDriverLicense })
                context.AirportPermitCycles.Add(new AirportPermitCycle
                {
                    PublicId = Guid.CreateVersion7(), RampAgentId = agent, DocumentType = type, CycleNumber = 1,
                    DocumentNumber = $"{number}-{type}", IssuedOn = new DateOnly(2026, 1, 1),
                    ExpiresOn = new DateOnly(2099, 12, 31), IsCurrent = true, CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
            await context.SaveChangesAsync(ct);
        }
        await AddRampShiftAsync(connectionString, agent, day, shiftTerminal, 5, 21, ct);
        return (account, agent, profile);
    }

    private static async Task<Guid> TerminalAsync(string connectionString, string code, CancellationToken ct)
    {
        await using var context = CreateContext(connectionString);
        return await (from terminal in context.Terminals.AsNoTracking()
                      join station in context.Stations.AsNoTracking() on terminal.StationId equals station.Id
                      where station.PublicId == SeededPujStation && terminal.Code == code
                      select terminal.PublicId).SingleAsync(ct);
    }

    private static async Task<(Guid Turnaround, long Operation)> OperationOfAsync(string connectionString, Guid turnaroundId,
        CancellationToken ct)
    {
        await using var context = CreateContext(connectionString);
        var operation = await (from item in context.GroundOperations.AsNoTracking()
                               join turnaround in context.Turnarounds.AsNoTracking() on item.TurnaroundId equals turnaround.Id
                               where turnaround.PublicId == turnaroundId
                               select item.Id).SingleAsync(ct);
        return (turnaroundId, operation);
    }

    /// <summary>
    /// 3-N05: the flight follows the agent who covers its new stand only when they may work it under the manual
    /// assignment's rules; otherwise an eligible previous agent keeps it, and with nobody eligible it goes back to
    /// Planned and OCC is told. A coverage needs a scope in its terminal and documents current until it ends.
    /// </summary>
    [Fact]
    public async Task TheFlightFollowsOnlyAnEligibleCoveringAgentAndCoverageNeedsTheTerminalScope()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var connection = database.ConnectionString;
        var (airline, stands) = await PlanningFixtureAsync(connection, ct);
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        long riley;
        await using (var setup = CreateContext(connection))
            riley = await setup.RampAgents.Where(item => item.PublicId == RileyProfile).Select(item => item.Id).SingleAsync(ct);
        await AddRampShiftAsync(connection, riley, day, "A", 6, 18, ct);
        var xavier = await EligibleRampAgentAsync(provider, connection, "Xavier", "QA-RA-301", "40212345611",
            "xavier.cobertura@dev.elevant.test", day, "B", ["A", "B"], ct);
        await using (var bridge = CreateContext(connection))
        {
            var type = await bridge.EquipmentTypes.Where(item => item.Code == EfPositionCoverageStore.BridgeEquipmentTypeCode)
                .Select(item => item.Id).SingleAsync(ct);
            bridge.QualificationCycles.Add(new QualificationCycle
            {
                PublicId = Guid.CreateVersion7(), RampAgentId = xavier.Agent, EquipmentTypeId = type, CycleNumber = 1,
                TrainingDate = new DateOnly(2026, 1, 2), ObtainedOn = new DateOnly(2026, 1, 3), ExpiresOn = new DateOnly(2099, 12, 31),
                CertifyingEntity = "Synthetic Training Center", InstructorName = "Development Instructor", IsCurrent = true,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await bridge.SaveChangesAsync(ct);
        }
        var terminalA = await TerminalAsync(connection, "A", ct);
        var terminalB = await TerminalAsync(connection, "B", ct);
        Task<CoverageResult> Cover(Guid agent, Guid terminal, Guid stand, DateOnly date, DateTimeOffset from, DateTimeOffset until) =>
            RunScopedAsync(provider, services => services.GetRequiredService<IPositionCoverageStore>().CreateAsync(
                SeededOccAccount, SeededPujStation, new CreateCoverageInput(agent, terminal, [stand], date, from, until, null,
                    null, false), null, ct));
        Task<OccPositionResult> Move(Guid turnaround, string stand) => RunScopedAsync(provider, services => services
            .GetRequiredService<IOccPositionStore>().AssignAsync(SeededOccAccount, turnaround, stands[stand],
                "El aeropuerto cambió la posición", OccPositionCommand.None, ct));
        async Task<long?> AgentOf(long operation)
        {
            await using var check = CreateContext(connection);
            var open = await check.OperationAgentAssignments.AsNoTracking()
                .Where(item => item.GroundOperationId == operation && item.ReleasedAt == null)
                .Select(item => item.RampAgentId).ToArrayAsync(ct);
            return open.Length == 1 ? open[0] : null;
        }

        // Xavier covers B01 that day, with the scope of terminal B the tablet needs; Riley lacks it.
        Assert.Null((await Cover(xavier.Profile, terminalB, stands["B01"], day, LocalAt(day, 8), LocalAt(day, 14))).Failure);
        var noScope = await Cover(RileyProfile, terminalB, stands["B02"], day, LocalAt(day, 8), LocalAt(day, 14));
        Assert.Equal(PositionCoverageFailure.Rejected, noScope.Failure);
        Assert.Contains("terminal_scope_missing", noScope.Reasons);

        var planned = await PlanManualFlightAsync(provider, airline, stands["A01"], day, "ZZ901", LocalAt(day, 10),
            LocalAt(day, 12), ct);
        Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
        var (flight, operation) = await OperationOfAsync(connection, planned.TurnaroundId!.Value, ct);
        Assert.True((await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct)).IsSuccess);

        // Nobody covers A02: Riley may still work it there, so he keeps the flight.
        Assert.Null((await Move(flight, "A02")).Failure);
        Assert.Equal(riley, await AgentOf(operation));

        // Xavier's airport card expired the day before: he never receives the flight, and Riley may not work terminal B.
        await using (var expire = CreateContext(connection))
            await expire.AirportPermitCycles.Where(item => item.RampAgentId == xavier.Agent &&
                    item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiresOn, day.AddDays(-1)), ct);
        Assert.Null((await Move(flight, "B01")).Failure);
        Assert.Null(await AgentOf(operation));
        await using (var check = CreateContext(connection))
        {
            Assert.Equal(GroundOperationStatus.Planned, (await check.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == operation, ct)).CurrentStatus);
            var notices = await check.OperationalNotifications.AsNoTracking().Where(item => item.GroundOperationId == operation)
                .Select(item => item.Kind).ToArrayAsync(ct);
            Assert.Contains(CoverageReassignment.UnassignedKind, notices);
            Assert.Contains("assignment_released", notices);
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "occ.operation.unassigned_by_stand", ct));
        }

        // With his card renewed, the flight back in A01 for Riley follows Xavier to B01.
        await using (var renew = CreateContext(connection))
            await renew.AirportPermitCycles.Where(item => item.RampAgentId == xavier.Agent &&
                    item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiresOn, new DateOnly(2099, 12, 31)), ct);
        Assert.Null((await Move(flight, "A01")).Failure);
        Assert.True((await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct)).IsSuccess);
        Assert.Null((await Move(flight, "B01")).Failure);
        Assert.Equal(xavier.Agent, await AgentOf(operation));
        await using (var check = CreateContext(connection))
        {
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "occ.operation.reassigned_by_stand", ct));
            Assert.Equal(GroundOperationStatus.Assigned, (await check.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == operation, ct)).CurrentStatus);
            Assert.True(await check.OperationalNotifications.AnyAsync(item => item.GroundOperationId == operation &&
                item.Kind == "operation_assigned", ct));
        }

        // A night coverage needs the documents until the local day it ends: the card that expires that day is not enough.
        var night = day.AddDays(1);
        await AddRampShiftAsync(connection, xavier.Agent, night, "A", 20, 4, ct);
        await using (var expire = CreateContext(connection))
            await expire.AirportPermitCycles.Where(item => item.RampAgentId == xavier.Agent &&
                    item.DocumentType == PermitDocumentType.AirportId)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiresOn, night), ct);
        var overnight = await Cover(xavier.Profile, terminalA, stands["A03"], night, LocalAt(night, 21), LocalAt(night, 27));
        Assert.Equal(PositionCoverageFailure.Rejected, overnight.Failure);
        Assert.Contains("airport_permit_required", overnight.Reasons);
        Assert.Null((await Cover(xavier.Profile, terminalA, stands["A03"], night, LocalAt(night, 21), LocalAt(night, 23,
            59))).Failure);
    }

    /// <summary>
    /// 3-J and 3-F: creating and releasing a coverage replay their key; OCC hands an operation the agent started to
    /// another eligible agent with a reason, the assignment it saw and a key, and the evidence keeps its author.
    /// </summary>
    [Fact]
    public async Task CoverageCommandsReplayTheirKeyAndOccHandsAStartedOperationToAnotherAgent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var connection = database.ConnectionString;
        var (airline, stands) = await PlanningFixtureAsync(connection, ct);
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        long riley;
        await using (var setup = CreateContext(connection))
            riley = await setup.RampAgents.Where(item => item.PublicId == RileyProfile).Select(item => item.Id).SingleAsync(ct);
        await AddRampShiftAsync(connection, riley, day, "A", 6, 18, ct);
        var xavier = await EligibleRampAgentAsync(provider, connection, "Ximena", "QA-RA-302", "40212345629",
            "ximena.relevo@dev.elevant.test", day, "A", ["A"], ct);
        var terminalA = await TerminalAsync(connection, "A", ct);

        // 3-J: the same key and body answer the board again instead of a second coverage.
        var coverage = new CreateCoverageInput(xavier.Profile, terminalA, [stands["A03"]], day, LocalAt(day, 8), LocalAt(day, 12),
            null, null, false);
        Task<CoverageResult> Create(CreateCoverageInput input, Guid? key) => RunScopedAsync(provider, services => services
            .GetRequiredService<IPositionCoverageStore>().CreateAsync(SeededOccAccount, SeededPujStation, input, key, ct));
        var createKey = Guid.NewGuid();
        var created = await Create(coverage, createKey);
        Assert.Null(created.Failure);
        var coverageId = Assert.Single(created.Board!.Coverages, item => item.AgentId == xavier.Profile).Id;
        var replayed = await Create(coverage, createKey);
        Assert.Null(replayed.Failure);
        Assert.Single(replayed.Board!.Coverages, item => item.AgentId == xavier.Profile);
        var reused = await Create(coverage with { EndsAt = LocalAt(day, 13) }, createKey);
        Assert.Equal((PositionCoverageFailure.Conflict, "idempotency_conflict"), (reused.Failure, reused.Code));
        Assert.Equal((PositionCoverageFailure.Invalid, "idempotency_key_required"),
            ((await Create(coverage, Guid.Empty)).Failure, (await Create(coverage, Guid.Empty)).Code));
        // Without a key an old client's retry is still the rule it breaks.
        Assert.Contains("agent_overlap", (await Create(coverage, null)).Reasons);
        Task<CoverageResult> Release(Guid? key) => RunScopedAsync(provider, services => services
            .GetRequiredService<IPositionCoverageStore>().ReleaseAsync(SeededOccAccount, coverageId, day, key, ct));
        var releaseKey = Guid.NewGuid();
        Assert.Null((await Release(releaseKey)).Failure);
        Assert.Null((await Release(releaseKey)).Failure);
        await using (var check = CreateContext(connection))
        {
            Assert.Equal(1, await check.Set<PositionCoverage>().CountAsync(item => item.RampAgentId == xavier.Agent, ct));
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "occ.coverage.released" &&
                entry.EntityPublicId == coverageId, ct));
        }

        // A flight Riley works at A01.
        var planned = await PlanManualFlightAsync(provider, airline, stands["A01"], day, "ZZ903", LocalAt(day, 10),
            LocalAt(day, 12), ct);
        Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
        var (flight, operation) = await OperationOfAsync(connection, planned.TurnaroundId!.Value, ct);
        Assert.True((await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct)).IsSuccess);
        Guid rileyAssignment;
        Guid operationId;
        await using (var check = CreateContext(connection))
        {
            rileyAssignment = await check.OperationAgentAssignments.Where(item => item.GroundOperationId == operation &&
                item.ReleasedAt == null).Select(item => item.PublicId).SingleAsync(ct);
            operationId = await check.GroundOperations.Where(item => item.Id == operation).Select(item => item.PublicId)
                .SingleAsync(ct);
        }
        Task<OccHandoverResult<OccOperationHandoverData>> HandOver(Guid agent, Guid expected, string reason, Guid? key) =>
            RunScopedAsync(provider, services => services.GetRequiredService<IPositionCoverageStore>()
                .HandOverOperationAsync(SeededOccAccount, flight, new HandOverOperationInput(agent, expected, reason), key, ct));
        const string Reason = "Riley terminó su turno a mitad del servicio.";

        // Before the start there is nothing to hand over: OCC releases and assigns instead.
        Assert.Equal("handover_not_allowed", (await RunScopedAsync(provider, services => services
            .GetRequiredService<IPositionCoverageStore>().ReadHandoverOptionsAsync(SeededOccAccount, flight, ct))).Code);
        Assert.Equal("handover_not_allowed", (await HandOver(xavier.Profile, rileyAssignment, Reason, Guid.NewGuid())).Code);

        // Riley starts it on the tablet and reports a deviation.
        var installation = Guid.Parse("81000000-0000-7000-8000-0000000000f3");
        Assert.True((await RunScopedAsync(provider, services => services.GetRequiredService<IMobileDeviceCommandStore>()
            .RegisterAsync(new MobileDeviceRegistrationWriteRequest(SeededRampAgentAccount, installation, MobilePlatform.Android,
                "1.2.3", "Handover SQL test tablet", "Android 16"), ct))).IsSuccess);
        var startKey = Guid.NewGuid();
        Assert.True((await RunScopedAsync(provider, services => services.GetRequiredService<IRampOperationsCommandStore>()
            .StartOperationAsync(new RampOperationStartWriteRequest(SeededRampAgentAccount, [SeededPujStation], operationId,
                installation, startKey, startKey, "handover-start"), ct))).IsSuccess);
        var incidentKey = Guid.NewGuid();
        Assert.True((await RunScopedAsync(provider, services => services.GetRequiredService<IRampIncidentStore>().ReportAsync(
            new RampIncidentWriteRequest(SeededRampAgentAccount, [SeededPujStation], operationId, RampIncidentPolicy.Deviation,
                IncidentSeverity.Medium, "GPU no disponible al bloqueo", DateTimeOffset.UtcNow, installation, incidentKey,
                incidentKey, "handover-incident", "34"), ct))).IsSuccess);

        // 3-J: a started operation is not released: it is handed over.
        Assert.Equal((PositionCoverageFailure.Conflict, "operation_started"), Outcome(await RunScopedAsync(provider, services =>
            services.GetRequiredService<IPositionCoverageStore>().ReleaseOperationAgentAsync(SeededOccAccount, flight,
                new ReleaseOperationAgentInput(rileyAssignment, Guid.NewGuid()), ct))));

        // The options list who may take the rest of it: never Riley himself.
        var options = await RunScopedAsync(provider, services => services.GetRequiredService<IPositionCoverageStore>()
            .ReadHandoverOptionsAsync(SeededOccAccount, flight, ct));
        Assert.Null(options.Failure);
        Assert.Equal(("InProgress", rileyAssignment, RileyProfile), (options.Value!.OperationStatus,
            options.Value.CurrentAssignmentId, options.Value.CurrentAgentId));
        Assert.DoesNotContain(options.Value.Agents, item => item.Id == RileyProfile);
        Assert.True(Assert.Single(options.Value.Agents, item => item.Id == xavier.Profile).Eligible);

        // The command's guards, each with its code.
        Assert.Equal("idempotency_key_required", (await HandOver(xavier.Profile, rileyAssignment, Reason, null)).Code);
        Assert.Equal("reason_required", (await HandOver(xavier.Profile, rileyAssignment, "Ok", Guid.NewGuid())).Code);
        Assert.Equal("assignment_changed", (await HandOver(xavier.Profile, Guid.NewGuid(), Reason, Guid.NewGuid())).Code);
        Assert.Equal("same_agent", (await HandOver(RileyProfile, rileyAssignment, Reason, Guid.NewGuid())).Code);
        Guid mateo;
        await using (var check = CreateContext(connection))
            mateo = await check.RampAgents.Where(item => item.EmployeeNumber == "DEV-RA-002").Select(item => item.PublicId)
                .SingleAsync(ct);
        Assert.Equal("agent_not_eligible", (await HandOver(mateo, rileyAssignment, Reason, Guid.NewGuid())).Code);

        // Ximena takes it: the operation keeps its status and evidence; the same key and body replay the answer.
        var key = Guid.NewGuid();
        var handed = await HandOver(xavier.Profile, rileyAssignment, Reason, key);
        Assert.Null(handed.Failure);
        Assert.Equal((xavier.Profile, RileyProfile, false), (handed.Value!.AgentId, handed.Value.PreviousAgentId,
            handed.Value.Replayed));
        var again = await HandOver(xavier.Profile, rileyAssignment, Reason, key);
        Assert.Equal((handed.Value.AssignmentId, true), (again.Value!.AssignmentId, again.Value.Replayed));
        Assert.Equal("idempotency_conflict", (await HandOver(xavier.Profile, rileyAssignment, Reason + " Otro.", key)).Code);
        await using (var check = CreateContext(connection))
        {
            Assert.Equal(GroundOperationStatus.InProgress, (await check.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == operation, ct)).CurrentStatus);
            var assignments = await check.OperationAgentAssignments.AsNoTracking().Where(item => item.GroundOperationId == operation)
                .ToArrayAsync(ct);
            Assert.NotNull(assignments.Single(item => item.PublicId == rileyAssignment).ReleasedAt);
            Assert.Equal(xavier.Agent, assignments.Single(item => item.ReleasedAt == null).RampAgentId);
            Assert.Equal(riley, (await check.Set<Incident>().AsNoTracking().SingleAsync(item => item.PublicId == incidentKey, ct))
                .ReportedByRampAgentId);
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == EfPositionCoverageStore.HandedOverAuditAction &&
                entry.Reason == Reason, ct));
            var notices = await check.OperationalNotifications.AsNoTracking().Where(item => item.GroundOperationId == operation)
                .Select(item => item.Kind).ToArrayAsync(ct);
            Assert.Contains("assignment_released", notices);
            Assert.Contains("operation_assigned", notices);
        }

        // Riley's tablet no longer lists it; Ximena's does, even though it started before her.
        var rileyList = await RunScopedAsync(provider, services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(SeededRampAgentAccount, [SeededPujStation], ct));
        Assert.DoesNotContain(rileyList.Operations!, item => item.Operation.Id == operationId);
        var ximenaList = await RunScopedAsync(provider, services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(xavier.Account, [SeededPujStation], ct));
        Assert.Contains(ximenaList.Operations!, item => item.Operation.Id == operationId);

        // OCC still records the attendance of the agent relieved: he worked until the handover.
        var attendance = await RunScopedAsync(provider, services => services.GetRequiredService<IAttendanceDraftStore>()
            .SaveAsync(new AttendanceDraftWriteRequest(SeededOccAccount, operationId, rileyAssignment, AttendanceDraftLane.Occ, 0,
                LocalAt(day, 10), LocalAt(day, 11), null, Guid.NewGuid(), null, "handover-attendance"), ct));
        Assert.True(attendance.IsSuccess, attendance.Failure?.ToString());

        // The planning board no longer lists Riley; the list of OCC's attendance does, with his release, and leaves out an
        // assignment released before the start (nobody worked it).
        await using (var setup = CreateContext(connection))
        {
            var startedAt = (await setup.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == operation, ct))
                .ActualStartAt!.Value;
            var mateoAgent = await setup.RampAgents.Where(item => item.PublicId == mateo).Select(item => item.Id)
                .SingleAsync(ct);
            setup.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation, RampAgentId = mateoAgent,
                AssignmentRole = "RampAgent", AssignedAt = startedAt.AddMinutes(-30), ReleasedAt = startedAt.AddMinutes(-10),
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
        }
        Task<OccAttendanceAssignmentsReadResult> ListAttendance(Guid actor, Guid turnaround) => RunScopedAsync(provider,
            services => services.GetRequiredService<IAttendanceDraftStore>().ListOccAssignmentsAsync(actor, turnaround, ct));
        var listed = await ListAttendance(SeededOccAccount, flight);
        Assert.True(listed.IsSuccess, listed.Failure?.ToString());
        Assert.Equal((flight, operationId), (listed.Assignments!.TurnaroundId, listed.Assignments.OperationId));
        Assert.Equal([rileyAssignment, handed.Value.AssignmentId],
            listed.Assignments.Assignments.Select(item => item.AssignmentId));
        var relieved = listed.Assignments.Assignments[0];
        Assert.Equal((RileyProfile, "DEV-RA-001"), (relieved.AgentId, relieved.EmployeeNumber));
        Assert.NotNull(relieved.ReleasedAt);
        Assert.Equal((xavier.Profile, (DateTimeOffset?)null),
            (listed.Assignments.Assignments[1].AgentId, listed.Assignments.Assignments[1].ReleasedAt));
        // OCC's lane only, in the flight's station: the tablet's account is refused and an unknown flight is not found.
        Assert.Equal(AttendanceDraftFailure.Forbidden, (await ListAttendance(SeededRampAgentAccount, flight)).Failure);
        Assert.Equal(AttendanceDraftFailure.NotFound, (await ListAttendance(SeededOccAccount, Guid.NewGuid())).Failure);
    }
}
