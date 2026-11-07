using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 3, block B: one rule of what occupies an agent and a stand (3-D): up to three simultaneous operations per agent,
/// an approved or closed flight frees both, a holding operation without a window fails closed and a junior needs a
/// mentor; the tablet always lists its current flights (3-N01), a started operation follows its agent (3-N03) and a
/// contract out of force stops the start and tells OCC (3-N04).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>A shift of <paramref name="agentKey"/> on <paramref name="day"/> in a terminal of PUJ, as the seed's.</summary>
    private static async Task AddRampShiftAsync(string connectionString, long agentKey, DateOnly day, string terminalCode,
        int startHour, int endHour, CancellationToken ct)
    {
        await using var context = CreateContext(connectionString);
        var station = await context.Stations.Where(item => item.PublicId == SeededPujStation).Select(item => item.Id)
            .SingleAsync(ct);
        var terminal = await context.Terminals.Where(item => item.StationId == station && item.Code == terminalCode)
            .Select(item => item.Id).SingleAsync(ct);
        var position = await context.OperationalPositions.Where(item => item.Code == "RAMP-AGENT").Select(item => item.Id)
            .SingleAsync(ct);
        context.ShiftAssignments.Add(new ShiftAssignment
        {
            PublicId = Guid.CreateVersion7(), RampAgentId = agentKey, StationId = station, TerminalId = terminal,
            OperationalPositionId = position, WorkDate = day, StartsAtLocal = new TimeOnly(startHour, 0),
            EndsAtLocal = new TimeOnly(endHour, 0),
            Block = startHour < 12 ? ShiftBlock.Morning : startHour < 18 ? ShiftBlock.Afternoon : ShiftBlock.Night,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(ct);
    }

    /// <summary>A stand of PUJ the seed does not have.</summary>
    private static async Task AddPujStandAsync(string connectionString, string code, string terminalCode, CancellationToken ct)
    {
        await using var context = CreateContext(connectionString);
        var station = await context.Stations.Where(item => item.PublicId == SeededPujStation).Select(item => item.Id)
            .SingleAsync(ct);
        if (await context.Stands.AnyAsync(item => item.StationId == station && item.Code == code, ct)) return;
        var terminal = await context.Terminals.Where(item => item.StationId == station && item.Code == terminalCode)
            .Select(item => item.Id).SingleAsync(ct);
        context.Stands.Add(new Stand
        {
            PublicId = Guid.CreateVersion7(), StationId = station, TerminalId = terminal, Code = code, StandType = "Contact",
            IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(ct);
    }

    /// <summary>OCC's assignment of <paramref name="agent"/> through the planning options and their version.</summary>
    private static async Task<OccAssignmentWriteResult> AssignThroughPlanningAsync(IServiceProvider provider, Guid turnaroundId,
        Guid agent, CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var options = await scope.ServiceProvider.GetRequiredService<IOccPlanningReadStore>()
            .GetOptionsAsync([SeededPujStation], turnaroundId, ct);
        Assert.True(options.IsSuccess, options.Failure?.ToString());
        Assert.True(OccPlanningConcurrencyToken.TryDecode(options.Options!.Turnaround.ConcurrencyToken, out var version));
        return await scope.ServiceProvider.GetRequiredService<IOccPlanningCommandStore>().AssignOperationAsync(
            new OccAssignmentWriteRequest(SeededOccAccount, [SeededPujStation], turnaroundId, agent, version, Guid.NewGuid(),
                "agent-capacity"), ct);
    }

    private static async Task<OccAgentCandidateData> CandidateAsync(IServiceProvider provider, Guid turnaroundId,
        string employeeNumber, CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var options = await scope.ServiceProvider.GetRequiredService<IOccPlanningReadStore>()
            .GetOptionsAsync([SeededPujStation], turnaroundId, ct);
        Assert.True(options.IsSuccess, options.Failure?.ToString());
        return Assert.Single(options.Options!.AgentCandidates, item => item.EmployeeNumber == employeeNumber);
    }

    private static Task<ManualTurnaroundWriteResult> PlanManualFlightAsync(IServiceProvider provider, Guid airline, Guid stand,
        DateOnly day, string number, DateTimeOffset arrival, DateTimeOffset departure, CancellationToken ct) =>
        RunScopedAsync(provider, services => services.GetRequiredService<IManualTurnaroundStore>().CreateAsync(
            new ManualTurnaroundWriteRequest(SeededOccAccount, [SeededPujStation], Guid.CreateVersion7(), SeededPujStation,
                airline, stand, day, number, "MIA", arrival, number + "D", "MIA", departure, Guid.NewGuid(), "agent-capacity"),
            ct));

    private static async Task<T> RunScopedAsync<T>(IServiceProvider provider, Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = provider.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    /// <summary>3-D: three simultaneous flights per agent; approved or closed ones free the agent and the stand.</summary>
    [Fact]
    public async Task AnAgentCarriesUpToThreeFlightsAndApprovedFlightsFreeTheAgentAndTheStand()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        await AddPujStandAsync(database.ConnectionString, "A04", "A", ct);
        var (airline, stands) = await PlanningFixtureAsync(database.ConnectionString, ct);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        long riley;
        await using (var setup = CreateContext(database.ConnectionString))
            riley = await setup.RampAgents.Where(item => item.PublicId == RileyProfile).Select(item => item.Id).SingleAsync(ct);
        await AddRampShiftAsync(database.ConnectionString, riley, day, "A", 6, 18, ct);

        // Four flights of terminal A whose windows overlap between 11:30 and 12:00.
        var flights = new List<Guid>();
        foreach (var (stand, number, from) in new[] { ("A01", "ZZ811", 600), ("A02", "ZZ813", 630), ("A03", "ZZ815", 660),
                     ("A04", "ZZ817", 690) })
        {
            var planned = await PlanManualFlightAsync(provider, airline, stands[stand], day, number,
                LocalAt(day, from / 60, from % 60), LocalAt(day, from / 60 + 2, from % 60), ct);
            Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
            flights.Add(planned.TurnaroundId!.Value);
        }

        // Up to three at once (Pillier); the fourth is one too many, in the options and in the command.
        foreach (var flight in flights.Take(3))
        {
            var assigned = await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct);
            Assert.True(assigned.IsSuccess, assigned.Failure?.ToString());
        }
        var atCapacity = await CandidateAsync(provider, flights[3], "DEV-RA-001", ct);
        Assert.True(atCapacity.HasAssignmentConflict);
        Assert.Equal(["assignment_conflict"], OccAgentEligibilityPolicy.Evaluate(atCapacity).EligibilityReasons);
        Assert.Equal(OccAssignmentWriteFailure.Conflict,
            (await AssignThroughPlanningAsync(provider, flights[3], RileyProfile, ct)).Failure);

        // OCC approves the first one: it keeps its agent and stand of record but no longer occupies them.
        long firstOperation;
        await using (var approve = CreateContext(database.ConnectionString))
        {
            var turnaround = await approve.Turnarounds.SingleAsync(item => item.PublicId == flights[0], ct);
            var operation = await approve.GroundOperations.SingleAsync(item => item.TurnaroundId == turnaround.Id, ct);
            firstOperation = operation.Id;
            operation.CurrentStatus = GroundOperationStatus.Approved;
            turnaround.CurrentStatus = TurnaroundStatus.Completed;
            await approve.SaveChangesAsync(ct);
            var outbox = await approve.OutboxMessages.CountAsync(ct);
            await RampAgentRelease.ReleaseOnApprovalAsync(approve, operation, turnaround.StationId, DateTimeOffset.UtcNow, ct);
            await approve.SaveChangesAsync(ct);
            // The board and the agent's schedule hear that both are free; nothing is closed.
            Assert.True(await approve.OutboxMessages.CountAsync(ct) > outbox);
            Assert.True(await approve.OutboxMessages.AnyAsync(item => item.PayloadJson.Contains("ramp_schedule"), ct));
            Assert.True(await approve.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == operation.Id &&
                item.ReleasedAt == null, ct));
            Assert.True(await approve.Set<StandAssignment>().AnyAsync(item => item.TurnaroundId == turnaround.Id &&
                item.AssignedTo == null, ct));
        }
        Assert.False((await CandidateAsync(provider, flights[3], "DEV-RA-001", ct)).HasAssignmentConflict);
        var fourth = await AssignThroughPlanningAsync(provider, flights[3], RileyProfile, ct);
        Assert.True(fourth.IsSuccess, fourth.Failure?.ToString());

        // The one count: an approved flight without a window never counts; a holding one without a window always does.
        await using (var counts = CreateContext(database.ConnectionString))
        {
            await counts.GroundOperations.Where(item => item.Id == firstOperation).ExecuteUpdateAsync(update => update
                .SetProperty(item => item.PlannedStartAt, (DateTimeOffset?)null)
                .SetProperty(item => item.PlannedEndAt, (DateTimeOffset?)null), ct);
            var evening = (LocalAt(day, 20), LocalAt(day, 21));
            Assert.Equal(0, (await AgentSimultaneity.CountOverlapsAsync(counts, [riley], null, evening.Item1, evening.Item2, ct))
                .GetValueOrDefault(riley));
            var third = await counts.Turnarounds.Where(item => item.PublicId == flights[2]).Select(item => item.Id).SingleAsync(ct);
            await counts.GroundOperations.Where(item => item.TurnaroundId == third).ExecuteUpdateAsync(update => update
                .SetProperty(item => item.PlannedStartAt, (DateTimeOffset?)null), ct);
            Assert.Equal(1, (await AgentSimultaneity.CountOverlapsAsync(counts, [riley], null, evening.Item1, evening.Item2, ct))
                .GetValueOrDefault(riley));
        }

        // The closed flight frees its stand too: a manual flight and a moved flight take A01 in its window.
        var onClosedStand = await PlanManualFlightAsync(provider, airline, stands["A01"], day, "ZZ821", LocalAt(day, 10, 15),
            LocalAt(day, 10, 45), ct);
        Assert.True(onClosedStand.Failure is null, onClosedStand.Code ?? onClosedStand.Failure?.ToString());
        var parked = await PlanManualFlightAsync(provider, airline, stands["B02"], day, "ZZ823", LocalAt(day, 11),
            LocalAt(day, 12), ct);
        Assert.True(parked.Failure is null, parked.Code ?? parked.Failure?.ToString());
        Assert.Null((await RunScopedAsync(provider, services => services.GetRequiredService<IOccPositionStore>()
            .AssignAsync(SeededOccAccount, parked.TurnaroundId!.Value, stands["A01"], null, OccPositionCommand.None, ct))).Failure);
        // A flight still assigned keeps holding its stand.
        var taken = await PlanManualFlightAsync(provider, airline, stands["A02"], day, "ZZ825", LocalAt(day, 11), LocalAt(day, 12),
            ct);
        Assert.Equal(ManualTurnaroundWriteFailure.Conflict, taken.Failure);

        // Pillier: an agent with less than three months never works alone; a coverage with a mentor makes them eligible.
        await using (var junior = CreateContext(database.ConnectionString))
        {
            await junior.RampAgents.Where(item => item.Id == riley).ExecuteUpdateAsync(update => update
                .SetProperty(item => item.HireDate, day.AddMonths(-1)), ct);
        }
        var alone = await CandidateAsync(provider, onClosedStand.TurnaroundId!.Value, "DEV-RA-001", ct);
        Assert.True(alone.RequiresMentor);
        Assert.Contains("mentor_required", OccAgentEligibilityPolicy.Evaluate(alone).EligibilityReasons);
        await using (var mentoring = CreateContext(database.ConnectionString))
        {
            var fixture = await ReleaseFixtureAsync(mentoring, ct);
            var mateo = await mentoring.RampAgents.Where(item => item.EmployeeNumber == "DEV-RA-002").Select(item => item.Id)
                .SingleAsync(ct);
            mentoring.Add(Coverage(fixture, riley, mateo, LocalAt(day, 9), LocalAt(day, 13)));
            await mentoring.SaveChangesAsync(ct);
        }
        Assert.False((await CandidateAsync(provider, onClosedStand.TurnaroundId!.Value, "DEV-RA-001", ct)).RequiresMentor);
    }

    /// <summary>
    /// 3-N01 and 3-N03: the tablet lists today's flight first even with a long history, drops approvals older than two
    /// days, and an operation the agent started stays in their scope when OCC moves it to a terminal they have no scope in.
    /// </summary>
    [Fact]
    public async Task TheTabletListsItsCurrentFlightsAndAStartedOperationFollowsItsAgent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        var agent = SeededRampAgentAccount;
        var station = SeededPujStation;
        var now = DateTimeOffset.UtcNow;
        var today = BusinessCalendar.Today(now, StationZone);
        long recentApproved;
        Guid todaysFlight;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var fixture = await ReleaseFixtureAsync(setup, ct);
            // 120 approved flights of the last months (their assignments stay as the record) and one of two hours ago.
            for (var index = 0; index < 120; index++)
            {
                var old = await AddAgentOperationAsync(setup, fixture, $"HIST-{index:D3}", today.AddDays(-10 - index % 60),
                    fixture.AgentKey, GroundOperationStatus.Approved, ct);
                await setup.GroundOperations.Where(item => item.Id == old).ExecuteUpdateAsync(update => update
                    .SetProperty(item => item.ActualStartAt, now.AddDays(-10 - index % 60))
                    .SetProperty(item => item.ActualEndAt, now.AddDays(-10 - index % 60).AddHours(1)), ct);
            }
            recentApproved = await AddAgentOperationAsync(setup, fixture, "HIST-RECENT", today, fixture.AgentKey,
                GroundOperationStatus.Approved, ct);
            await setup.GroundOperations.Where(item => item.Id == recentApproved).ExecuteUpdateAsync(update => update
                .SetProperty(item => item.ActualStartAt, now.AddHours(-3))
                .SetProperty(item => item.ActualEndAt, now.AddHours(-2)), ct);
            var todays = await AddAgentOperationAsync(setup, fixture, "TODAY-ASSIGNED", today, fixture.AgentKey,
                GroundOperationStatus.Assigned, ct);
            todaysFlight = await setup.GroundOperations.Where(item => item.Id == todays).Select(item => item.PublicId)
                .SingleAsync(ct);
        }

        var listed = await RunScopedAsync(provider, services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(agent, [station], ct));
        Assert.Null(listed.Failure);
        var operations = listed.Operations!;
        Assert.DoesNotContain(operations, item => item.Turnaround.OperationCode.StartsWith("HIST-", StringComparison.Ordinal) &&
            item.Turnaround.OperationCode != "HIST-RECENT");
        // The active ones first, the recent approval after them.
        Assert.Contains(operations, item => item.Operation.Id == todaysFlight);
        var approvedIndex = operations.ToList().FindIndex(item => item.Turnaround.OperationCode == "HIST-RECENT");
        Assert.True(approvedIndex >= 0);
        Assert.All(operations.Take(approvedIndex), item => Assert.NotEqual("Approved", item.Operation.Status));

        // 3-N03: Riley starts the seeded DEV-TAT-0001 (terminal A) and OCC moves the flight to B01, a terminal Riley has no
        // scope in: the tablet keeps listing it and the agent keeps recording its evidence.
        var installation = Guid.Parse("81000000-0000-7000-8000-0000000000c3");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        Assert.True((await RunScopedAsync(provider, services => services.GetRequiredService<IMobileDeviceCommandStore>()
            .RegisterAsync(new MobileDeviceRegistrationWriteRequest(agent, installation, MobilePlatform.Android, "1.2.3",
                "Scope SQL test tablet", "Android 16"), ct))).IsSuccess);
        var startKey = Guid.NewGuid();
        Assert.True((await RunScopedAsync(provider, services => services.GetRequiredService<IRampOperationsCommandStore>()
            .StartOperationAsync(new RampOperationStartWriteRequest(agent, [station], operationId, installation, startKey,
                startKey, "scope-start"), ct))).IsSuccess);
        Guid b01;
        await using (var check = CreateContext(database.ConnectionString))
            b01 = await check.Stands.Where(item => item.Code == "B01").Select(item => item.PublicId).SingleAsync(ct);
        Assert.Null((await RunScopedAsync(provider, services => services.GetRequiredService<IOccPositionStore>()
            .AssignAsync(SeededOccAccount, Guid.Parse("70000000-0000-7000-8000-000000000001"), b01, "Cambio del aeropuerto",
                OccPositionCommand.None, ct))).Failure);
        var moved = await RunScopedAsync(provider, services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(agent, [station], ct));
        var started = Assert.Single(moved.Operations!, item => item.Operation.Id == operationId);
        Assert.Equal("B01", started.Turnaround.Stand?.Code);
        var milestone = await RunScopedAsync(provider, services => services.GetRequiredService<IRampExecutionCommandStore>()
            .RecordMilestoneAsync(new RampMilestoneWriteRequest(agent, [station], operationId, "BLOCK_ON",
                DateTimeOffset.UtcNow.AddMinutes(-1), installation, Guid.NewGuid(), "scope-milestone"), ct));
        Assert.True(milestone.IsSuccess, milestone.Failure?.ToString());
        await using (var check = CreateContext(database.ConnectionString))
        {
            var operation = await check.GroundOperations.AsNoTracking().SingleAsync(item => item.PublicId == operationId, ct);
            Assert.Equal(GroundOperationStatus.InProgress, operation.CurrentStatus);
            Assert.NotNull(operation.ActualStartAt);
        }
    }

    /// <summary>
    /// 3-N04: a suspended contract stops the start of what has not started (the receipt replays the refusal), what is in
    /// progress goes on, a charter has no contract to lose, and OCC hears it once per operation that can no longer start.
    /// </summary>
    [Fact]
    public async Task AContractOutOfForceStopsTheStartAndTellsOcc()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        var agent = SeededRampAgentAccount;
        var station = SeededPujStation;
        var installation = Guid.Parse("81000000-0000-7000-8000-0000000000c4");
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone);
        Assert.True((await RunScopedAsync(provider, services => services.GetRequiredService<IMobileDeviceCommandStore>()
            .RegisterAsync(new MobileDeviceRegistrationWriteRequest(agent, installation, MobilePlatform.Android, "1.2.3",
                "Contract SQL test tablet", "Android 16"), ct))).IsSuccess);
        Task<StartedOperation> StartAsync(Guid operationId, Guid key) =>
            RunScopedAsync(provider, async services =>
            {
                var result = await services.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
                    new RampOperationStartWriteRequest(agent, [station], operationId, installation, key, key, "contract-start"),
                    ct);
                return new StartedOperation(result.IsSuccess, result.Failure, result.Code);
            });

        // Riley started DEV-TAT-0001 before the suspension; tomorrow's flight is assigned and a charter is planned.
        var inProgress = Guid.Parse("70000000-0000-7000-8000-000000000005");
        Assert.True((await StartAsync(inProgress, Guid.NewGuid())).Started);
        long contractId, assignedOperation;
        Guid assignedPublicId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var fixture = await ReleaseFixtureAsync(setup, ct);
            assignedOperation = await AddAgentOperationAsync(setup, fixture, "CONTRACT-ASSIGNED", today.AddDays(1),
                fixture.AgentKey, GroundOperationStatus.Assigned, ct);
            assignedPublicId = await setup.GroundOperations.Where(item => item.Id == assignedOperation)
                .Select(item => item.PublicId).SingleAsync(ct);
            contractId = await setup.Contracts.Where(item => item.ContractCode == "DEV-CONTRACT-0001").Select(item => item.Id)
                .SingleAsync(ct);
        }

        // The sweep or Contratos suspends the contract (ContractActivation.AnnounceAsync, as every lifecycle change).
        await using (var suspend = CreateContext(database.ConnectionString))
        {
            var contract = await suspend.Contracts.SingleAsync(item => item.Id == contractId, ct);
            contract.Status = ContractStatus.Suspended;
            contract.UpdatedAt = DateTimeOffset.UtcNow;
            await Elevant.Persistence.Commercial.ContractActivation.AnnounceAsync(suspend, contract, "contract_suspended",
                DateTimeOffset.UtcNow, ct);
            await suspend.SaveChangesAsync(ct);
        }
        await using (var check = CreateContext(database.ConnectionString))
        {
            var notices = await check.OperationalNotifications.AsNoTracking()
                .Where(item => item.Kind == ContractOperationsNotice.Kind).ToArrayAsync(ct);
            Assert.Contains(notices, item => item.GroundOperationId == assignedOperation);
            // The operation in progress ends normally: OCC is not told to stop it.
            var running = await check.GroundOperations.Where(item => item.PublicId == inProgress).Select(item => item.Id)
                .SingleAsync(ct);
            Assert.DoesNotContain(notices, item => item.GroundOperationId == running);
        }

        // The start is refused with its code; the same tap replays the refusal from the device receipt.
        var key = Guid.NewGuid();
        var refused = await StartAsync(assignedPublicId, key);
        Assert.Equal((false, RampOperationStartWriteFailure.Conflict, "contract_not_in_force"),
            (refused.Started, refused.Failure, refused.Code));
        Assert.Equal(refused, await StartAsync(assignedPublicId, key));
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.Equal("contract_not_in_force", (await check.MobileCommandReceipts.AsNoTracking()
                .SingleAsync(item => item.IdempotencyKey == key.ToString("D"), ct)).ErrorCode);
            Assert.Equal(GroundOperationStatus.Assigned, (await check.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == assignedOperation, ct)).CurrentStatus);
        }

        // What started keeps working: the agent records its evidence.
        var milestone = await RunScopedAsync(provider, services => services.GetRequiredService<IRampExecutionCommandStore>()
            .RecordMilestoneAsync(new RampMilestoneWriteRequest(agent, [station], inProgress, "BLOCK_ON",
                DateTimeOffset.UtcNow.AddMinutes(-1), installation, Guid.NewGuid(), "contract-milestone"), ct));
        Assert.True(milestone.IsSuccess, milestone.Failure?.ToString());

        // A charter flies without a contract (ADR-0033): it starts.
        await using (var charter = CreateContext(database.ConnectionString))
        {
            var fixture = await ReleaseFixtureAsync(charter, ct);
            var operation = await charter.GroundOperations.SingleAsync(item => item.Id == assignedOperation, ct);
            charter.Set<CharterAgreement>().Add(new CharterAgreement
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = operation.TurnaroundId, AirlineId = fixture.AirlineKey,
                CurrencyCode = "USD", PrepaymentStatus = CharterPrepaymentStatus.Pending, CreatedByAccountId = fixture.OccKey,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await charter.SaveChangesAsync(ct);
        }
        Assert.True((await StartAsync(assignedPublicId, Guid.NewGuid())).Started);
    }

    private sealed record StartedOperation(bool Started, RampOperationStartWriteFailure? Failure, string? Code);
}
