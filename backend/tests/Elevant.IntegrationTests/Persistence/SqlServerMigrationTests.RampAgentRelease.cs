using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 2, block D: the one release path of a ramp agent (2-N06, 2-N08), shifts guarded by their use and by
/// approved absences (2-N11, 2-N24), approved absences that Gestión Humana cancels or shortens (2-N22), the mentor's
/// absence and permit (2-N23), the documents that stop covering an assigned operation (2-N25), and the profile save
/// and employee update that reach the release path with their Idempotency-Key and expected version.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid RileyProfile = Guid.Parse("50000000-0000-7000-8000-000000000001");
    private static readonly Guid RileyAirportId = Guid.Parse("50000000-0000-7000-8000-000000000003");
    private static readonly Guid RileyRampLicense = Guid.Parse("50000000-0000-7000-8000-000000000004");

    private sealed record ReleaseFixture(long AgentKey, long StationKey, long TerminalKey, long AirlineKey, long OccKey,
        long RileyAccountKey);

    private static async Task<ReleaseFixture> ReleaseFixtureAsync(ElevantDbContext context, CancellationToken ct)
    {
        var agent = await context.RampAgents.AsNoTracking().SingleAsync(item => item.PublicId == RileyProfile, ct);
        var station = await context.Stations.AsNoTracking().Where(item => item.Code == "PUJ").Select(item => item.Id).SingleAsync(ct);
        var terminal = await context.Terminals.AsNoTracking().Where(item => item.StationId == station && item.Code == "A")
            .Select(item => item.Id).SingleAsync(ct);
        var airline = await context.Airlines.AsNoTracking().Where(item => item.IataCode == "ZZ").Select(item => item.Id)
            .SingleAsync(ct);
        var occ = await context.Users.AsNoTracking().Where(item => item.PublicId == OperationsAdministrator)
            .Select(item => item.Id).SingleAsync(ct);
        var riley = await context.Users.AsNoTracking().Where(item => item.PublicId == SeededRampAgentAccount)
            .Select(item => item.Id).SingleAsync(ct);
        return new ReleaseFixture(agent.Id, station, terminal, airline, occ, riley);
    }

    /// <summary>An operation of <paramref name="agentKey"/> at 10:00 local of <paramref name="day"/>.</summary>
    private static async Task<long> AddAgentOperationAsync(ElevantDbContext context, ReleaseFixture fixture, string code,
        DateOnly day, long agentKey, GroundOperationStatus status, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var turnaround = new Turnaround
        {
            PublicId = Guid.NewGuid(), OperationCode = code, AirlineId = fixture.AirlineKey, StationId = fixture.StationKey,
            OperationDate = day, CurrentStatus = TurnaroundStatus.Confirmed, Source = OperationalDataSource.Internal,
            CreatedAt = now, UpdatedAt = now,
        };
        context.Turnarounds.Add(turnaround);
        await context.SaveChangesAsync(ct);
        var start = BusinessCalendar.StartOfDay(day).AddHours(10);
        var operation = new GroundOperation
        {
            PublicId = Guid.NewGuid(), TurnaroundId = turnaround.Id, CurrentStatus = status,
            PlannedStartAt = start, PlannedEndAt = start.AddHours(1), CreatedAt = now, UpdatedAt = now,
        };
        context.GroundOperations.Add(operation);
        await context.SaveChangesAsync(ct);
        context.OperationAgentAssignments.Add(new OperationAgentAssignment
        {
            PublicId = Guid.NewGuid(), GroundOperationId = operation.Id, RampAgentId = agentKey, AssignmentRole = "RampAgent",
            AssignedAt = now, CreatedAt = now, UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);
        return operation.Id;
    }

    private static PositionCoverage Coverage(ReleaseFixture fixture, long agentKey, long? mentorKey, DateTimeOffset startsAt,
        DateTimeOffset endsAt) => new()
    {
        PublicId = Guid.CreateVersion7(), StationId = fixture.StationKey, TerminalId = fixture.TerminalKey, RampAgentId = agentKey,
        MentorRampAgentId = mentorKey, StartsAt = startsAt, EndsAt = endsAt, AssignedByAccountId = fixture.OccKey,
        CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
    };

    private static ShiftAssignment Shift(ReleaseFixture fixture, long agentKey, DateOnly day, int startHour = 6,
        int endHour = 14) => new()
    {
        PublicId = Guid.CreateVersion7(), RampAgentId = agentKey, StationId = fixture.StationKey, TerminalId = fixture.TerminalKey,
        WorkDate = day, StartsAtLocal = new TimeOnly(startHour, 0), EndsAtLocal = new TimeOnly(endHour, 0),
        Block = startHour < 12 ? ShiftBlock.Morning : startHour < 18 ? ShiftBlock.Afternoon : ShiftBlock.Night,
        CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task TerminationAndTransferReleaseTheRampAgentsWorkUnlessAnOperationIsInProgress()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var now = DateTimeOffset.UtcNow;
        var today = BusinessCalendar.Today(now);
        ReleaseFixture fixture;
        Guid employeeId, shiftId, coverageId, mentoringId;
        long assignedOperation, inProgressOperation;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            fixture = await ReleaseFixtureAsync(setup, ct);
            var person = await setup.RampAgents.Where(item => item.Id == fixture.AgentKey).Select(item => item.PersonId).SingleAsync(ct);
            employeeId = await setup.Employees.Where(item => item.PersonId == person).Select(item => item.PublicId).SingleAsync(ct);
            var mateo = await setup.RampAgents.Where(item => item.EmployeeNumber == "DEV-RA-002").Select(item => item.Id).SingleAsync(ct);
            // A shift in three days, a coverage of today, one where Riley mentors Mateo, a flight assigned for
            // tomorrow and one in progress.
            var shift = Shift(fixture, fixture.AgentKey, today.AddDays(3));
            var coverage = Coverage(fixture, fixture.AgentKey, null, now.AddHours(1), now.AddHours(8));
            var mentoring = Coverage(fixture, mateo, fixture.AgentKey, now.AddHours(1), now.AddHours(8));
            setup.AddRange(shift, coverage, mentoring);
            await setup.SaveChangesAsync(ct);
            (shiftId, coverageId, mentoringId) = (shift.PublicId, coverage.PublicId, mentoring.PublicId);
            assignedOperation = await AddAgentOperationAsync(setup, fixture, "HR-RELEASE-ASSIGNED", today.AddDays(1),
                fixture.AgentKey, GroundOperationStatus.Assigned, ct);
            inProgressOperation = await AddAgentOperationAsync(setup, fixture, "HR-RELEASE-IN-PROGRESS", today,
                fixture.AgentKey, GroundOperationStatus.InProgress, ct);
        }

        async Task<EmployeeDetailData> DetailAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return (await scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>()
                .GetEmployeeAsync(HumanResourcesAccount, employeeId, ct))!;
        }
        async Task<GovernanceResult> TerminateAsync(TerminateEmployeeInput input, Guid? key)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>()
                .TerminateEmployeeAsync(HumanResourcesAccount, employeeId, input, key, ct);
        }

        // An operation in progress keeps the agent: nothing is released and the termination is refused.
        var before = await DetailAsync();
        Assert.Equal(1, before.FutureShifts);
        var blocked = await TerminateAsync(new TerminateEmployeeInput(today, "Renuncia voluntaria", before.Summary.Version),
            Guid.NewGuid());
        Assert.Equal("agent_has_operation_in_progress", blocked.Code);
        // 2-N31: «today» is AVIAM's day; tomorrow is refused with its rule.
        Assert.Equal("termination_date_invalid", (await TerminateAsync(new TerminateEmployeeInput(today.AddDays(1),
            "Renuncia voluntaria", before.Summary.Version), null)).Code);
        Assert.Equal("idempotency_key_required", (await TerminateAsync(new TerminateEmployeeInput(today,
            "Renuncia voluntaria", before.Summary.Version), Guid.Empty)).Code);
        Assert.Equal("version_conflict", (await TerminateAsync(new TerminateEmployeeInput(today,
            "Renuncia voluntaria", "AAAAAAAAAAA="), null)).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.True(await check.RampAgents.AnyAsync(item => item.Id == fixture.AgentKey && item.IsActive, ct));
            Assert.True(await check.ShiftAssignments.AnyAsync(item => item.PublicId == shiftId, ct));
            Assert.Null((await check.Set<PositionCoverage>().SingleAsync(item => item.PublicId == coverageId, ct)).ReleasedAt);
            Assert.True(await check.OperationAgentAssignments.AnyAsync(item =>
                item.GroundOperationId == assignedOperation && item.ReleasedAt == null, ct));
            Assert.False(await check.AuditEntries.AnyAsync(entry => entry.Action.StartsWith("hr.agent_release."), ct));
            // The agent hands the operation in; it now waits for OCC's review with its evidence.
            await check.GroundOperations.Where(item => item.Id == inProgressOperation).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.CurrentStatus, GroundOperationStatus.PendingReview), ct);
        }

        var key = Guid.NewGuid();
        var termination = new TerminateEmployeeInput(today, "Renuncia voluntaria", (await DetailAsync()).Summary.Version);
        var terminated = await TerminateAsync(termination, key);
        Assert.True(terminated.IsSuccess, terminated.Code);
        // The same intent replays its result without repeating the release; the key with another body is refused.
        Assert.Equal(employeeId, (await TerminateAsync(termination, key)).Id);
        Assert.Equal("idempotency_conflict", (await TerminateAsync(termination with { Reason = "Otro motivo" }, key)).Code);
        Assert.Equal("employee_terminated", (await TerminateAsync(termination with
        { ExpectedVersion = (await DetailAsync()).Summary.Version }, null)).Code);

        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False((await check.RampAgents.SingleAsync(item => item.Id == fixture.AgentKey, ct)).IsActive);
            Assert.All(await check.Set<RampAgentStationScope>().Where(item => item.RampAgentId == fixture.AgentKey).ToArrayAsync(ct),
                scope => Assert.NotNull(scope.ValidTo));
            Assert.True(await check.Set<RampAgentStationScope>().AnyAsync(item => item.RampAgentId == fixture.AgentKey &&
                item.ValidTo == today, ct));
            Assert.False(await check.ShiftAssignments.AnyAsync(item => item.PublicId == shiftId, ct));
            Assert.All(await check.Set<PositionCoverage>().Where(item => item.PublicId == coverageId || item.PublicId == mentoringId)
                .ToArrayAsync(ct), item => Assert.NotNull(item.ReleasedAt));
            Assert.Equal(GroundOperationStatus.Planned, (await check.GroundOperations.SingleAsync(item =>
                item.Id == assignedOperation, ct)).CurrentStatus);
            Assert.True(await check.Set<GroundOperationStatusEvent>().AnyAsync(item => item.GroundOperationId == assignedOperation &&
                item.FromStatus == GroundOperationStatus.Assigned && item.ToStatus == GroundOperationStatus.Planned, ct));
            Assert.False(await check.OperationAgentAssignments.AnyAsync(item =>
                item.GroundOperationId == assignedOperation && item.ReleasedAt == null, ct));
            // The operation handed in keeps its agent: its evidence belongs to them.
            Assert.True(await check.OperationAgentAssignments.AnyAsync(item =>
                item.GroundOperationId == inProgressOperation && item.ReleasedAt == null, ct));
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.employee.terminated", ct));
            Assert.Equal(2, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.agent_release.coverage_released", ct));
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.agent_release.shift_removed", ct));
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "hr.agent_release.operation_released", ct));
            // OCC hears it per operation; the tablet never receives the notice.
            Assert.True(await check.OperationalNotifications.AnyAsync(item => item.Kind == "agent_released" &&
                item.GroundOperationId == assignedOperation && item.RecipientAccountId == fixture.OccKey, ct));
            Assert.False(await check.OperationalNotifications.AnyAsync(item => item.Kind == "agent_released" &&
                item.RecipientAccountId == fixture.RileyAccountKey, ct));
        }

        // A transfer out of the ramp goes through the same path.
        Guid transferredId;
        long transferredAgent;
        Guid transferredCoverage;
        await using (var scope = provider.CreateAsyncScope())
        {
            var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
            var positions = (await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!;
            var ramp = Assert.Single(positions, position => position.IsRampPosition);
            var created = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Andrés", "QA-RA-061",
                "40212345678", "operations", ramp.Id, "andres.traslado@dev.elevant.test"), ct);
            Assert.True(created.IsSuccess, created.Code);
            transferredId = created.Id!.Value;
        }
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var person = await setup.Employees.Where(item => item.PublicId == transferredId).Select(item => item.PersonId).SingleAsync(ct);
            transferredAgent = await setup.RampAgents.Where(item => item.PersonId == person).Select(item => item.Id).SingleAsync(ct);
            var coverage = Coverage(fixture, transferredAgent, null, now.AddHours(2), now.AddHours(6));
            setup.Add(coverage);
            await setup.SaveChangesAsync(ct);
            transferredCoverage = coverage.PublicId;
        }
        await using (var scope = provider.CreateAsyncScope())
        {
            var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
            var commercial = Assert.Single((await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!,
                position => position.Name == "Analista comercial");
            var detail = (await hr.GetEmployeeAsync(HumanResourcesAccount, transferredId, ct))!;
            var moved = await hr.TransferEmployeeAsync(HumanResourcesAccount, transferredId,
                new TransferEmployeeInput("contracts", commercial.Id, [PujStation], "Reubicación comercial", detail.Summary.Version),
                Guid.NewGuid(), ct);
            Assert.True(moved.IsSuccess, moved.Code);
        }
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False((await check.RampAgents.SingleAsync(item => item.Id == transferredAgent, ct)).IsActive);
            Assert.NotNull((await check.Set<PositionCoverage>().SingleAsync(item => item.PublicId == transferredCoverage, ct))
                .ReleasedAt);
        }
    }

    [Fact]
    public async Task AbsencesReleaseTheirDaysAndHumanResourcesCancelsOrShortensThem()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
        ReleaseFixture fixture;
        long blocking, assigned;
        Guid shiftId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            fixture = await ReleaseFixtureAsync(setup, ct);
            blocking = await AddAgentOperationAsync(setup, fixture, "HR-ABSENCE-IN-PROGRESS", today.AddDays(11), fixture.AgentKey,
                GroundOperationStatus.InProgress, ct);
            assigned = await AddAgentOperationAsync(setup, fixture, "HR-ABSENCE-ASSIGNED", today.AddDays(12), fixture.AgentKey,
                GroundOperationStatus.Assigned, ct);
            var shift = Shift(fixture, fixture.AgentKey, today.AddDays(11));
            setup.Add(shift);
            await setup.SaveChangesAsync(ct);
            shiftId = shift.PublicId;
        }
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Task<HumanResourcesAvailabilityWriteResult> Resolve(Guid id, string decision, string version, Guid? key) =>
            Run(services => services.GetRequiredService<IHumanResourcesAvailabilityWriteStore>().ResolveAsync(
                HumanResourcesAccount, id, new ResolveHumanResourcesAvailabilityInput(decision, null, version), key, ct));
        Task<HumanResourcesAvailabilityAmendmentResult> Amend(Guid id, AmendHumanResourcesAvailabilityInput input, Guid key) =>
            Run(services => services.GetRequiredService<IHumanResourcesAvailabilityWriteStore>().AmendAsync(
                HumanResourcesAccount, id, input, key, ct));
        async Task<HumanResourcesAvailabilityRequestData> ReadAsync(Guid id) =>
            (await Run(services => services.GetRequiredService<IHumanResourcesAvailabilityReadStore>()
                .ListAsync(HumanResourcesAccount, today.AddDays(-2), today.AddDays(20), 1, 100, ct)))!.Requests
            .Single(item => item.Id == id);
        Task<HumanResourcesShiftWriteResult> RecordShift(Guid id, DateOnly day) =>
            Run(services => services.GetRequiredService<IHumanResourcesShiftWriteStore>().RecordAsync(HumanResourcesAccount, id,
                new RecordHumanResourcesShiftInput(RileyProfile, PujStation, PujTerminal, day, new TimeOnly(6, 0),
                    new TimeOnly(14, 0), null), ct));

        // A day off over an operation in progress is refused and releases nothing (2-N08).
        var leave = Guid.NewGuid();
        Assert.Null((await Run(services => services.GetRequiredService<IHumanResourcesAvailabilityWriteStore>().RecordAsync(
            HumanResourcesAccount, leave, new RecordHumanResourcesAvailabilityInput(RileyProfile, today.AddDays(10),
                today.AddDays(12), "DayOff", "Vacaciones programadas"), ct))).Failure);
        Assert.Equal("expected_version_required", (await Run(services => services
            .GetRequiredService<IHumanResourcesAvailabilityWriteStore>().ResolveAsync(HumanResourcesAccount, leave,
                new ResolveHumanResourcesAvailabilityInput("Approve", null), Guid.NewGuid(), ct))).Code);
        Assert.Equal("agent_has_operation_in_progress",
            (await Resolve(leave, "Approve", (await ReadAsync(leave)).Version, Guid.NewGuid())).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.True(await check.ShiftAssignments.AnyAsync(item => item.PublicId == shiftId, ct));
            Assert.True(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == assigned &&
                item.ReleasedAt == null, ct));
            await check.GroundOperations.Where(item => item.Id == blocking).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.CurrentStatus, GroundOperationStatus.PendingReview), ct);
        }
        var approvalKey = Guid.NewGuid();
        var version = (await ReadAsync(leave)).Version;
        Assert.Null((await Resolve(leave, "Approve", version, approvalKey)).Failure);
        Assert.Null((await Resolve(leave, "Approve", version, approvalKey)).Failure);
        Assert.Equal("idempotency_conflict", (await Resolve(leave, "Reject", version, approvalKey)).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False(await check.ShiftAssignments.AnyAsync(item => item.PublicId == shiftId, ct));
            Assert.False(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == assigned &&
                item.ReleasedAt == null, ct));
            Assert.Equal(GroundOperationStatus.Planned, (await check.GroundOperations.SingleAsync(item => item.Id == assigned, ct))
                .CurrentStatus);
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.availability.approved" &&
                entry.EntityPublicId == leave, ct));
            Assert.True(await check.OperationalNotifications.AnyAsync(item => item.Kind == "agent_released" &&
                item.GroundOperationId == assigned && item.RecipientAccountId == fixture.OccKey, ct));
        }

        // No shift goes on an approved absence (2-N24).
        Assert.Equal("shift_on_approved_absence", (await RecordShift(Guid.NewGuid(), today.AddDays(11))).Code);

        // 2-N22: the leave has not started — it is cancelled once, with its reason; the agent may work again.
        var cancel = new AmendHumanResourcesAvailabilityInput("Cancel", null, "La vacación se pospone a enero",
            (await ReadAsync(leave)).Version);
        var cancelKey = Guid.NewGuid();
        var cancelled = await Amend(leave, cancel, cancelKey);
        Assert.Null(cancelled.Failure);
        Assert.Equal("Cancelled", cancelled.Amendment!.Status);
        Assert.Equal(cancelled.Amendment, (await Amend(leave, cancel, cancelKey)).Amendment);
        Assert.Equal("idempotency_conflict", (await Amend(leave, cancel with { Reason = "Otro motivo distinto" }, cancelKey)).Code);
        Assert.Equal("version_conflict", (await Amend(leave, cancel, Guid.NewGuid())).Code);
        Assert.Equal("absence_not_approved", (await Amend(leave, cancel with { ExpectedVersion = cancelled.Amendment.Version },
            Guid.NewGuid())).Code);
        Assert.Null((await RecordShift(Guid.NewGuid(), today.AddDays(11))).Failure);

        // A restriction in progress is shortened, never before yesterday, and never cancelled.
        var restriction = Guid.NewGuid();
        Assert.Null((await Run(services => services.GetRequiredService<IHumanResourcesAvailabilityWriteStore>().RecordAsync(
            HumanResourcesAccount, restriction, new RecordHumanResourcesAvailabilityInput(RileyProfile, today.AddDays(-1),
                today.AddDays(3), "Restriction", "Reposo médico"), ct))).Failure);
        Assert.Null((await Resolve(restriction, "Approve", (await ReadAsync(restriction)).Version, null)).Failure);
        var current = (await ReadAsync(restriction)).Version;
        Assert.Equal("absence_started", (await Amend(restriction, new AmendHumanResourcesAvailabilityInput("Cancel", null,
            "Alta médica anticipada", current), Guid.NewGuid())).Code);
        Assert.Equal("absence_end_invalid", (await Amend(restriction, new AmendHumanResourcesAvailabilityInput("Shorten",
            today.AddDays(-2), "Alta médica anticipada", current), Guid.NewGuid())).Code);
        Assert.Equal("absence_end_invalid", (await Amend(restriction, new AmendHumanResourcesAvailabilityInput("Shorten",
            today.AddDays(3), "Alta médica anticipada", current), Guid.NewGuid())).Code);
        Assert.Equal("reason_required", (await Amend(restriction, new AmendHumanResourcesAvailabilityInput("Shorten",
            today, "Alta", current), Guid.NewGuid())).Code);
        Assert.Equal("invalid_absence_amendment", (await Amend(restriction, new AmendHumanResourcesAvailabilityInput("Cancel",
            today, "Alta médica anticipada", current), Guid.NewGuid())).Code);
        var shortened = await Amend(restriction, new AmendHumanResourcesAvailabilityInput("Shorten", today,
            "Alta médica anticipada", current), Guid.NewGuid());
        Assert.Null(shortened.Failure);
        Assert.Equal(("Approved", today), (shortened.Amendment!.Status, shortened.Amendment.EndsOn));
        Assert.Equal(today, (await ReadAsync(restriction)).EndsOn);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var audit = await check.AuditEntries.SingleAsync(entry => entry.Action == "hr.availability.shortened" &&
                entry.EntityPublicId == restriction, ct);
            Assert.Equal("Alta médica anticipada", audit.Reason);
            Assert.Contains("availability.ends_on", audit.MetadataJson, StringComparison.Ordinal);
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.availability.approval_cancelled" &&
                entry.EntityPublicId == leave, ct));
        }
    }

    [Fact]
    public async Task AShiftIsRemovedOnlyWhenItsAgentDoesNotWorkInIt()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
        ReleaseFixture fixture;
        await using (var setup = CreateContext(database.ConnectionString))
            fixture = await ReleaseFixtureAsync(setup, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Task<HumanResourcesShiftWriteResult> Remove(Guid id, string? version, Guid? key) =>
            Run(services => services.GetRequiredService<IHumanResourcesShiftWriteStore>().RemoveAsync(HumanResourcesAccount, id,
                new RemoveHumanResourcesShiftInput(version, key), ct));
        async Task<string> VersionAsync(Guid id, DateOnly day) =>
            (await Run(services => services.GetRequiredService<IHumanResourcesShiftReadStore>()
                .ListAsync(HumanResourcesAccount, day, day, 1, 100, ct)))!.Shifts.Single(item => item.Id == id).Version;

        var day = today.AddDays(4);
        var shiftId = Guid.NewGuid();
        Assert.Null((await Run(services => services.GetRequiredService<IHumanResourcesShiftWriteStore>().RecordAsync(
            HumanResourcesAccount, shiftId, new RecordHumanResourcesShiftInput(RileyProfile, PujStation, PujTerminal, day,
                new TimeOnly(6, 0), new TimeOnly(14, 0), null), ct))).Failure);
        Assert.Equal("shift_day_taken", (await Run(services => services.GetRequiredService<IHumanResourcesShiftWriteStore>()
            .RecordAsync(HumanResourcesAccount, Guid.NewGuid(), new RecordHumanResourcesShiftInput(RileyProfile, PujStation,
                PujTerminal, day, new TimeOnly(15, 0), new TimeOnly(22, 0), null), ct))).Code);
        var version = await VersionAsync(shiftId, day);
        Assert.Equal("expected_version_required", (await Remove(shiftId, null, Guid.NewGuid())).Code);

        // Riley covers stands in the shift: it stays (2-N11).
        var (start, _) = RampAgentReleaseRules.ShiftWindow(day, new TimeOnly(6, 0), new TimeOnly(14, 0), "America/Santo_Domingo");
        long operation;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            setup.Add(Coverage(fixture, fixture.AgentKey, null, start.AddHours(1), start.AddHours(5)));
            await setup.SaveChangesAsync(ct);
        }
        Assert.Equal("shift_in_use", (await Remove(shiftId, version, Guid.NewGuid())).Code);
        // An assigned operation in the shift keeps it too.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            await setup.Set<PositionCoverage>().Where(item => item.RampAgentId == fixture.AgentKey && item.ReleasedAt == null)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ReleasedAt, DateTimeOffset.UtcNow), ct);
            operation = await AddAgentOperationAsync(setup, fixture, "HR-SHIFT-IN-USE", day, fixture.AgentKey,
                GroundOperationStatus.Assigned, ct);
        }
        Assert.Equal("shift_in_use", (await Remove(shiftId, version, Guid.NewGuid())).Code);
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.OperationAgentAssignments.Where(item => item.GroundOperationId == operation)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ReleasedAt, DateTimeOffset.UtcNow), ct);

        Assert.Equal("version_conflict", (await Remove(shiftId, "AAAAAAAAAAA=", Guid.NewGuid())).Code);
        var key = Guid.NewGuid();
        Assert.Null((await Remove(shiftId, version, key)).Failure);
        Assert.Null((await Remove(shiftId, version, key)).Failure);
        Assert.Equal("idempotency_conflict", (await Remove(shiftId, "AAAAAAAAAAA=", key)).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False(await check.ShiftAssignments.AnyAsync(item => item.PublicId == shiftId, ct));
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.shift.removed" &&
                entry.EntityPublicId == shiftId, ct));
        }

        // A shift of yesterday in its station's calendar is history.
        var pastId = Guid.NewGuid();
        Assert.Null((await Run(services => services.GetRequiredService<IHumanResourcesShiftWriteStore>().RecordAsync(
            HumanResourcesAccount, pastId, new RecordHumanResourcesShiftInput(RileyProfile, PujStation, PujTerminal,
                today.AddDays(6), new TimeOnly(6, 0), new TimeOnly(14, 0), null), ct))).Failure);
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.ShiftAssignments.Where(item => item.PublicId == pastId).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.WorkDate, today.AddDays(-1)), ct);
        Assert.Equal("shift_in_past", (await Remove(pastId, null, null)).Code);
    }

    [Fact]
    public async Task TheMentorsAbsenceAndPermitCountAndTheFlightNeverFollowsAnInactiveAgent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var date = new DateOnly(2026, 8, 19);
        ReleaseFixture fixture;
        Guid juniorProfile;
        await using (var scope = provider.CreateAsyncScope())
        {
            var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
            var ramp = Assert.Single((await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!,
                position => position.IsRampPosition);
            var created = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Nuevo", "QA-RA-070", "40299887766",
                "operations", ramp.Id, "nuevo.rampa@dev.elevant.test") with { HireDate = new DateOnly(2026, 8, 1) }, ct);
            Assert.True(created.IsSuccess, created.Code);
            await using var setup = CreateContext(database.ConnectionString);
            fixture = await ReleaseFixtureAsync(setup, ct);
            var person = await setup.Employees.Where(item => item.PublicId == created.Id).Select(item => item.PersonId).SingleAsync(ct);
            var junior = await setup.RampAgents.SingleAsync(item => item.PersonId == person, ct);
            juniorProfile = junior.PublicId;
            setup.Add(Shift(fixture, junior.Id, date));
            // Riley, the senior mentor, has an approved day off that day.
            var now = DateTimeOffset.UtcNow;
            setup.AvailabilityRequests.Add(new AvailabilityRequest
            {
                PublicId = Guid.NewGuid(), RampAgentId = fixture.AgentKey, StartsOn = date, EndsOn = date,
                Type = AvailabilityRequestType.DayOff, Status = AvailabilityRequestStatus.Approved, Reason = "Día libre",
                RequestedAt = now, ResolvedAt = now, CreatedAt = now, UpdatedAt = now,
            });
            await setup.SaveChangesAsync(ct);
        }
        Task<CoverageResult> CoverageStore(Func<IPositionCoverageStore, Task<CoverageResult>> action) =>
            RunCoverage(provider, action);
        var board = (await CoverageStore(store => store.ReadAsync(OperationsAdministrator, PujStation, date, ct))).Board!;
        var terminal = Assert.Single(board.Terminals, item => item.Code == "A");
        var stand = board.Stands.First(item => item.Code == "A01").StandId;
        var input = new CreateCoverageInput(juniorProfile, terminal.TerminalId, [stand], date, null, null, RileyProfile, null, false);
        Assert.Contains("mentor_absent", (await CoverageStore(store => store.CreateAsync(OperationsAdministrator, PujStation, input, ct)))
            .Reasons);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            await setup.AvailabilityRequests.Where(item => item.RampAgentId == fixture.AgentKey).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.Status, AvailabilityRequestStatus.Cancelled), ct);
            await setup.AirportPermitCycles.Where(item => item.PublicId == RileyAirportId).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.ExpiresOn, date.AddDays(-1)), ct);
        }
        var reasons = (await CoverageStore(store => store.CreateAsync(OperationsAdministrator, PujStation, input, ct))).Reasons;
        Assert.Contains("mentor_permit_required", reasons);
        Assert.DoesNotContain("mentor_absent", reasons);

        // 2-N06: an open coverage left by an agent who no longer works the ramp never receives a flight.
        await using var context = CreateContext(database.ConnectionString);
        var flight = await (from item in context.GroundOperations
                            join turnaround in context.Turnarounds on item.TurnaroundId equals turnaround.Id
                            where turnaround.OperationCode == "DEV-TAT-0001"
                            select new { item.Id, item.PlannedStartAt, Turnaround = turnaround.PublicId }).SingleAsync(ct);
        var mateo = await context.RampAgents.SingleAsync(item => item.EmployeeNumber == "DEV-RA-002", ct);
        var b01 = await context.Stands.SingleAsync(item => item.Code == "B01", ct);
        var terminalB = await context.Terminals.Where(item => item.Code == "B").Select(item => item.Id).SingleAsync(ct);
        var mateoCoverage = Coverage(fixture, mateo.Id, null, flight.PlannedStartAt!.Value.AddHours(-1),
            flight.PlannedStartAt.Value.AddHours(5));
        mateoCoverage.TerminalId = terminalB;
        context.Add(mateoCoverage);
        await context.SaveChangesAsync(ct);
        context.Add(new PositionCoverageStand { PositionCoverageId = mateoCoverage.Id, StandId = b01.Id });
        await context.RampAgents.Where(item => item.Id == mateo.Id).ExecuteUpdateAsync(update =>
            update.SetProperty(item => item.IsActive, false), ct);
        await context.SaveChangesAsync(ct);
        var holder = await context.OperationAgentAssignments.AsNoTracking().Where(item => item.GroundOperationId == flight.Id &&
            item.ReleasedAt == null).Select(item => item.RampAgentId).SingleAsync(ct);
        await using (var scope = provider.CreateAsyncScope())
            Assert.Null((await scope.ServiceProvider.GetRequiredService<IOccPositionStore>()
                .AssignAsync(OperationsAdministrator, flight.Turnaround, b01.PublicId, "Cambio del aeropuerto", ct)).Failure);
        Assert.Equal(holder, await context.OperationAgentAssignments.AsNoTracking().Where(item =>
            item.GroundOperationId == flight.Id && item.ReleasedAt == null).Select(item => item.RampAgentId).SingleAsync(ct));
    }

    private static async Task<CoverageResult> RunCoverage(ServiceProvider provider,
        Func<IPositionCoverageStore, Task<CoverageResult>> action)
    {
        await using var scope = provider.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IPositionCoverageStore>());
    }

    [Fact]
    public async Task ExpiringAndUncoveringDocumentsAreAnnouncedOnceAndMarkTheAssignedAgent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
        ReleaseFixture fixture;
        long operation;
        long humanResourcesKey;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            fixture = await ReleaseFixtureAsync(setup, ct);
            operation = await AddAgentOperationAsync(setup, fixture, "HR-DOCUMENT-ASSIGNED", today.AddDays(12), fixture.AgentKey,
                GroundOperationStatus.Assigned, ct);
            humanResourcesKey = await setup.Users.Where(item => item.PublicId == HumanResourcesAccount).Select(item => item.Id)
                .SingleAsync(ct);
        }
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }

        // Gestión Humana corrects the ramp licence to end before the flight: OCC hears it at once, once (2-N25).
        Assert.Null((await Run(services => services.GetRequiredService<IHumanResourcesPermitWriteStore>().RecordAsync(
            HumanResourcesAccount, Guid.NewGuid(), new RecordHumanResourcesPermitInput(RileyProfile, "RampDriverLicense",
                RileyRampLicense, "DEV-RAMP-LICENSE-2", new DateOnly(2026, 1, 1), today.AddDays(11)), ct))).Failure);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(1, await check.OperationalNotifications.CountAsync(item => item.Kind == "agent_document_not_current" &&
                item.GroundOperationId == operation && item.RecipientAccountId == fixture.OccKey, ct));

        // The airport permit expires in ten days: Gestión Humana is told once per document, without email.
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.AirportPermitCycles.Where(item => item.PublicId == RileyAirportId).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.ExpiresOn, today.AddDays(10)), ct);
        var emailsBefore = await CountEmailsAsync(database, ct);
        var sweep = await Run(services => services.GetRequiredService<IHumanResourcesDocumentSweepStore>().SweepAsync(ct));
        Assert.Equal(new HumanResourcesDocumentSweepResult(2, 0), sweep);
        Assert.Equal(new HumanResourcesDocumentSweepResult(0, 0),
            await Run(services => services.GetRequiredService<IHumanResourcesDocumentSweepStore>().SweepAsync(ct)));
        Assert.Equal(emailsBefore, await CountEmailsAsync(database, ct));
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.True(await check.DepartmentNotifications.AnyAsync(item => item.Kind == "agent_document_expiring" &&
                item.SourceId == RileyAirportId && item.RecipientAccountId == humanResourcesKey, ct));
            Assert.Equal(1, await check.OperationalNotifications.CountAsync(item => item.Kind == "agent_document_not_current" &&
                item.GroundOperationId == operation && item.RecipientAccountId == fixture.OccKey, ct));
            Assert.False(await check.OperationalNotifications.AnyAsync(item => item.Kind == "agent_document_not_current" &&
                item.RecipientAccountId == fixture.RileyAccountKey, ct));
        }

        // The planning board marks the agent of that flight as unfit; nothing was released.
        var marks = await Run(services => services.GetRequiredService<IOccAssignmentReadinessStore>()
            .ReadAsync(OperationsAdministrator, PujStation, today.AddDays(12), ct));
        var mark = Assert.Single(marks.Data!.Assignments);
        Assert.Equal(["airport_id_not_current", "ramp_driver_license_not_current"], mark.Reasons);
        Assert.Equal(OccAssignmentReadinessFailure.Forbidden, (await Run(services => services
            .GetRequiredService<IOccAssignmentReadinessStore>().ReadAsync(HumanResourcesAccount, PujStation, today, ct))).Failure);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.True(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == operation &&
                item.ReleasedAt == null, ct));

        // A shift after the end of the documents warns HR only when it asks for the readiness kinds (2-N24).
        var shiftDay = today.AddDays(13);
        Assert.Null((await Run(services => services.GetRequiredService<IHumanResourcesShiftWriteStore>().RecordAsync(
            HumanResourcesAccount, Guid.NewGuid(), new RecordHumanResourcesShiftInput(RileyProfile, PujStation, PujTerminal,
                shiftDay, new TimeOnly(6, 0), new TimeOnly(14, 0), null), ct))).Failure);
        var plain = (await Run(services => services.GetRequiredService<IHumanResourcesScheduleWarningStore>()
            .ListAsync(HumanResourcesAccount, PujStation, shiftDay, shiftDay, 1, 100, false, ct))).Page!;
        Assert.DoesNotContain(plain.Warnings, item => item.Kind == ScheduleWarningKind.DocumentExpired);
        var readiness = (await Run(services => services.GetRequiredService<IHumanResourcesScheduleWarningStore>()
            .ListAsync(HumanResourcesAccount, PujStation, shiftDay, shiftDay, 1, 100, true, ct))).Page!;
        Assert.Equal("AirportId,RampDriverLicense", Assert.Single(readiness.Warnings,
            item => item.Kind == ScheduleWarningKind.DocumentExpired).Reason);
    }

    [Fact]
    public async Task ARampProfileSaveComparesItsVersionReplaysItsKeyAndNamesEveryRefusal()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
        ReleaseFixture fixture;
        long inProgress, assigned;
        int updatesBefore;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            fixture = await ReleaseFixtureAsync(setup, ct);
            inProgress = await AddAgentOperationAsync(setup, fixture, "HR-PROFILE-IN-PROGRESS", today, fixture.AgentKey,
                GroundOperationStatus.InProgress, ct);
            assigned = await AddAgentOperationAsync(setup, fixture, "HR-PROFILE-ASSIGNED", today.AddDays(2), fixture.AgentKey,
                GroundOperationStatus.Assigned, ct);
            updatesBefore = await setup.AuditEntries.CountAsync(entry => entry.Action == "hr.ramp_profile.updated" &&
                entry.EntityPublicId == RileyProfile, ct);
        }
        async Task<RampProfileData> ReadAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return (await scope.ServiceProvider.GetRequiredService<IRampProfileStore>()
                .ListAsync(HumanResourcesAccount, ct))!.Profiles.Single(item => item.Id == RileyProfile);
        }
        async Task<RampProfileResult> SaveAsync(Guid profileId, SaveRampProfileInput input, Guid? key)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IRampProfileStore>()
                .SaveAsync(HumanResourcesAccount, profileId, input, key, ct);
        }

        var before = await ReadAsync();
        Assert.False(string.IsNullOrEmpty(before.Version));
        var deactivate = new SaveRampProfileInput(before.FirstName, before.LastName, before.EmployeeNumber,
            before.Category, before.HireDate, false, before.Stations.Select(station => station.Id).ToArray(),
            ExpectedVersion: before.Version);

        // The key needs the version the editor read; a version the profile no longer has is a stale form.
        Assert.Equal("idempotency_key_required", (await SaveAsync(RileyProfile, deactivate, Guid.Empty)).Code);
        Assert.Equal("expected_version_required", (await SaveAsync(RileyProfile, deactivate with { ExpectedVersion = null },
            Guid.NewGuid())).Code);
        Assert.Equal("version_conflict", (await SaveAsync(RileyProfile, deactivate with { ExpectedVersion = "AAAAAAAAAAA=" },
            Guid.NewGuid())).Code);
        // Every other refusal names its rule too.
        Assert.Equal("invalid_ramp_profile", (await SaveAsync(RileyProfile, deactivate with { FirstName = " " },
            Guid.NewGuid())).Code);
        Assert.Equal("not_found", (await SaveAsync(Guid.NewGuid(), deactivate, Guid.NewGuid())).Code);
        Assert.Equal("stations_invalid", (await SaveAsync(RileyProfile, deactivate with { StationIds = [Guid.NewGuid()] },
            Guid.NewGuid())).Code);
        Assert.Equal("terminals_invalid", (await SaveAsync(RileyProfile, deactivate with { TerminalIds = [Guid.NewGuid()] },
            Guid.NewGuid())).Code);
        Assert.Equal("supervisor_cycle", (await SaveAsync(RileyProfile, deactivate with
        {
            Supervisor = new RampProfileSupervisorSelection(RileyProfile),
        }, Guid.NewGuid())).Code);
        Assert.Equal("supervisor_invalid", (await SaveAsync(RileyProfile, deactivate with
        {
            Supervisor = new RampProfileSupervisorSelection(Guid.NewGuid()),
        }, Guid.NewGuid())).Code);
        Assert.Equal("employee_record_mismatch", (await SaveAsync(RileyProfile, deactivate with { FirstName = "Otro" },
            Guid.NewGuid())).Code);
        // An operation in progress keeps the agent until they hand it in from the tablet (2-N06).
        Assert.Equal("agent_has_operation_in_progress", (await SaveAsync(RileyProfile, deactivate, Guid.NewGuid())).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.True(await check.RampAgents.AnyAsync(item => item.Id == fixture.AgentKey && item.IsActive, ct));
            Assert.True(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == assigned &&
                item.ReleasedAt == null, ct));
            await check.GroundOperations.Where(item => item.Id == inProgress).ExecuteUpdateAsync(update =>
                update.SetProperty(item => item.CurrentStatus, GroundOperationStatus.PendingReview), ct);
        }

        var key = Guid.NewGuid();
        var saved = await SaveAsync(RileyProfile, deactivate, key);
        Assert.Null(saved.Failure);
        Assert.False(saved.Profile!.IsActive);
        Assert.NotEqual(before.Version, saved.Profile.Version);
        // The same intent answers the profile again without releasing twice; the key with another body is refused.
        var replayed = await SaveAsync(RileyProfile, deactivate, key);
        Assert.Null(replayed.Failure);
        Assert.False(replayed.Profile!.IsActive);
        Assert.Equal(saved.Profile.Version, replayed.Profile.Version);
        Assert.Equal("idempotency_conflict", (await SaveAsync(RileyProfile, deactivate with { Category = "Supervisor" },
            key)).Code);
        // A form opened before the deactivation is stale and never reactivates the agent.
        Assert.Equal("version_conflict", (await SaveAsync(RileyProfile, deactivate with { IsActive = true },
            Guid.NewGuid())).Code);
        Assert.Equal(saved.Profile.Version, (await ReadAsync()).Version);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False((await check.RampAgents.SingleAsync(item => item.Id == fixture.AgentKey, ct)).IsActive);
            Assert.Equal(GroundOperationStatus.Planned, (await check.GroundOperations.SingleAsync(item =>
                item.Id == assigned, ct)).CurrentStatus);
            Assert.Equal(updatesBefore + 1, await check.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.ramp_profile.updated" && entry.EntityPublicId == RileyProfile, ct));
            Assert.Equal(1, await check.OperationalNotifications.CountAsync(item => item.Kind == "agent_released" &&
                item.GroundOperationId == assigned && item.RecipientAccountId == fixture.OccKey, ct));
        }
    }

    [Fact]
    public async Task MovingARampAgentToAnOfficePositionTakesTheKeyAndNamesEveryRefusal()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var now = DateTimeOffset.UtcNow;
        Guid employeeId, coverageId;
        JobPositionData office;
        await using (var scope = provider.CreateAsyncScope())
        {
            var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
            var positions = (await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!;
            var ramp = Assert.Single(positions, position => position.IsRampPosition);
            office = Assert.Single(positions, position => position.Name == "Coordinador OCC");
            var created = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Rafael", "QA-RA-081",
                "40234567895", "operations", ramp.Id, "rafael.oficina@dev.elevant.test"), ct);
            Assert.True(created.IsSuccess, created.Code);
            employeeId = created.Id!.Value;
        }
        long agentKey;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var fixture = await ReleaseFixtureAsync(setup, ct);
            var person = await setup.Employees.Where(item => item.PublicId == employeeId).Select(item => item.PersonId)
                .SingleAsync(ct);
            agentKey = await setup.RampAgents.Where(item => item.PersonId == person).Select(item => item.Id).SingleAsync(ct);
            var coverage = Coverage(fixture, agentKey, null, now.AddHours(2), now.AddHours(6));
            setup.Add(coverage);
            await setup.SaveChangesAsync(ct);
            coverageId = coverage.PublicId;
        }
        async Task<GovernanceResult> UpdateAsync(Guid id, SaveEmployeeInput input, Guid? key)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>()
                .UpdateEmployeeAsync(HumanResourcesAccount, id, input, key, ct);
        }
        async Task<string> VersionAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return (await scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>()
                .GetEmployeeAsync(HumanResourcesAccount, employeeId, ct))!.Summary.Version;
        }

        var move = NewEmployee("Rafael", "QA-RA-081", "40234567895", "operations", office.Id,
            "rafael.oficina@dev.elevant.test") with { ExpectedVersion = await VersionAsync() };
        Assert.Equal("idempotency_key_required", (await UpdateAsync(employeeId, move, Guid.Empty)).Code);
        Assert.Equal("expected_version_required", (await UpdateAsync(employeeId, move with { ExpectedVersion = null },
            Guid.NewGuid())).Code);
        Assert.Equal("not_found", (await UpdateAsync(Guid.NewGuid(), move, Guid.NewGuid())).Code);
        Assert.Equal("version_conflict", (await UpdateAsync(employeeId, move with { ExpectedVersion = "AAAAAAAAAAA=" },
            Guid.NewGuid())).Code);

        var key = Guid.NewGuid();
        var moved = await UpdateAsync(employeeId, move, key);
        Assert.True(moved.IsSuccess, moved.Code);
        // The same intent answers its first result without releasing twice; the key with another body is refused.
        Assert.Equal(employeeId, (await UpdateAsync(employeeId, move, key)).Id);
        Assert.Equal("idempotency_conflict", (await UpdateAsync(employeeId, move with { PhoneNumber = "809-555-0199" },
            key)).Code);
        Assert.Equal("version_conflict", (await UpdateAsync(employeeId, move, Guid.NewGuid())).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.False((await check.RampAgents.SingleAsync(item => item.Id == agentKey, ct)).IsActive);
            Assert.NotNull((await check.Set<PositionCoverage>().SingleAsync(item => item.PublicId == coverageId, ct))
                .ReleasedAt);
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry => entry.Action == "hr.employee.updated" &&
                entry.EntityPublicId == employeeId, ct));
            Assert.Equal(1, await check.AuditEntries.CountAsync(entry =>
                entry.Action == "hr.agent_release.coverage_released" && entry.EntityPublicId == coverageId, ct));
        }
    }

    private static async Task<int> CountEmailsAsync(TemporaryDatabase database, CancellationToken ct)
    {
        await using var context = CreateContext(database.ConnectionString);
        return await context.EmailOutbox.CountAsync(ct);
    }
}
