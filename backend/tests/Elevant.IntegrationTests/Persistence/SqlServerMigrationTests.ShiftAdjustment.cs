using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 3, block B (3-E): OCC and Gestión Humana adjust the hours of a shift of today or later with its version, a
/// reason and an Idempotency-Key, without leaving the agent's work uncovered; OCC reads the agent's shift of the
/// flight's day to adjust it instead of programming a second one.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task OccAndHumanResourcesAdjustTheShiftOfTheDayWithoutUncoveringWork()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var connection = database.ConnectionString;
        var (airline, stands) = await PlanningFixtureAsync(connection, ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone);
        var day = today.AddDays(2);
        long riley;
        await using (var setup = CreateContext(connection))
            riley = await setup.RampAgents.Where(item => item.PublicId == RileyProfile).Select(item => item.Id).SingleAsync(ct);
        await AddRampShiftAsync(connection, riley, day, "A", 8, 12, ct);
        var planned = await PlanManualFlightAsync(provider, airline, stands["A01"], day, "ZZ951", LocalAt(day, 10),
            LocalAt(day, 11), ct);
        Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
        var flight = planned.TurnaroundId!.Value;
        Task<OccAgentShiftReadResult> ReadShift(Guid agent) => RunScopedAsync(provider, services => services
            .GetRequiredService<IOccShiftProgrammingStore>().GetAgentShiftAsync(
                new OccAgentShiftReadRequest(SeededOccAccount, [SeededPujStation], flight, agent), ct));
        Task<HumanResourcesShiftAdjustResult> Adjust(Guid actor, Guid shift, int start, int end, string version, Guid? key,
            string reason = "El vuelo de la tarde se extendió.") => RunScopedAsync(provider, services => services
            .GetRequiredService<IHumanResourcesShiftWriteStore>().AdjustAsync(actor, shift,
                new AdjustHumanResourcesShiftInput(new TimeOnly(start, 0), new TimeOnly(end, 0), reason, version), key, ct));

        // OCC reads the agent's shift of the flight's day, with its version; an agent without one has none.
        var read = await ReadShift(RileyProfile);
        Assert.Null(read.Failure);
        var shift = read.Shift!;
        Assert.Equal((day, new TimeOnly(8, 0), new TimeOnly(12, 0), "A"),
            (shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal, shift.TerminalCode));
        Guid mateo;
        await using (var check = CreateContext(connection))
            mateo = await check.RampAgents.Where(item => item.EmployeeNumber == "DEV-RA-002").Select(item => item.PublicId)
                .SingleAsync(ct);
        Assert.Equal(OccAgentShiftReadFailure.ShiftNotFound, (await ReadShift(mateo)).Failure);

        // Gestión Humana extends it to 13:00: same shift, new hours and version, audited and announced.
        var key = Guid.NewGuid();
        var extended = await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 13, shift.Version, key);
        Assert.Null(extended.Failure);
        Assert.Equal((shift.ShiftId, new TimeOnly(13, 0)), (extended.Shift!.Id, extended.Shift.EndsAtLocal));
        Assert.NotEqual(shift.Version, extended.Shift.Version);
        await using (var check = CreateContext(connection))
        {
            var row = await check.ShiftAssignments.AsNoTracking().SingleAsync(item => item.PublicId == shift.ShiftId, ct);
            Assert.Equal(new TimeOnly(13, 0), row.EndsAtLocal);
            Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "hr.shift.adjusted" &&
                entry.EntityPublicId == shift.ShiftId && entry.Reason == "El vuelo de la tarde se extendió.", ct));
            Assert.True(await check.OutboxMessages.AnyAsync(item => item.PayloadJson.Contains("hr_shifts"), ct));
        }
        // The same key and body replay it; the version read before is stale for a new intent; the key needs its body.
        var replayed = await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 13, shift.Version, key);
        Assert.True(replayed.Replayed);
        Assert.Equal(extended.Shift.Version, replayed.Shift!.Version);
        Assert.Equal("idempotency_conflict", (await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 14, shift.Version, key)).Code);
        Assert.Equal("version_conflict", (await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 14, shift.Version,
            Guid.NewGuid())).Code);
        Assert.Equal("idempotency_key_required", (await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 14,
            extended.Shift.Version, null)).Code);
        Assert.Equal("reason_required", (await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 14, extended.Shift.Version,
            Guid.NewGuid(), "No")).Code);

        // With the flight assigned, the shift may not leave it uncovered; OCC widens it with the same command.
        Assert.True((await AssignThroughPlanningAsync(provider, flight, RileyProfile, ct)).IsSuccess);
        var current = (await ReadShift(RileyProfile)).Shift!;
        var shrunk = await Adjust(HumanResourcesAccount, shift.ShiftId, 8, 10, current.Version, Guid.NewGuid());
        Assert.Equal((HumanResourcesShiftWriteFailure.Conflict, "shift_uncovers_work"), (shrunk.Failure, shrunk.Code));
        var widened = await Adjust(SeededOccAccount, shift.ShiftId, 7, 14, current.Version, Guid.NewGuid(),
            "OCC cubre el retraso del vuelo.");
        Assert.Null(widened.Failure);
        Assert.Equal((new TimeOnly(7, 0), new TimeOnly(14, 0)), (widened.Shift!.StartsAtLocal, widened.Shift.EndsAtLocal));

        // Once Gestión Humana validated the attendance of the flight Riley works in it, the shift stays as it is.
        await using (var validate = CreateContext(connection))
        {
            var now = DateTimeOffset.UtcNow;
            var assignment = await (from item in validate.OperationAgentAssignments
                                    join operation in validate.GroundOperations on item.GroundOperationId equals operation.Id
                                    join turnaround in validate.Turnarounds on operation.TurnaroundId equals turnaround.Id
                                    where turnaround.PublicId == flight && item.RampAgentId == riley && item.ReleasedAt == null
                                    select item.Id).SingleAsync(ct);
            var accounts = await validate.Users.Where(user => user.PublicId == SeededOccAccount ||
                    user.PublicId == SeededRampAgentAccount || user.PublicId == HumanResourcesAccount)
                .ToDictionaryAsync(user => user.PublicId, user => user.Id, ct);
            OperationAttendanceContributionRevision Contribution(string lane, Guid author) => new()
            {
                PublicId = Guid.CreateVersion7(), OperationAgentAssignmentId = assignment, Lane = lane, RevisionNumber = 1,
                AuthorAccountId = accounts[author], IdempotencyKey = Guid.NewGuid(), PayloadSha256 = new string('a', 64),
                ObservedStartAt = LocalAt(day, 10), ObservedEndAt = LocalAt(day, 11), RecordedAt = now, CreatedAt = now,
                UpdatedAt = now,
            };
            var occ = Contribution("Occ", SeededOccAccount);
            var ramp = Contribution("RampAgent", SeededRampAgentAccount);
            validate.AddRange(occ, ramp);
            await validate.SaveChangesAsync(ct);
            validate.Add(new OperationAttendanceValidation
            {
                PublicId = Guid.CreateVersion7(), OperationAgentAssignmentId = assignment, OccContributionRevisionId = occ.Id,
                RampAgentContributionRevisionId = ramp.Id, StartSource = "Occ", EndSource = "Occ", StartAt = LocalAt(day, 10),
                EndAt = LocalAt(day, 11), ValidatedByAccountId = accounts[HumanResourcesAccount], ValidatedAt = now,
                IdempotencyKey = Guid.NewGuid(), PayloadSha256 = new string('b', 64), CreatedAt = now, UpdatedAt = now,
            });
            await validate.SaveChangesAsync(ct);
        }
        var validated = await Adjust(HumanResourcesAccount, shift.ShiftId, 6, 15, widened.Shift.Version, Guid.NewGuid());
        Assert.Equal((HumanResourcesShiftWriteFailure.Conflict, "attendance_validated"), (validated.Failure, validated.Code));

        // A past shift is history.
        await AddRampShiftAsync(connection, riley, today.AddDays(-1), "A", 8, 12, ct);
        Guid pastShift;
        string pastVersion;
        await using (var check = CreateContext(connection))
        {
            var row = await check.ShiftAssignments.AsNoTracking()
                .SingleAsync(item => item.RampAgentId == riley && item.WorkDate == today.AddDays(-1), ct);
            (pastShift, pastVersion) = (row.PublicId, Convert.ToBase64String(row.RowVersion));
        }
        Assert.Equal("shift_in_past", (await Adjust(HumanResourcesAccount, pastShift, 8, 13, pastVersion, Guid.NewGuid())).Code);
    }
}
