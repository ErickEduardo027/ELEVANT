using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Chunks <c>ops:&lt;ISO week&gt;</c> (part C): the operations of each week at PUJ, inserted in the state the app's own
/// commands leave them. OCC enters the flight the day before (turnaround with its governing contract, two legs, the
/// stand, the ground operation) and assigns 2–3 eligible agents; the services of the contract are materialized with
/// their rate snapshot; on the ramp the agents start, record block-on and push-back, execute the services, report
/// deviations with their IATA delay code and submit the checklist; the hand-off marks the automatic surcharges
/// (<see cref="AutomaticSurchargeApplier.PlanAsync"/>) and freezes the evidence
/// (<see cref="OperationSubmissionEvidence.CaptureAsync"/>); OCC approves it (with the evidence and charges
/// <c>CloseApprovedAsync</c> keeps, resolving the open incidents and completing the turnaround) or returns it with a
/// reason. Only inserts: no audit, outbox, notification or document row. Stand assignments are always closed and the
/// base agent DEV-RA-001 is never used.
/// </summary>
internal static class OperationsHistory
{
    public const string ChunkPrefix = "ops:";

    /// <summary>Prefix of the monthly chunks of extra operations (NIGHT and OVERTIME surcharges).</summary>
    public const string ExtraChunkPrefix = "ops-extra:";

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        foreach (var week in options.IsoWeeks())
            yield return HistoryChunk.Create(ChunkPrefix + week.Name,
                (chunk, ct) => RunPeriodAsync(chunk, week, static (schedule, day) => schedule.PlanDay(day), ct));
    }

    /// <summary>
    /// Chunks <c>ops-extra:&lt;month&gt;</c>, registered after the payables: the extra operations of each month up to the
    /// last invoiced day (<see cref="OperationsSchedule.PlanExtras"/>) — dawn arrivals that bill NIGHT and turnarounds
    /// past their ground-time allowance that bill OVERTIME, which the regular day never reaches. They come after the
    /// regular history so a database that already holds it (the shared VPS) only adds them;
    /// <see cref="FinanceHistory.ExtraChunks"/> invoices them.
    /// </summary>
    public static IEnumerable<HistoryChunk> ExtraChunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var through = FinanceHistory.InvoicedThrough(options);
        foreach (var month in options.Months())
        {
            if (month.From > through) yield break;
            var period = new HistoryPeriod(month.Name, month.From, month.To < through ? month.To : through);
            yield return HistoryChunk.Create(ExtraChunkPrefix + period.Name,
                (chunk, ct) => RunPeriodAsync(chunk, period, static (schedule, day) => schedule.PlanExtras(day), ct));
        }
    }

    /// <summary>The rows of one operation, layer by layer (generated keys stay on the objects).</summary>
    private sealed class Rows(PlannedOperation plan, string code)
    {
        public PlannedOperation Plan { get; } = plan;
        public string Code { get; } = code;
        public Turnaround Turnaround { get; set; } = null!;
        public GroundOperation Operation { get; set; } = null!;
        public List<OperationService> Services { get; } = [];
        public List<OperationChecklist> Checklists { get; } = [];
        public List<Incident> Incidents { get; } = [];
        public List<OperationSubmission> Submissions { get; } = [];
    }

    private static async Task RunPeriodAsync(HistoryChunkContext chunk, HistoryPeriod week,
        Func<OperationsSchedule, DateOnly, IReadOnlyList<PlannedOperation>> planDay, CancellationToken cancellationToken)
    {
        var reference = await OperationsReference.EnsureAsync(chunk, cancellationToken);
        var schedule = new OperationsSchedule(chunk, reference);
        var stationCode = chunk.Anchors.Station.Code;
        var all = new List<Rows>();
        for (var day = week.From; day <= week.To; day = day.AddDays(1))
        {
            var planned = planDay(schedule, day);
            if (planned.Count == 0) continue;
            // 3-N27: numbered per station and local day after the codes already issued, read like the app does.
            var prefix = OperationCodeFormat.Prefix(stationCode, day);
            var issued = await IssuedCodesAsync(chunk.Db, prefix, cancellationToken);
            var highest = issued.Select(code => OperationCodeFormat.Sequence(code, prefix) ?? 0).DefaultIfEmpty(0).Max();
            all.AddRange(planned.Select((plan, index) =>
                new Rows(plan, OperationCodeFormat.Format(stationCode, day, highest + index + 1))));
        }
        if (all.Count == 0) return;

        var anchors = chunk.Anchors;
        var occ = anchors.Occ.Id;

        // Layer 1: turnarounds.
        foreach (var row in all) row.Turnaround = TurnaroundOf(row, chunk);
        await chunk.InsertAsync(all.Select(row => row.Turnaround), cancellationToken);

        // Layer 2: legs, closed stand assignments, ground operations and the turnaround's status history.
        var layer = new List<object>();
        foreach (var row in all)
        {
            var plan = row.Plan;
            var turnaroundId = row.Turnaround.Id;
            layer.Add(HistoryChunkContext.Stamp(new FlightLeg
            {
                TurnaroundId = turnaroundId, Direction = FlightDirection.Arrival, FlightNumber = plan.ArrivalFlight,
                OriginAirportId = plan.OriginAirportId, DestinationAirportId = anchors.Puj.Id,
                ScheduledAt = plan.ScheduledArrival, ActualAt = plan.IsCancelled ? null : plan.BlockOn,
                Source = OperationalDataSource.Manual,
            }, $"{plan.Key}:leg:arrival", plan.PlannedAt, plan.IsCancelled ? plan.PlannedAt : plan.BlockOn));
            layer.Add(HistoryChunkContext.Stamp(new FlightLeg
            {
                TurnaroundId = turnaroundId, Direction = FlightDirection.Departure, FlightNumber = plan.DepartureFlight,
                OriginAirportId = anchors.Puj.Id, DestinationAirportId = plan.OriginAirportId,
                ScheduledAt = plan.ScheduledDeparture, ActualAt = plan.IsCancelled ? null : plan.Pushback,
                Source = OperationalDataSource.Manual,
            }, $"{plan.Key}:leg:departure", plan.PlannedAt, plan.IsCancelled ? plan.PlannedAt : plan.Pushback));
            // Always closed: at the cancellation (before the arrival) or at push-back, when the aircraft left it.
            layer.Add(HistoryChunkContext.Stamp(new StandAssignment
            {
                TurnaroundId = turnaroundId, StandId = plan.Stand.Id, AssignedFrom = plan.ScheduledArrival,
                AssignedTo = plan.IsCancelled ? plan.ScheduledArrival : plan.Pushback, AssignedByAccountId = occ,
                Reason = "Manual OCC flight entry.",
            }, $"{plan.Key}:stand", plan.PlannedAt, plan.IsCancelled ? plan.CancelledAt!.Value : plan.Pushback));
            row.Operation = OperationOf(row);
            layer.Add(row.Operation);
            layer.AddRange(TurnaroundEvents(row, occ));
        }
        await chunk.InsertAsync(layer, cancellationToken);

        // Layer 3: the operation's status history, crew, services, milestones, checklists and incidents.
        layer = [];
        foreach (var row in all)
        {
            var plan = row.Plan;
            var operationId = row.Operation.Id;
            layer.AddRange(OperationEvents(row, occ));
            if (plan.IsCancelled) continue;
            var released = plan.Outcome switch
            {
                OperationOutcome.Approved => plan.Submitted,
                OperationOutcome.ReturnedThenApproved => plan.Resubmitted,
                _ => (DateTimeOffset?)null,
            };
            foreach (var (agent, role) in plan.Agents)
                layer.Add(HistoryChunkContext.Stamp(new OperationAgentAssignment
                {
                    GroundOperationId = operationId, RampAgentId = agent.RampAgentId,
                    OperationalPositionId = anchors.RampAgentPositionId, AssignmentRole = role,
                    AssignedAt = plan.AssignedAt, ReleasedAt = released, AssignedByAccountId = occ,
                }, $"{plan.Key}:agent:{agent.PublicId:N}", plan.AssignedAt, released ?? plan.AssignedAt));
            foreach (var service in plan.Services)
            {
                var unit = anchors.BillingUnits.ContainsKey(service.Rate.BillingUnit) ? service.Rate.BillingUnit : "operation";
                var entity = HistoryChunkContext.Stamp(new OperationService
                {
                    GroundOperationId = operationId, LineNumber = service.Line,
                    ServiceDefinitionId = service.Rate.ServiceDefinitionId, ContractServiceRateId = service.Rate.Id,
                    ContractedQuantity = service.Rate.MinimumQuantity, ExecutedQuantity = service.Executed,
                    BillingUnitSnapshot = unit, UnitPriceSnapshot = service.Rate.UnitPrice,
                    CurrencyCodeSnapshot = plan.Version.CurrencyCode, CurrentStatus = service.Status,
                }, $"{plan.Key}:service:{service.Line}", plan.AssignedAt, service.EndedAt);
                row.Services.Add(entity);
                layer.Add(entity);
            }
            foreach (var (code, at) in new[] { (OperationCloseFacts.BlockOn, plan.BlockOn), (OperationCloseFacts.Pushback, plan.Pushback) })
                layer.Add(HistoryChunkContext.Stamp(new OperationMilestone
                {
                    GroundOperationId = operationId, Code = code, ActualAt = at, Status = MilestoneStatus.Actual,
                    Source = OperationalDataSource.Manual,
                }, $"{plan.Key}:milestone:{code}", at));
            var checklist = plan.UsesBridgeChecklist ? anchors.BridgeChecklist! : anchors.FlightReport;
            row.Checklists.Add(HistoryChunkContext.Stamp(new OperationChecklist
            {
                GroundOperationId = operationId, ChecklistTemplateVersionId = checklist.VersionId, RevisionNumber = 1,
                Status = ChecklistStatus.Submitted, StartedAt = plan.ActualStart.AddMinutes(2),
                SubmittedAt = plan.Submitted.AddMinutes(-2), SubmittedByRampAgentId = plan.Primary.RampAgentId,
            }, $"{plan.Key}:checklist:1", plan.AssignedAt, plan.Submitted.AddMinutes(-2)));
            if (plan.Outcome == OperationOutcome.ReturnedThenApproved)
                row.Checklists.Add(HistoryChunkContext.Stamp(new OperationChecklist
                {
                    GroundOperationId = operationId, ChecklistTemplateVersionId = checklist.VersionId, RevisionNumber = 2,
                    Status = ChecklistStatus.Submitted, StartedAt = plan.CorrectionOpened!.Value.AddMinutes(1),
                    SubmittedAt = plan.Resubmitted!.Value.AddMinutes(-1), SubmittedByRampAgentId = plan.Primary.RampAgentId,
                }, $"{plan.Key}:checklist:2", plan.CorrectionOpened!.Value, plan.Resubmitted!.Value.AddMinutes(-1)));
            layer.AddRange(row.Checklists);
            var approvedAt = plan.ApprovedAt;
            foreach (var incident in plan.Incidents)
            {
                var entity = HistoryChunkContext.Stamp(new Incident
                {
                    GroundOperationId = operationId, ReportedByRampAgentId = plan.Primary.RampAgentId,
                    IncidentType = incident.Type, Severity = incident.Severity,
                    // CloseApprovedAsync resolves the incidents OCC did not manage when it approves the operation.
                    Status = approvedAt is null ? IncidentStatus.Open : IncidentStatus.Resolved,
                    Description = incident.Description, OccurredAt = incident.OccurredAt, ReportedAt = incident.ReportedAt,
                    ResolvedAt = approvedAt, ResolvedByAccountId = approvedAt is null ? null : occ,
                    ResolutionNote = approvedAt is null ? null : EfOccReviewStore.ApprovalResolutionNote,
                    DelayCode = incident.DelayCode,
                }, $"{plan.Key}:incident:{incident.Index}", incident.ReportedAt, approvedAt ?? incident.ReportedAt);
                row.Incidents.Add(entity);
                layer.Add(entity);
            }
        }
        await chunk.InsertAsync(layer, cancellationToken);

        // Layer 4: service transitions, checklist answers and the incidents' history.
        layer = [];
        var executed = all.Where(item => !item.Plan.IsCancelled).ToArray();
        foreach (var row in executed)
        {
            var plan = row.Plan;
            foreach (var (service, entity) in plan.Services.Zip(row.Services))
            {
                var agent = service.BySupport && plan.Agents.Count > 1 ? plan.Agents[1].Agent : plan.Primary;
                layer.Add(new OperationServiceStatusEvent
                {
                    OperationServiceId = entity.Id, FromStatus = null, ToStatus = ServiceExecutionStatus.Planned,
                    OccurredAt = plan.AssignedAt, Note = "Materialized from the applicable contract during OCC assignment.",
                });
                if (service.StartedAt is { } started)
                    layer.Add(new OperationServiceStatusEvent
                    {
                        OperationServiceId = entity.Id, FromStatus = ServiceExecutionStatus.Planned,
                        ToStatus = ServiceExecutionStatus.InProgress, OccurredAt = started, RampAgentId = agent.RampAgentId,
                    });
                layer.Add(new OperationServiceStatusEvent
                {
                    OperationServiceId = entity.Id,
                    FromStatus = service.StartedAt is null ? ServiceExecutionStatus.Planned : ServiceExecutionStatus.InProgress,
                    ToStatus = service.Status, OccurredAt = service.EndedAt, RampAgentId = agent.RampAgentId,
                    Note = service.Note,
                });
            }
            var items = plan.UsesBridgeChecklist ? anchors.BridgeChecklist!.Items : anchors.FlightReport.Items;
            foreach (var checklist in row.Checklists)
                layer.AddRange(items.Select(item => HistoryChunkContext.Stamp(new ChecklistAnswer
                {
                    OperationChecklistId = checklist.Id, ChecklistTemplateItemId = item.Id, Value = ChecklistAnswerValue.Ok,
                    AnsweredAt = checklist.SubmittedAt!.Value, RampAgentId = plan.Primary.RampAgentId,
                }, $"{plan.Key}:checklist:{checklist.RevisionNumber}:answer:{item.Code}", checklist.SubmittedAt!.Value)));
            foreach (var incident in row.Incidents)
            {
                layer.Add(new IncidentStatusEvent
                {
                    IncidentId = incident.Id, FromStatus = null, ToStatus = IncidentStatus.Open,
                    Note = EfOccIncidentStore.RampReportedNote, OccurredAt = incident.ReportedAt,
                });
                if (incident.ResolvedAt is { } resolved)
                    layer.Add(new IncidentStatusEvent
                    {
                        IncidentId = incident.Id, FromStatus = IncidentStatus.Open, ToStatus = IncidentStatus.Resolved,
                        Note = EfOccReviewStore.ApprovalResolutionNote, OccurredAt = resolved, ActorAccountId = occ,
                    });
            }
        }
        await chunk.InsertAsync(layer, cancellationToken);

        // Layer 5: the automatic surcharges the hand-off marks, decided by the app's own rule (ADR-0034).
        layer = [];
        foreach (var row in executed)
        {
            var lines = row.Services.ToDictionary(item => item.Id, item => item.LineNumber);
            var plan = row.Plan;
            foreach (var mark in await AutomaticSurchargeApplier.PlanAsync(chunk.Db, row.Operation.Id, plan.Submitted,
                         cancellationToken))
                layer.Add(HistoryChunkContext.Stamp(new OperationServiceCharge
                {
                    OperationServiceId = mark.OperationServiceId, ChargeDefinitionId = mark.ChargeDefinitionId,
                    Source = ChargeMarkSource.Automatic, AppliedAt = plan.Submitted,
                }, $"{plan.Key}:charge:{lines[mark.OperationServiceId]}:{mark.Code}", plan.Submitted));
        }
        await chunk.InsertAsync(layer, cancellationToken);

        // Layer 6: the hand-offs with the evidence the app freezes (read after every row of the operation is saved).
        layer = [];
        foreach (var row in executed)
        {
            var plan = row.Plan;
            var firstStatus = plan.Outcome switch
            {
                OperationOutcome.Approved => SubmissionStatus.Approved,
                OperationOutcome.PendingReview => SubmissionStatus.PendingReview,
                _ => SubmissionStatus.Returned,
            };
            row.Submissions.Add(HistoryChunkContext.Stamp(new OperationSubmission
            {
                GroundOperationId = row.Operation.Id, OperationChecklistId = row.Checklists[0].Id, RevisionNumber = 1,
                Status = firstStatus, SubmittedByRampAgentId = plan.Primary.RampAgentId, SubmittedAt = plan.Submitted,
                EvidenceJson = await EvidenceAsync(chunk.Db, row.Operation.Id, plan.Submitted, null, cancellationToken),
            }, $"{plan.Key}:submission:1", plan.Submitted, plan.Decided ?? plan.Submitted));
            if (plan.Outcome == OperationOutcome.ReturnedThenApproved)
                // 3-N09: the correction round keeps the first hand-off as the end of the flight.
                row.Submissions.Add(HistoryChunkContext.Stamp(new OperationSubmission
                {
                    GroundOperationId = row.Operation.Id, OperationChecklistId = row.Checklists[1].Id, RevisionNumber = 2,
                    Status = SubmissionStatus.Approved, SubmittedByRampAgentId = plan.Primary.RampAgentId,
                    SubmittedAt = plan.Resubmitted!.Value,
                    EvidenceJson = await EvidenceAsync(chunk.Db, row.Operation.Id, plan.Submitted, plan.Resubmitted,
                        cancellationToken),
                }, $"{plan.Key}:submission:2", plan.Resubmitted!.Value, plan.FinalDecided!.Value));
            layer.AddRange(row.Submissions);
        }
        await chunk.InsertAsync(layer, cancellationToken);

        // Layer 7: OCC's decisions; an approval keeps the handed-off evidence with the charges as they stand.
        layer = [];
        foreach (var row in executed)
        {
            var plan = row.Plan;
            if (plan.Decided is not { } decided) continue;
            var first = row.Submissions[0];
            if (plan.Outcome == OperationOutcome.Approved)
                layer.Add(await ApprovalAsync(chunk.Db, row, first, decided, occ, cancellationToken));
            else
                layer.Add(HistoryChunkContext.Stamp(new ReviewDecision
                {
                    OperationSubmissionId = first.Id, Outcome = ReviewOutcome.Returned, ReviewerAccountId = occ,
                    DecidedAt = decided, Reason = plan.ReturnReason,
                }, $"{plan.Key}:decision:1", decided));
            if (plan.Outcome == OperationOutcome.ReturnedThenApproved)
                layer.Add(await ApprovalAsync(chunk.Db, row, row.Submissions[1], plan.FinalDecided!.Value, occ,
                    cancellationToken));
        }
        await chunk.InsertAsync(layer, cancellationToken);
    }

    private static async Task<ReviewDecision> ApprovalAsync(ElevantDbContext db, Rows row, OperationSubmission submission,
        DateTimeOffset decidedAt, long occ, CancellationToken cancellationToken)
    {
        // As CloseApprovedAsync: the submitted evidence with the charges captured at the approval.
        var charges = await OperationSubmissionEvidence.CaptureChargesAsync(db, row.Operation.Id, cancellationToken);
        var approved = OperationSubmissionEvidence.Parse(submission.EvidenceJson!) with { Charges = charges };
        return HistoryChunkContext.Stamp(new ReviewDecision
        {
            OperationSubmissionId = submission.Id, Outcome = ReviewOutcome.Approved, ReviewerAccountId = occ,
            DecidedAt = decidedAt, ApprovedEvidenceJson = approved.ToJson(),
        }, $"{row.Plan.Key}:decision:{submission.RevisionNumber}", decidedAt);
    }

    /// <summary>
    /// The evidence the hand-off freezes. The incidents are inserted in their final state (an approval resolves them),
    /// but at the hand-off they were still open, as the app's snapshot shows them.
    /// </summary>
    internal static async Task<string> EvidenceAsync(ElevantDbContext db, long operationId, DateTimeOffset handedOffAt,
        DateTimeOffset? transitionsUntil, CancellationToken cancellationToken)
    {
        var evidence = await OperationSubmissionEvidence.CaptureAsync(db, operationId, cancellationToken, handedOffAt,
            transitionsUntil);
        return (evidence with
        {
            Incidents = evidence.Incidents.Select(item => item with { Status = nameof(IncidentStatus.Open) }).ToArray(),
        }).ToJson();
    }

    private static Task<string[]> IssuedCodesAsync(ElevantDbContext db, string prefix, CancellationToken cancellationToken)
    {
        // Station codes are letters and the date digits: the prefix carries no LIKE wildcard.
        var pattern = prefix + "%";
        return db.Turnarounds.FromSqlInterpolated($"""
                SELECT * FROM [ops].[turnarounds] WITH (UPDLOCK, HOLDLOCK)
                WHERE [operation_code] LIKE {pattern}
                """)
            .AsNoTracking().Select(turnaround => turnaround.OperationCode).ToArrayAsync(cancellationToken);
    }

    private static Turnaround TurnaroundOf(Rows row, HistoryChunkContext chunk)
    {
        var plan = row.Plan;
        var (status, last) = plan.Outcome switch
        {
            OperationOutcome.Cancelled => (TurnaroundStatus.Cancelled, plan.CancelledAt!.Value),
            OperationOutcome.Approved or OperationOutcome.ReturnedThenApproved =>
                (TurnaroundStatus.Completed, plan.ApprovedAt!.Value),
            _ => (TurnaroundStatus.InProgress, plan.BlockOn),
        };
        return HistoryChunkContext.Stamp(new Turnaround
        {
            OperationCode = row.Code, AirlineId = plan.Airline.Id, StationId = chunk.Anchors.Station.Id,
            OperationDate = plan.Date, AircraftTypeId = plan.Aircraft.Id, AircraftRegistration = plan.Registration,
            CurrentStatus = status, Source = OperationalDataSource.Manual, ContractVersionId = plan.Version.Id,
        }, $"{plan.Key}:turnaround", plan.PlannedAt, last);
    }

    private static GroundOperation OperationOf(Rows row)
    {
        var plan = row.Plan;
        var (status, last) = plan.Outcome switch
        {
            OperationOutcome.Cancelled => (GroundOperationStatus.Cancelled, plan.CancelledAt!.Value),
            OperationOutcome.Approved => (GroundOperationStatus.Approved, plan.Decided!.Value),
            OperationOutcome.ReturnedThenApproved => (GroundOperationStatus.Approved, plan.FinalDecided!.Value),
            OperationOutcome.ReturnedOpen => (GroundOperationStatus.Returned, plan.Decided!.Value),
            _ => (GroundOperationStatus.PendingReview, plan.Submitted),
        };
        return HistoryChunkContext.Stamp(new GroundOperation
        {
            TurnaroundId = row.Turnaround.Id, CurrentStatus = status, PlannedStartAt = plan.ScheduledArrival,
            PlannedEndAt = plan.ScheduledDeparture, ActualStartAt = plan.IsCancelled ? null : plan.ActualStart,
            // The first hand-off ends the operation (3-N09), as the submission command records it.
            ActualEndAt = plan.IsCancelled ? null : plan.Submitted,
            PassengersIn = plan.IsCancelled ? null : plan.PassengersIn,
            PassengersOut = plan.IsCancelled ? null : plan.PassengersOut, MtowKg = plan.IsCancelled ? null : plan.MtowKg,
        }, $"{plan.Key}:operation", plan.PlannedAt, last);
    }

    private static IEnumerable<TurnaroundStatusEvent> TurnaroundEvents(Rows row, long occ)
    {
        var plan = row.Plan;
        var id = row.Turnaround.Id;
        yield return new TurnaroundStatusEvent
        {
            TurnaroundId = id, FromStatus = null, ToStatus = TurnaroundStatus.Confirmed, OccurredAt = plan.PlannedAt,
            ActorAccountId = occ, Source = OperationalDataSource.Manual, Reason = "Manual OCC flight entry.",
        };
        if (plan.IsCancelled)
        {
            yield return new TurnaroundStatusEvent
            {
                TurnaroundId = id, FromStatus = TurnaroundStatus.Confirmed, ToStatus = TurnaroundStatus.Cancelled,
                OccurredAt = plan.CancelledAt!.Value, ActorAccountId = occ, Source = OperationalDataSource.Manual,
                Reason = plan.CancelReason,
            };
            yield break;
        }
        yield return new TurnaroundStatusEvent
        {
            TurnaroundId = id, FromStatus = TurnaroundStatus.Confirmed, ToStatus = TurnaroundStatus.InProgress,
            OccurredAt = plan.BlockOn, ActorAccountId = occ, Source = OperationalDataSource.Manual,
            Reason = "Llegada registrada por OCC.",
        };
        if (plan.ApprovedAt is { } approved)
            yield return new TurnaroundStatusEvent
            {
                TurnaroundId = id, FromStatus = TurnaroundStatus.InProgress, ToStatus = TurnaroundStatus.Completed,
                OccurredAt = approved, ActorAccountId = occ, Source = OperationalDataSource.Manual,
                Reason = "OCC aprobó la operación: la escala queda cerrada.",
            };
    }

    private static IEnumerable<GroundOperationStatusEvent> OperationEvents(Rows row, long occ)
    {
        var plan = row.Plan;
        var id = row.Operation.Id;
        GroundOperationStatusEvent Event(GroundOperationStatus? from, GroundOperationStatus to, DateTimeOffset at,
            long? actor, string? reason) => new()
        {
            GroundOperationId = id, FromStatus = from, ToStatus = to, OccurredAt = at, ActorAccountId = actor,
            Reason = reason,
        };
        yield return Event(null, GroundOperationStatus.Planned, plan.PlannedAt, occ, "Created with manual OCC flight.");
        if (plan.IsCancelled)
        {
            yield return Event(GroundOperationStatus.Planned, GroundOperationStatus.Cancelled, plan.CancelledAt!.Value, occ,
                plan.CancelReason);
            yield break;
        }
        yield return Event(GroundOperationStatus.Planned, GroundOperationStatus.Assigned, plan.AssignedAt, occ,
            "Agent assigned from OCC planning.");
        yield return Event(GroundOperationStatus.Assigned, GroundOperationStatus.InProgress, plan.ActualStart, null,
            "Operation started by the assigned ramp agent.");
        yield return Event(GroundOperationStatus.InProgress, GroundOperationStatus.PendingReview, plan.Submitted, null,
            "Assigned ramp agent submitted completed execution for OCC review.");
        if (plan.Decided is not { } decided) yield break;
        if (plan.Outcome == OperationOutcome.Approved)
        {
            yield return Event(GroundOperationStatus.PendingReview, GroundOperationStatus.Approved, decided, occ,
                "OCC approved the submitted operation.");
            yield break;
        }
        yield return Event(GroundOperationStatus.PendingReview, GroundOperationStatus.Returned, decided, occ,
            "OCC returned the submitted operation for correction.");
        if (plan.Outcome != OperationOutcome.ReturnedThenApproved) yield break;
        yield return Event(GroundOperationStatus.Returned, GroundOperationStatus.InProgress, plan.CorrectionOpened!.Value,
            null, "Assigned ramp agent opened a new correction revision after OCC return.");
        yield return Event(GroundOperationStatus.InProgress, GroundOperationStatus.PendingReview, plan.Resubmitted!.Value,
            null, "Assigned ramp agent submitted completed execution for OCC review.");
        yield return Event(GroundOperationStatus.PendingReview, GroundOperationStatus.Approved, plan.FinalDecided!.Value,
            occ, "OCC approved the submitted operation.");
    }
}
