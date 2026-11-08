using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 3, block C: one rule of «when is a tablet time valid». The start and the service transitions keep the tapped
/// time (3-I), every piece of evidence fits the operation's window and block-on never follows push-back (3-N25), a
/// correction round is measured to the first hand-off (3-N09) and evidence captured before the hand-off is still taken
/// while OCC reviews it (3-N06).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid TimingAgent = Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid TimingOcc = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid TimingStation = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid TimingOperation = Guid.Parse("70000000-0000-7000-8000-000000000005");
    /// <summary>The serializer of the device receipts' canonical payloads (the web defaults).</summary>
    private static readonly JsonSerializerOptions TimingReceiptJson = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task TheTabletSendsTheTappedStartAndServiceTimesAndOldReceiptsStillReplay()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000c1", ct);
        var now = DateTimeOffset.UtcNow;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operationId = await setup.GroundOperations.Where(item => item.PublicId == TimingOperation)
                .Select(item => item.Id).SingleAsync(ct);
            var assignment = await setup.OperationAgentAssignments.SingleAsync(item =>
                item.GroundOperationId == operationId && item.ReleasedAt == null, ct);
            assignment.AssignedAt = now.AddHours(-1);
            await setup.SaveChangesAsync(ct);
        }
        Task<RampOperationStartWriteResult> Start(Guid key, DateTimeOffset? startedAt) =>
            Run(services => services.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
                new RampOperationStartWriteRequest(TimingAgent, [TimingStation], TimingOperation, installation, key, key,
                    "timing-start", startedAt), ct));

        // A start before the assignment it starts is refused with its code; the receipt replays the same refusal and
        // keeps its body.
        var earlyKey = Guid.NewGuid();
        var early = await Start(earlyKey, now.AddHours(-2));
        Assert.Equal((RampOperationStartWriteFailure.Conflict, RampProblemCodes.TimeOutsideOperationWindow),
            (early.Failure, early.Code));
        var earlyReplay = await Start(earlyKey, now.AddHours(-2));
        Assert.Equal((early.Failure, early.Code, early.CommitReceiptId),
            (earlyReplay.Failure, earlyReplay.Code, earlyReplay.CommitReceiptId));
        Assert.Equal(RampOperationStartWriteFailure.IdempotencyKeyConflict, (await Start(earlyKey, now.AddMinutes(-30))).Failure);

        // The tapped start is the operation's start; the receipt keeps when the command arrived.
        var tapped = now.AddMinutes(-30);
        var started = await Start(Guid.NewGuid(), tapped);
        Assert.True(started.IsSuccess);
        Assert.Equal(tapped.ToUnixTimeMilliseconds(), started.Start!.Operation.ActualStartAt!.Value.ToUnixTimeMilliseconds());

        // Without a body the payload hash is byte for byte the one of the first version of the app.
        var bodylessKey = Guid.NewGuid();
        Assert.Equal(RampOperationStartWriteFailure.Conflict, (await Start(bodylessKey, null)).Failure);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var receipt = await check.MobileCommandReceipts.SingleAsync(item =>
                item.IdempotencyKey == bodylessKey.ToString("D"), ct);
            Assert.Equal(Sha256Hex($"v1\nramp.operation.start.v1\n{TimingOperation:D}"), receipt.PayloadHash);
            var operation = await check.GroundOperations.SingleAsync(item => item.PublicId == TimingOperation, ct);
            Assert.Equal(tapped.ToUnixTimeMilliseconds(), operation.ActualStartAt!.Value.ToUnixTimeMilliseconds());
            Assert.Equal(tapped.ToUnixTimeMilliseconds(), (await check.Set<GroundOperationStatusEvent>()
                .Where(item => item.GroundOperationId == operation.Id && item.ToStatus == GroundOperationStatus.InProgress)
                .Select(item => item.OccurredAt).SingleAsync(ct)).ToUnixTimeMilliseconds());
            var audit = await check.AuditEntries.SingleAsync(item => item.Action == "ramp.operation.started", ct);
            Assert.Contains("receivedAt", audit.MetadataJson!, StringComparison.Ordinal);
        }

        Guid serviceId;
        await using (var lookup = CreateContext(database.ConnectionString))
            serviceId = await (from service in lookup.OperationServices
                               join operation in lookup.GroundOperations on service.GroundOperationId equals operation.Id
                               where operation.PublicId == TimingOperation
                               orderby service.LineNumber
                               select service.PublicId).FirstAsync(ct);
        Task<RampOperationServiceTransitionWriteResult> Transition(Guid key, ServiceExecutionStatus target,
            decimal? quantity, DateTimeOffset? occurredAt) =>
            Run(services => services.GetRequiredService<IRampOperationServiceCommandStore>().TransitionServiceAsync(
                new RampOperationServiceTransitionWriteRequest(TimingAgent, [TimingStation], TimingOperation, serviceId,
                    target, quantity, null, installation, key, key, "timing-service", occurredAt), ct));

        // A transition the queue sends later keeps its tapped time.
        var inProgressAt = now.AddMinutes(-25);
        Assert.True((await Transition(Guid.NewGuid(), ServiceExecutionStatus.InProgress, null, inProgressAt)).IsSuccess);
        // Never before the service's last transition, nor before the operation's window.
        var outOfOrderKey = Guid.NewGuid();
        var outOfOrder = await Transition(outOfOrderKey, ServiceExecutionStatus.Completed, 1m, now.AddMinutes(-26));
        Assert.Equal((RampOperationServiceTransitionWriteFailure.Conflict, RampProblemCodes.ServiceTimeOutOfOrder),
            (outOfOrder.Failure, outOfOrder.Code));
        Assert.Equal(RampProblemCodes.ServiceTimeOutOfOrder,
            (await Transition(outOfOrderKey, ServiceExecutionStatus.Completed, 1m, now.AddMinutes(-26))).Code);
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            (await Transition(Guid.NewGuid(), ServiceExecutionStatus.Completed, 1m, now.AddMinutes(-40))).Code);

        // Without a time the server's applies and the canonical payload is the one of the first version.
        var bodyKey = Guid.NewGuid();
        var completed = await Transition(bodyKey, ServiceExecutionStatus.Completed, 1m, null);
        Assert.True(completed.IsSuccess);
        Assert.Equal(completed.CommitReceiptId,
            (await Transition(bodyKey, ServiceExecutionStatus.Completed, 1m, null)).CommitReceiptId);
        Assert.Equal(RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict,
            (await Transition(bodyKey, ServiceExecutionStatus.Completed, 1m, now)).Failure);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var v1 = Sha256Hex(JsonSerializer.Serialize(new
            {
                command = "ramp.operation.service.transition.v1",
                operationId = TimingOperation.ToString("D"),
                serviceId = serviceId.ToString("D"),
                targetStatus = "Completed",
                executedQuantity = "1",
                Note = (string?)null,
            }, TimingReceiptJson));
            Assert.Equal(v1, (await check.MobileCommandReceipts.SingleAsync(item =>
                item.IdempotencyKey == bodyKey.ToString("D"), ct)).PayloadHash);
            var events = await (from item in check.Set<OperationServiceStatusEvent>()
                                join service in check.OperationServices on item.OperationServiceId equals service.Id
                                where service.PublicId == serviceId
                                orderby item.Id
                                select new { item.ToStatus, item.OccurredAt }).ToArrayAsync(ct);
            Assert.Equal(inProgressAt.ToUnixTimeMilliseconds(), events[0].OccurredAt.ToUnixTimeMilliseconds());
            Assert.True(events[^1].OccurredAt >= now.AddSeconds(-1));
            Assert.Equal("time_outside_operation_window", (await check.MobileCommandReceipts.SingleAsync(item =>
                item.IdempotencyKey == earlyKey.ToString("D"), ct)).ErrorCode);
        }
    }

    [Fact]
    public async Task ACorrectionRoundTakesOldTimesInTheWindowAndTheResubmissionKeepsTheFirstHandOff()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000c2", ct);
        // A Saturday operation returned by OCC and corrected on Monday: started 49 hours ago, first handed off an hour
        // later, without push-back. The first hand-off marked an OVERTIME the corrected times do not justify, and OCC
        // added a DELAY of its own.
        var now = DateTimeOffset.UtcNow;
        var startedAt = Truncate(now.AddHours(-49));
        var firstHandOff = startedAt.AddMinutes(60);
        long operationInternalId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var state = await PrepareCorrectionRoundAsync(setup, startedAt, firstHandOff, now, ct);
            operationInternalId = state.OperationId;
            setup.OperationServiceCharges.AddRange(
                new OperationServiceCharge
                {
                    PublicId = Guid.CreateVersion7(), OperationServiceId = state.ServiceId,
                    ChargeDefinitionId = await ChargeIdAsync(setup, AutomaticSurchargeCodes.Overtime, ct),
                    Source = ChargeMarkSource.Automatic, AppliedAt = firstHandOff, CreatedAt = now, UpdatedAt = now,
                },
                new OperationServiceCharge
                {
                    PublicId = Guid.CreateVersion7(), OperationServiceId = state.ServiceId,
                    ChargeDefinitionId = await ChargeIdAsync(setup, AutomaticSurchargeCodes.Delay, ct),
                    Source = ChargeMarkSource.Occ, AppliedAt = firstHandOff,
                    AppliedByAccountId = await setup.Users.Where(user => user.PublicId == TimingOcc)
                        .Select(user => user.Id).SingleAsync(ct),
                    AdjustmentReason = "Demora confirmada por la torre.", CreatedAt = now, UpdatedAt = now,
                });
            await setup.SaveChangesAsync(ct);
        }
        Task<RampExecutionWriteResult> Milestone(Guid key, string code, DateTimeOffset at) =>
            Run(services => services.GetRequiredService<IRampExecutionCommandStore>().RecordMilestoneAsync(
                new RampMilestoneWriteRequest(TimingAgent, [TimingStation], TimingOperation, code, at, installation, key,
                    "timing-milestone"), ct));

        // Older than a day but inside the operation: accepted (the fixed 24-hour limit is gone).
        Assert.True((await Milestone(Guid.NewGuid(), "BLOCK_ON", startedAt.AddMinutes(10))).IsSuccess);
        // Before the start with no recorded arrival, or after the first hand-off: outside the window.
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            (await Milestone(Guid.NewGuid(), "WALKAROUND_START", startedAt.AddMinutes(-10))).Code);
        var lateKey = Guid.NewGuid();
        var late = await Milestone(lateKey, "PUSHBACK", firstHandOff.AddMinutes(5));
        Assert.Equal((RampExecutionWriteFailure.Conflict, RampProblemCodes.TimeOutsideOperationWindow),
            (late.Failure, late.Code));
        Assert.Equal((late.CommitReceiptId, late.Code),
            ((await Milestone(lateKey, "PUSHBACK", firstHandOff.AddMinutes(5))).CommitReceiptId, late.Code));
        // Push-back never comes before block-on.
        Assert.Equal(RampProblemCodes.MilestoneOutOfOrder,
            (await Milestone(Guid.NewGuid(), "PUSHBACK", startedAt.AddMinutes(5))).Code);

        // The resubmission is measured to the first hand-off, keeps it as the operation's end and retires the
        // automatic OVERTIME, never OCC's DELAY.
        var resubmitted = await Run(services => services.GetRequiredService<IRampOperationSubmissionStore>().SubmitAsync(
            new RampOperationSubmissionWriteRequest(TimingAgent, [TimingStation], TimingOperation, installation,
                Guid.NewGuid(), "Corrección del bloqueo.", Guid.NewGuid(), "timing-resubmit"), ct));
        Assert.True(resubmitted.IsSuccess, resubmitted.Failure?.ToString());
        Assert.Equal(2, resubmitted.Submission!.RevisionNumber);
        Assert.Equal(firstHandOff, resubmitted.Submission.ActualEndAt);
        Assert.True(resubmitted.Submission.SubmittedAt >= now.AddSeconds(-1));
        await using var check = CreateContext(database.ConnectionString);
        var stored = await check.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == operationInternalId, ct);
        Assert.Equal((GroundOperationStatus.PendingReview, (DateTimeOffset?)firstHandOff),
            (stored.CurrentStatus, stored.ActualEndAt));
        var evidence = OperationSubmissionEvidence.Parse((await check.OperationSubmissions.AsNoTracking()
            .SingleAsync(item => item.GroundOperationId == operationInternalId && item.RevisionNumber == 2, ct))
            .EvidenceJson!);
        Assert.Equal((startedAt.AddMinutes(10), firstHandOff, 50m),
            (evidence.Close!.StartedAt!.Value, evidence.Close.EndedAt!.Value, evidence.Close.GroundMinutes!.Value));
        var marks = await (from mark in check.OperationServiceCharges.AsNoTracking()
                           join charge in check.ChargeDefinitions.AsNoTracking() on mark.ChargeDefinitionId equals charge.Id
                           join service in check.OperationServices.AsNoTracking() on mark.OperationServiceId equals service.Id
                           where service.GroundOperationId == operationInternalId &&
                                 (charge.Code == AutomaticSurchargeCodes.Overtime || charge.Code == AutomaticSurchargeCodes.Delay)
                           select new { charge.Code, mark.Source, mark.RemovedAt, mark.RemovedByRampAgentId, mark.AdjustmentReason })
            .ToArrayAsync(ct);
        var overtime = Assert.Single(marks, item => item.Code == AutomaticSurchargeCodes.Overtime);
        Assert.NotNull(overtime.RemovedAt);
        Assert.NotNull(overtime.RemovedByRampAgentId);
        Assert.Equal(AutomaticSurchargeApplier.RecalculatedReason, overtime.AdjustmentReason);
        var delay = Assert.Single(marks, item => item.Code == AutomaticSurchargeCodes.Delay);
        Assert.Equal((ChargeMarkSource.Occ, (DateTimeOffset?)null), (delay.Source, delay.RemovedAt));
        Assert.Contains("retiredSurcharges", (await check.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "ramp.operation.submitted", ct)).MetadataJson!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LateEvidenceWhileOccReviewsRefreshesTheHandOffAndStalesTheReviewToken()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000c3", ct);
        // The agent tapped «Iniciar» after block-on and handed off 70 minutes later; block-on, captured offline 25
        // minutes before the start (the aircraft arrived 30 minutes before it), reaches ELEVANT while OCC reviews.
        var now = DateTimeOffset.UtcNow;
        var startedAt = Truncate(now.AddHours(-3));
        var handOff = startedAt.AddMinutes(70);
        long operationInternalId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var state = await PrepareCorrectionRoundAsync(setup, startedAt, handOff, now, ct);
            operationInternalId = state.OperationId;
            var operation = await setup.GroundOperations.SingleAsync(item => item.Id == state.OperationId, ct);
            operation.CurrentStatus = GroundOperationStatus.PendingReview;
            operation.ActualEndAt = handOff;
            var first = await setup.OperationSubmissions.SingleAsync(item => item.GroundOperationId == state.OperationId, ct);
            first.Status = SubmissionStatus.PendingReview;
            var arrival = await setup.FlightLegs.SingleAsync(leg => leg.TurnaroundId == operation.TurnaroundId &&
                leg.Direction == FlightDirection.Arrival, ct);
            arrival.ScheduledAt = startedAt.AddMinutes(-30);
            arrival.ActualAt = startedAt.AddMinutes(-30);
            await setup.SaveChangesAsync(ct);
            first.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(setup, state.OperationId, ct, handOff)).ToJson();
            await setup.SaveChangesAsync(ct);
        }
        Task<string> ReviewTokenAsync() => Run(async services =>
            (await services.GetRequiredService<IOccReviewStore>().GetDetailAsync(TimingOperation, [TimingStation], ct))!
            .ConcurrencyToken);
        var tokenBefore = await ReviewTokenAsync();
        Task<RampExecutionWriteResult> Milestone(Guid key, string code, DateTimeOffset at) =>
            Run(services => services.GetRequiredService<IRampExecutionCommandStore>().RecordMilestoneAsync(
                new RampMilestoneWriteRequest(TimingAgent, [TimingStation], TimingOperation, code, at, installation, key,
                    "timing-late"), ct));

        // Captured before the hand-off: taken, the surcharges and the frozen evidence are recalculated (95 minutes on the
        // ground against the 75 allowed and the 15 of grace) and the reviewer's token is stale.
        Assert.True((await Milestone(Guid.NewGuid(), "BLOCK_ON", startedAt.AddMinutes(-25))).IsSuccess);
        Assert.NotEqual(tokenBefore, await ReviewTokenAsync());
        await using (var check = CreateContext(database.ConnectionString))
        {
            var evidence = OperationSubmissionEvidence.Parse((await check.OperationSubmissions.AsNoTracking()
                .SingleAsync(item => item.GroundOperationId == operationInternalId, ct)).EvidenceJson!);
            Assert.Equal((startedAt.AddMinutes(-25), handOff, 95m),
                (evidence.Close!.StartedAt!.Value, evidence.Close.EndedAt!.Value, evidence.Close.GroundMinutes!.Value));
            Assert.Contains(evidence.Charges!, charge => charge.Code == AutomaticSurchargeCodes.Overtime);
            Assert.True(await check.AuditEntries.AnyAsync(entry =>
                entry.Action == PendingSubmissionEvidenceRefresher.AuditAction, ct));
        }
        // Captured after the hand-off: outside the window.
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            (await Milestone(Guid.NewGuid(), "PUSHBACK", handOff.AddMinutes(10))).Code);
        // A walk-around damage and the flight data captured before the hand-off are taken late too.
        var lateDamage = await Run(services => services.GetRequiredService<IOperationDocumentStore>().RecordDamageMarkAsync(
            new DamageMarkWriteRequest(TimingAgent, [TimingStation], TimingOperation, Guid.NewGuid(), 0.4m, 0.5m,
                "Abolladura en la bodega trasera", handOff.AddMinutes(-5), installation, Guid.NewGuid(), "timing-damage"), ct));
        Assert.True(lateDamage.IsSuccess);
        var afterHandOff = await Run(services => services.GetRequiredService<IOperationDocumentStore>().RecordDamageMarkAsync(
            new DamageMarkWriteRequest(TimingAgent, [TimingStation], TimingOperation, Guid.NewGuid(), 0.4m, 0.5m,
                "Rayón en la puerta de carga", handOff.AddMinutes(10), installation, Guid.NewGuid(), "timing-damage"), ct));
        Assert.Equal((RampExecutionWriteFailure.Conflict, RampProblemCodes.TimeOutsideOperationWindow),
            (afterHandOff.Failure, afterHandOff.Code));
        Assert.True((await Run(services => services.GetRequiredService<IRampExecutionCommandStore>().UpdateFlightDataAsync(
            new RampFlightDataWriteRequest(TimingAgent, [TimingStation], TimingOperation, 140, 138, null, null, installation,
                Guid.NewGuid(), "timing-flight"), ct))).IsSuccess);

        // Once OCC decided nothing late is taken.
        await using (var decide = CreateContext(database.ConnectionString))
        {
            var operation = await decide.GroundOperations.SingleAsync(item => item.Id == operationInternalId, ct);
            operation.CurrentStatus = GroundOperationStatus.Approved;
            await decide.SaveChangesAsync(ct);
        }
        var approved = await Milestone(Guid.NewGuid(), "DNCD", startedAt.AddMinutes(30));
        Assert.Equal((RampExecutionWriteFailure.Conflict, (string?)"conflict"), (approved.Failure, approved.Code));
    }

    [Fact]
    public async Task ARunningOperationTakesMilestonesFromTheRecordedArrivalAndBlockOnNeverFollowsPushback()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000c4", ct);
        // The aircraft arrived 45 minutes ago and the agent tapped «Iniciar» 15 minutes later.
        var now = DateTimeOffset.UtcNow;
        var arrivedAt = Truncate(now.AddMinutes(-45));
        var startedAt = Truncate(now.AddMinutes(-30));
        long operationInternalId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == TimingOperation, ct);
            operationInternalId = operation.Id;
            var assignment = await setup.OperationAgentAssignments.SingleAsync(item =>
                item.GroundOperationId == operation.Id && item.ReleasedAt == null, ct);
            assignment.AssignedAt = now.AddHours(-2);
            var arrival = await setup.FlightLegs.SingleAsync(leg => leg.TurnaroundId == operation.TurnaroundId &&
                leg.Direction == FlightDirection.Arrival, ct);
            arrival.ActualAt = arrivedAt;
            await setup.SaveChangesAsync(ct);
        }
        var startKey = Guid.NewGuid();
        var start = await Run(services => services.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
            new RampOperationStartWriteRequest(TimingAgent, [TimingStation], TimingOperation, installation, startKey,
                startKey, "timing-running-start", startedAt), ct));
        Assert.True(start.IsSuccess, start.Failure?.ToString());
        Task<RampExecutionWriteResult> Milestone(Guid key, string code, DateTimeOffset at) =>
            Run(services => services.GetRequiredService<IRampExecutionCommandStore>().RecordMilestoneAsync(
                new RampMilestoneWriteRequest(TimingAgent, [TimingStation], TimingOperation, code, at, installation, key,
                    "timing-running"), ct));

        // The block-on of the aircraft that arrived before «Iniciar» is evidence: the window opens at the arrival.
        var blockOn = arrivedAt.AddMinutes(1);
        Assert.True((await Milestone(Guid.NewGuid(), "BLOCK_ON", blockOn)).IsSuccess);
        // Before the arrival (beyond the clock tolerance) or in the future: outside the window.
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            (await Milestone(Guid.NewGuid(), "WALKAROUND_START", arrivedAt.AddMinutes(-5))).Code);
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            (await Milestone(Guid.NewGuid(), "DNCD", now.AddMinutes(10))).Code);

        // Push-back after block-on; a block-on corrected past it would invert the pair that measures the ground time.
        var pushback = Truncate(now.AddMinutes(-5));
        Assert.True((await Milestone(Guid.NewGuid(), "PUSHBACK", pushback)).IsSuccess);
        var invertedKey = Guid.NewGuid();
        var inverted = await Milestone(invertedKey, "BLOCK_ON", now.AddMinutes(-3));
        Assert.Equal((RampExecutionWriteFailure.Conflict, RampProblemCodes.MilestoneOutOfOrder),
            (inverted.Failure, inverted.Code));
        // The receipt keeps the rule: the same key and body answer it again.
        var replay = await Milestone(invertedKey, "BLOCK_ON", now.AddMinutes(-3));
        Assert.Equal((inverted.CommitReceiptId, RampProblemCodes.MilestoneOutOfOrder), (replay.CommitReceiptId, replay.Code));
        // Equal times are in order.
        Assert.True((await Milestone(Guid.NewGuid(), "BLOCK_ON", pushback)).IsSuccess);

        await using var check = CreateContext(database.ConnectionString);
        var milestones = await check.Set<OperationMilestone>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId)
            .ToDictionaryAsync(item => item.Code, item => item.ActualAt!.Value.ToUnixTimeMilliseconds(), ct);
        Assert.Equal(new Dictionary<string, long>
        {
            ["BLOCK_ON"] = pushback.ToUnixTimeMilliseconds(), ["PUSHBACK"] = pushback.ToUnixTimeMilliseconds(),
        }, milestones);
        Assert.Equal(RampProblemCodes.MilestoneOutOfOrder, (await check.MobileCommandReceipts.SingleAsync(item =>
            item.IdempotencyKey == invertedKey.ToString("D"), ct)).ErrorCode);
    }

    private sealed record TimingCorrectionState(long OperationId, long ServiceId);

    /// <summary>
    /// The seeded operation as a correction round: started at <paramref name="startedAt"/>, its first revision handed
    /// off at <paramref name="firstHandOff"/> and returned, its services completed and the second checklist submitted.
    /// </summary>
    private static async Task<TimingCorrectionState> PrepareCorrectionRoundAsync(ElevantDbContext setup,
        DateTimeOffset startedAt, DateTimeOffset firstHandOff, DateTimeOffset now, CancellationToken ct)
    {
        var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == TimingOperation, ct);
        operation.CurrentStatus = GroundOperationStatus.InProgress;
        operation.ActualStartAt = startedAt;
        operation.ActualEndAt = null;
        var agentId = await (from agent in setup.RampAgents
                             join account in setup.Users on agent.PersonId equals account.PersonId
                             where account.PublicId == TimingAgent
                             select agent.Id).SingleAsync(ct);
        var services = await setup.OperationServices.Where(item => item.GroundOperationId == operation.Id)
            .OrderBy(item => item.LineNumber).ToArrayAsync(ct);
        foreach (var service in services)
        {
            service.CurrentStatus = ServiceExecutionStatus.Completed;
            service.ExecutedQuantity = 1;
        }
        var arrival = await setup.FlightLegs.SingleAsync(leg => leg.TurnaroundId == operation.TurnaroundId &&
            leg.Direction == FlightDirection.Arrival, ct);
        arrival.ActualAt = null;
        var checklist = await (from item in setup.OperationChecklists
                               join version in setup.Set<ChecklistTemplateVersion>() on item.ChecklistTemplateVersionId equals version.Id
                               join template in setup.Set<ChecklistTemplate>() on version.ChecklistTemplateId equals template.Id
                               where item.GroundOperationId == operation.Id && RampChecklists.Execution.Contains(template.Code)
                               orderby item.RevisionNumber
                               select item).FirstAsync(ct);
        checklist.Status = ChecklistStatus.Submitted;
        checklist.StartedAt = startedAt;
        checklist.SubmittedAt = firstHandOff.AddMinutes(-5);
        checklist.SubmittedByRampAgentId = agentId;
        setup.OperationSubmissions.Add(new OperationSubmission
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, OperationChecklistId = checklist.Id,
            RevisionNumber = 1, Status = SubmissionStatus.Returned, SubmittedByRampAgentId = agentId,
            SubmittedAt = firstHandOff, CreatedAt = firstHandOff, UpdatedAt = now,
        });
        setup.OperationChecklists.Add(new OperationChecklist
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id,
            ChecklistTemplateVersionId = checklist.ChecklistTemplateVersionId, RevisionNumber = 2,
            Status = ChecklistStatus.Submitted, StartedAt = now.AddMinutes(-10), SubmittedAt = now.AddMinutes(-5),
            SubmittedByRampAgentId = agentId, CreatedAt = now, UpdatedAt = now,
        });
        await setup.SaveChangesAsync(ct);
        return new TimingCorrectionState(operation.Id, services[0].Id);
    }

    private static Task<long> ChargeIdAsync(ElevantDbContext context, string code, CancellationToken ct) =>
        context.ChargeDefinitions.Where(charge => charge.Code == code).Select(charge => charge.Id).SingleAsync(ct);

    private static async Task<ServiceProvider> TimingProviderAsync(TemporaryDatabase database, CancellationToken ct)
    {
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seeder = CreateContext(connection))
            await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, ct);
        return CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
    }

    private static async Task<Guid> RegisterTimingTabletAsync(ServiceProvider provider, string installationId,
        CancellationToken ct)
    {
        var installation = Guid.Parse(installationId);
        await using var scope = provider.CreateAsyncScope();
        Assert.True((await scope.ServiceProvider.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(TimingAgent, installation, MobilePlatform.Android, "1.2.3",
                "Ramp timing SQL test tablet", "Android 16"), ct)).IsSuccess);
        return installation;
    }

    private static string Sha256Hex(string payload) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

    private static DateTimeOffset Truncate(DateTimeOffset value) =>
        new(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
}
