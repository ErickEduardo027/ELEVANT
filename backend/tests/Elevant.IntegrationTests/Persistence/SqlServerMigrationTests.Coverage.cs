using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0030: OCC covers stands per shift under Pillier's rules, configures stands and combined
    /// stands, and a flight follows the agent covering its new stand when the airport moves it.
    /// </summary>
    [Fact]
    public async Task PositionCoverageAppliesRulesAndTheFlightFollowsTheCoveringAgent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seeder = CreateContext(connection))
            await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, ct);
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var date = new DateOnly(2026, 8, 19);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Task<CoverageResult> Coverage(Func<IPositionCoverageStore, Task<CoverageResult>> action) =>
            Run(services => action(services.GetRequiredService<IPositionCoverageStore>()));

        // The board lists the shift's agent, both terminals with their rules and the bridge stands.
        var board = (await Coverage(store => store.ReadAsync(occ, stationId, date, ct))).Board!;
        Assert.True(board.CanAssign);
        Assert.True(board.CanConfigure);
        var riley = Assert.Single(board.Agents, agent => agent.EmployeeNumber == "DEV-RA-001");
        Assert.False(riley.IsJunior);
        var terminalA = Assert.Single(board.Terminals, terminal => terminal.Code == "A");
        var terminalB = Assert.Single(board.Terminals, terminal => terminal.Code == "B");
        Assert.Equal(3, terminalA.MaxStandsPerAgent);
        Assert.Equal(2, terminalB.MaxStandsPerAgent);
        Assert.True(terminalB.RequiresBridgeQualification);
        Guid Stand(string code) => board.Stands.Single(stand => stand.Code == code).StandId;
        Assert.True(board.Stands.Single(stand => stand.Code == "B01").HasBoardingBridge);

        // Two stands of terminal A for the whole shift.
        var created = await Coverage(store => store.CreateAsync(occ, stationId, new CreateCoverageInput(riley.AgentId,
            terminalA.TerminalId, [Stand("A01"), Stand("A02")], date, null, null, null, null, false), ct));
        Assert.Null(created.Failure);
        var coverage = Assert.Single(created.Board!.Coverages);
        Assert.Equal(["A01", "A02"], coverage.Stands.Select(stand => stand.Code));
        Assert.Equal(riley.ShiftStartsAt, coverage.StartsAt);
        Assert.Contains(riley.Name, created.Board.Stands.Single(stand => stand.Code == "A01").CoveredBy);

        // The rules: no second overlapping coverage, and terminal B needs the bridge qualification.
        var overlap = await Coverage(store => store.CreateAsync(occ, stationId, new CreateCoverageInput(riley.AgentId,
            terminalA.TerminalId, [Stand("A01")], date, null, null, null, null, false), ct));
        Assert.Equal(PositionCoverageFailure.Rejected, overlap.Failure);
        Assert.Contains("agent_overlap", overlap.Reasons);
        var bridge = await Coverage(store => store.CreateAsync(occ, stationId, new CreateCoverageInput(riley.AgentId,
            terminalB.TerminalId, [Stand("B01")], date, null, null, null, null, false), ct));
        Assert.Contains("bridge_qualification_required", bridge.Reasons);
        var outsideShift = await Coverage(store => store.CreateAsync(occ, stationId, new CreateCoverageInput(riley.AgentId,
            terminalA.TerminalId, [Stand("A01")], date.AddDays(5), null, null, null, null, false), ct));
        Assert.Equal(["shift_not_covering"], outsideShift.Reasons);

        // OCC configures terminals, stands and combined stands.
        Assert.Equal(1, (await Coverage(store => store.UpdateTerminalAsync(occ, terminalB.TerminalId,
            new TerminalRulesInput(1, true), date, ct))).Board!.Terminals.Single(item => item.Code == "B").MaxStandsPerAgent);
        Assert.Equal(PositionCoverageFailure.Invalid, (await Coverage(store => store.UpdateTerminalAsync(occ,
            terminalB.TerminalId, new TerminalRulesInput(7, true), date, ct))).Failure);
        Assert.Equal("Narrowbody", (await Coverage(store => store.UpdateStandAsync(occ, Stand("B02"),
            new StandAttributesInput(true, false, "Narrowbody", true), date, ct))).Board!.Stands
            .Single(stand => stand.Code == "B02").MaxAircraftSize);
        Assert.Equal(PositionCoverageFailure.Invalid, (await Coverage(store => store.UpdateStandAsync(occ, Stand("B02"),
            new StandAttributesInput(true, false, "Huge", true), date, ct))).Failure);
        var rule = await Coverage(store => store.AddConstraintAsync(occ,
            new StandConstraintInput(Stand("A01"), Stand("A02"), "Cancels"), date, ct));
        var constraint = Assert.Single(rule.Board!.Constraints);
        Assert.Equal(("A01", "A02", "Cancels"), (constraint.StandCode, constraint.AffectedStandCode, constraint.Kind));
        Assert.Equal(PositionCoverageFailure.Conflict, (await Coverage(store => store.AddConstraintAsync(occ,
            new StandConstraintInput(Stand("A01"), Stand("A02"), "Cancels"), date, ct))).Failure);
        Assert.Equal(PositionCoverageFailure.Invalid, (await Coverage(store => store.AddConstraintAsync(occ,
            new StandConstraintInput(Stand("A01"), Stand("A02"), "Sometimes"), date, ct))).Failure);

        // Releasing keeps history and frees the agent.
        var released = await Coverage(store => store.ReleaseAsync(occ, coverage.Id, date, ct));
        Assert.Empty(released.Board!.Coverages);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.NotNull((await check.Set<PositionCoverage>().SingleAsync(item => item.PublicId == coverage.Id, ct)).ReleasedAt);

        // The airport moves DEV-TAT-0001 from A01 to B01 (no combination in between): the flight
        // follows the agent who covers B01 at block time, and both agents are told.
        await using var context = CreateContext(database.ConnectionString);
        var operation = await (from item in context.GroundOperations
                               join turnaround in context.Turnarounds on item.TurnaroundId equals turnaround.Id
                               where turnaround.OperationCode == "DEV-TAT-0001"
                               select new { item.Id, item.PlannedStartAt, Turnaround = turnaround.PublicId, turnaround.StationId, turnaround.OperationDate })
            .SingleAsync(ct);
        var first = await context.OperationAgentAssignments.SingleAsync(item => item.GroundOperationId == operation.Id &&
            item.ReleasedAt == null, ct);
        var mateo = await context.RampAgents.SingleAsync(item => item.EmployeeNumber == "DEV-RA-002", ct);
        var b01 = await context.Stands.SingleAsync(item => item.Code == "B01", ct);
        var account = await context.Users.Where(user => user.PublicId == occ).Select(user => user.Id).SingleAsync(ct);
        var terminalBId = await context.Terminals.Where(item => item.Code == "B").Select(item => item.Id).SingleAsync(ct);
        var mateoCoverage = new PositionCoverage
        {
            PublicId = Guid.CreateVersion7(), StationId = operation.StationId, TerminalId = terminalBId, RampAgentId = mateo.Id,
            StartsAt = operation.PlannedStartAt!.Value.AddHours(-1), EndsAt = operation.PlannedStartAt.Value.AddHours(5),
            AssignedByAccountId = account, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Add(mateoCoverage);
        await context.SaveChangesAsync(ct);
        context.Add(new PositionCoverageStand { PositionCoverageId = mateoCoverage.Id, StandId = b01.Id });
        await context.SaveChangesAsync(ct);

        var moved = await Run(services => services.GetRequiredService<IOccPositionStore>()
            .AssignAsync(occ, operation.Turnaround, b01.PublicId, "Cambio del aeropuerto", ct));
        Assert.Null(moved.Failure);
        // The map shows who covers each stand on the coverage's local day.
        var coverageDay = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(mateoCoverage.StartsAt,
            TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo")).DateTime);
        Assert.Contains("Mateo Candidato", (await Run(services => services.GetRequiredService<IOccPositionStore>()
            .ReadAsync(occ, stationId, coverageDay, ct))).Board!.Positions.Single(position => position.Code == "B01").CoveredBy ?? []);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var assignments = await check.OperationAgentAssignments.AsNoTracking()
                .Where(item => item.GroundOperationId == operation.Id).ToArrayAsync(ct);
            Assert.NotNull(assignments.Single(item => item.Id == first.Id).ReleasedAt);
            Assert.Equal(mateo.Id, assignments.Single(item => item.ReleasedAt == null).RampAgentId);
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "occ.operation.reassigned_by_stand", ct));
            Assert.Contains(await check.OperationalNotifications.AsNoTracking().Select(item => item.Kind).ToArrayAsync(ct),
                kind => kind == "assignment_released");
        }

        // A01 cancels A02: with A01 occupied by another flight in the same window, A02 is rejected.
        var other = await context.Turnarounds.Where(item => item.StationId == operation.StationId &&
                item.OperationCode != "DEV-TAT-0001" && item.CurrentStatus != TurnaroundStatus.Cancelled &&
                item.CurrentStatus != TurnaroundStatus.Completed)
            .Select(item => new { item.Id, item.PublicId }).FirstOrDefaultAsync(ct);
        if (other is not null)
        {
            var window = await context.GroundOperations.AsNoTracking().Where(item => item.Id == operation.Id)
                .Select(item => new { item.PlannedStartAt, item.PlannedEndAt }).SingleAsync(ct);
            await context.GroundOperations.Where(item => item.TurnaroundId == other.Id)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.PlannedStartAt, window.PlannedStartAt)
                    .SetProperty(item => item.PlannedEndAt, window.PlannedEndAt), ct);
            // Whichever of A01/A02 the other flight holds, the rule bites both ways: A01 cancels A02.
            var stands = await context.Stands.Where(item => item.Code == "A01" || item.Code == "A02")
                .ToDictionaryAsync(item => item.Code, item => new { item.Id, item.PublicId }, ct);
            var held = await context.Set<StandAssignment>().Where(item => item.TurnaroundId == other.Id && item.AssignedTo == null)
                .Select(item => (long?)item.StandId).SingleOrDefaultAsync(ct);
            if (held != stands["A01"].Id && held != stands["A02"].Id)
            {
                Assert.Null((await Run(services => services.GetRequiredService<IOccPositionStore>()
                    .AssignAsync(occ, other.PublicId, stands["A01"].PublicId, null, ct))).Failure);
                held = stands["A01"].Id;
            }
            var target = held == stands["A01"].Id ? stands["A02"] : stands["A01"];
            var cancelled = await Run(services => services.GetRequiredService<IOccPositionStore>()
                .AssignAsync(occ, operation.Turnaround, target.PublicId, null, ct));
            Assert.Equal(OccPositionFailure.Conflict, cancelled.Failure);
            Assert.Equal(["stand_cancelled"], cancelled.Reasons);
            var otherDate = await context.Turnarounds.Where(item => item.Id == other.Id).Select(item => item.OperationDate).SingleAsync(ct);
            if (held == stands["A01"].Id)
                Assert.Equal("A01", (await Run(services => services.GetRequiredService<IOccPositionStore>()
                    .ReadAsync(occ, stationId, otherDate, ct))).Board!.Positions.Single(position => position.Code == "A02").CancelledBy);
        }

        // OCC releases the agent before the start: the operation goes back to Planned for a new assignment.
        Assert.Null(await Run(services => services.GetRequiredService<IPositionCoverageStore>()
            .ReleaseOperationAgentAsync(occ, operation.Turnaround, ct)));
        Assert.Equal(PositionCoverageFailure.Conflict, await Run(services => services.GetRequiredService<IPositionCoverageStore>()
            .ReleaseOperationAgentAsync(occ, operation.Turnaround, ct)));
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.Equal(GroundOperationStatus.Planned, (await check.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == operation.Id, ct)).CurrentStatus);
            Assert.False(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == operation.Id &&
                item.ReleasedAt == null, ct));
        }
    }
}
