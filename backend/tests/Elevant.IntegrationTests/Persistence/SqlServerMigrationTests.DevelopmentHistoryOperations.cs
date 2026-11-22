using System.Diagnostics;
using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed.History;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>The operations of the Development history (part C) over the reduced options, as the seeder login.</summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid HistoryOccAccount = Guid.Parse("40000000-0000-7000-8000-000000000001");

    /// <summary>Internal ids of the history turnarounds (their deterministic keys), by public id.</summary>
    private static async Task<long[]> HistoryTurnaroundIdsAsync(ElevantDbContext db, DevelopmentHistoryOptions options,
        CancellationToken cancellationToken)
    {
        var keys = options.Days().SelectMany(day => Enumerable.Range(0, 100).Select(slot =>
            HistoryKeys.Key(string.Create(CultureInfo.InvariantCulture, $"ops:{day:yyyy-MM-dd}:{slot:00}:turnaround"))))
            .ToArray();
        var ids = new List<long>();
        foreach (var page in keys.Chunk(1000))
            ids.AddRange(await db.Turnarounds.AsNoTracking().Where(item => page.Contains(item.PublicId))
                .Select(item => item.Id).ToArrayAsync(cancellationToken));
        return ids.Order().ToArray();
    }

    [Fact]
    public async Task DevelopmentHistoryOperationsFollowTheAppsLifecycleAndFeedTheOccAndPortalReports()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var options = DevelopmentHistoryOptions.Small;
        var ran = await SeedHistoryAsSeederAsync(database, options, ct);
        Assert.Equal(options.IsoWeeks().Select(week => "ops:" + week.Name), ran.Where(name => name.StartsWith("ops:", StringComparison.Ordinal)));

        await using var db = CreateContext(database.ConnectionString);
        var anchors = await HistoryAnchors.LoadAsync(db, ct);
        var catalog = await HistoryCatalog.LoadAsync(db, anchors, ct);
        var clock = new HistoryClock(anchors.Station.IanaTimeZone);
        var ids = await HistoryTurnaroundIdsAsync(db, options, ct);
        Assert.True(ids.Length >= options.Days().Count() * options.OperationsPerDay * 3 / 4, $"{ids.Length} operations.");

        var turnarounds = await db.Turnarounds.AsNoTracking().Where(item => ids.Contains(item.Id)).ToArrayAsync(ct);
        var operations = await db.GroundOperations.AsNoTracking().Where(item => ids.Contains(item.TurnaroundId))
            .ToArrayAsync(ct);
        Assert.Equal(turnarounds.Length, operations.Length);
        var operationIds = operations.Select(item => item.Id).ToArray();
        var byTurnaround = operations.ToDictionary(item => item.TurnaroundId);

        // One governing contract per operation date, the one the catalog (2-C) resolves; Demo Airlines flies too.
        Assert.All(turnarounds, turnaround =>
        {
            var governing = catalog.GoverningVersion(turnaround.AirlineId, turnaround.OperationDate);
            Assert.NotNull(governing);
            Assert.Equal(governing.Id, turnaround.ContractVersionId);
            Assert.Equal(anchors.Station.Id, turnaround.StationId);
        });
        Assert.Contains(turnarounds, turnaround => turnaround.AirlineId == catalog.Demo!.Id);
        Assert.Equal(turnarounds.Length, turnarounds.Select(item => item.OperationCode).Distinct(StringComparer.Ordinal).Count());
        Assert.All(turnarounds, turnaround => Assert.StartsWith(
            Elevant.Application.Operations.OperationCodeFormat.Prefix(anchors.Station.Code, turnaround.OperationDate),
            turnaround.OperationCode, StringComparison.Ordinal));

        // Final states: mostly approved, a few cancelled, pending and the two returned without correction.
        var statuses = operations.GroupBy(item => item.CurrentStatus).ToDictionary(group => group.Key, group => group.Count());
        Assert.True(statuses.GetValueOrDefault(GroundOperationStatus.Approved) > operations.Length * 8 / 10,
            string.Join(", ", statuses.Select(pair => $"{pair.Key}={pair.Value}")));
        Assert.Equal(2, statuses.GetValueOrDefault(GroundOperationStatus.Returned));
        Assert.DoesNotContain(GroundOperationStatus.InReview, statuses.Keys);
        Assert.All(turnarounds, turnaround => Assert.Equal(byTurnaround[turnaround.Id].CurrentStatus switch
        {
            GroundOperationStatus.Approved => TurnaroundStatus.Completed,
            GroundOperationStatus.Cancelled => TurnaroundStatus.Cancelled,
            _ => TurnaroundStatus.InProgress,
        }, turnaround.CurrentStatus));

        // Legs: one per direction, origin ≠ destination; stands: always closed; milestones once per code.
        var legs = await db.FlightLegs.AsNoTracking().Where(item => ids.Contains(item.TurnaroundId)).ToArrayAsync(ct);
        Assert.Equal(turnarounds.Length * 2, legs.Length);
        Assert.All(legs.GroupBy(item => (item.TurnaroundId, item.Direction)), group => Assert.Single(group));
        Assert.All(legs, leg => Assert.NotEqual(leg.OriginAirportId, leg.DestinationAirportId));
        var stands = await db.Set<StandAssignment>().AsNoTracking().Where(item => ids.Contains(item.TurnaroundId))
            .ToArrayAsync(ct);
        Assert.Equal(turnarounds.Length, stands.Length);
        Assert.All(stands, stand => Assert.NotNull(stand.AssignedTo));
        Assert.All(stands.Where(stand => byTurnaround[stand.TurnaroundId].CurrentStatus != GroundOperationStatus.Cancelled)
                .GroupBy(stand => stand.StandId),
            group =>
            {
                var ordered = group.OrderBy(item => item.AssignedFrom).ToArray();
                for (var index = 1; index < ordered.Length; index++)
                    Assert.True(ordered[index - 1].AssignedTo <= ordered[index].AssignedFrom,
                        $"Stand {group.Key} overlaps at {ordered[index].AssignedFrom:O}.");
            });
        var milestones = await db.Set<OperationMilestone>().AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId)).ToArrayAsync(ct);
        Assert.All(milestones.GroupBy(item => (item.GroundOperationId, item.Code)), group => Assert.Single(group));
        var executed = operations.Where(item => item.CurrentStatus != GroundOperationStatus.Cancelled).ToArray();
        Assert.Equal(executed.Length * 2, milestones.Length);

        // Crew: 2–3 history agents inside their shift, never DEV-RA-001; released once approved.
        var assignments = await db.OperationAgentAssignments.AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId)).ToArrayAsync(ct);
        var agents = catalog.Agents.ToDictionary(agent => agent.RampAgentId);
        Assert.All(executed, operation =>
        {
            var crew = assignments.Where(item => item.GroundOperationId == operation.Id).ToArray();
            Assert.InRange(crew.Length, 2, 3);
            Assert.Single(crew, item => item.AssignmentRole == "primary");
            var date = turnarounds.Single(item => item.Id == operation.TurnaroundId).OperationDate;
            Assert.All(crew, item =>
            {
                Assert.NotEqual(anchors.BaseRampAgentId, item.RampAgentId);
                var shift = agents[item.RampAgentId].Shifts[date];
                // A dawn arrival (NIGHT) starts before 06:00: the morning crew is called in early for it.
                var startsBy = clock.LocalTime(operation.ActualStartAt!.Value) < new TimeOnly(6, 0)
                    ? clock.At(date, new TimeOnly(6, 0))
                    : operation.ActualStartAt.Value;
                Assert.True(shift.StartsAt <= startsBy && operation.ActualEndAt <= shift.EndsAt,
                    $"{item.RampAgentId} works {operation.ActualStartAt:O}–{operation.ActualEndAt:O} outside its shift.");
                Assert.Equal(operation.CurrentStatus == GroundOperationStatus.Approved, item.ReleasedAt is not null);
            });
        });

        // Services: snapshots of the governing rates in a real billing unit; quantities follow the status.
        var services = await db.OperationServices.AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId)).ToArrayAsync(ct);
        Assert.All(executed, operation => Assert.InRange(services.Count(item => item.GroundOperationId == operation.Id), 1, 5));
        Assert.All(services, service =>
        {
            Assert.Contains(service.BillingUnitSnapshot, anchors.BillingUnits.Keys);
            Assert.NotNull(service.ContractServiceRateId);
            Assert.NotNull(service.UnitPriceSnapshot);
            Assert.Equal(3, service.CurrencyCodeSnapshot!.Length);
            if (service.CurrentStatus == ServiceExecutionStatus.NotPerformed) Assert.Equal(0m, service.ExecutedQuantity);
            else Assert.True(service.ExecutedQuantity >= 1m);
        });
        Assert.Contains(services, service => service.CurrentStatus == ServiceExecutionStatus.Completed);
        var rateIds = services.Select(item => item.ContractServiceRateId!.Value).Distinct().ToArray();
        var rates = await db.ContractServiceRates.AsNoTracking().Where(item => rateIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, ct);
        Assert.All(services, service => Assert.Equal(rates[service.ContractServiceRateId!.Value].UnitPrice,
            service.UnitPriceSnapshot));

        // Delays of 15 minutes or more are deviations with a valid IATA delay code.
        var incidents = await db.Incidents.AsNoTracking().Where(item => operationIds.Contains(item.GroundOperationId))
            .ToArrayAsync(ct);
        Assert.Contains(incidents, incident => incident.IncidentType == "Deviation");
        Assert.All(incidents, incident => Assert.True(Elevant.Application.Operations.RampIncidentPolicy.IsValid(
            incident.IncidentType, incident.Severity, incident.Description, incident.OccurredAt, incident.DelayCode)));
        Assert.All(incidents, incident => Assert.Equal(
            byTurnaroundOperation(incident.GroundOperationId) == GroundOperationStatus.Approved,
            incident.Status == IncidentStatus.Resolved));
        GroundOperationStatus byTurnaroundOperation(long operationId) =>
            operations.Single(item => item.Id == operationId).CurrentStatus;

        // The frozen evidence parses and is what a fresh capture reads (the incidents as they were at the hand-off).
        var submissions = await db.OperationSubmissions.AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId)).OrderBy(item => item.Id).ToArrayAsync(ct);
        Assert.Equal(executed.Length, submissions.Count(item => item.RevisionNumber == 1));
        Assert.Contains(submissions, item => item.RevisionNumber == 2);
        var sample = submissions.Where((_, index) => index % Math.Max(1, submissions.Length / 20) == 0)
            .Concat(submissions.Where(item => item.RevisionNumber == 2))
            .Concat(submissions.Where(item => incidents.Any(incident => incident.GroundOperationId == item.GroundOperationId)).Take(5))
            .DistinctBy(item => item.Id).ToArray();
        foreach (var submission in sample)
        {
            var stored = OperationSubmissionEvidence.Parse(submission.EvidenceJson!);
            Assert.Equal(OperationSubmissionEvidence.CurrentVersion, stored.Version);
            var first = submissions.Single(item => item.GroundOperationId == submission.GroundOperationId && item.RevisionNumber == 1);
            var fresh = await OperationSubmissionEvidence.CaptureAsync(db, submission.GroundOperationId, ct,
                first.SubmittedAt, submission.RevisionNumber > 1 ? submission.SubmittedAt : null);
            fresh = fresh with { Incidents = fresh.Incidents.Select(item => item with { Status = "Open" }).ToArray() };
            Assert.Equal(fresh.ToJson(), submission.EvidenceJson);
        }
        var decisions = await db.ReviewDecisions.AsNoTracking()
            .Where(item => submissions.Select(submission => submission.Id).Contains(item.OperationSubmissionId))
            .ToArrayAsync(ct);
        Assert.All(decisions.Where(item => item.Outcome == ReviewOutcome.Approved), decision =>
        {
            var submission = submissions.Single(item => item.Id == decision.OperationSubmissionId);
            var approved = OperationSubmissionEvidence.Parse(decision.ApprovedEvidenceJson!);
            Assert.Equal(OperationSubmissionEvidence.Parse(submission.EvidenceJson!).Services.Length, approved.Services.Length);
            Assert.Equal(HistoryOccAccountInternal(), decision.ReviewerAccountId);
            Assert.True(decision.DecidedAt > submission.SubmittedAt);
        });
        Assert.All(decisions.Where(item => item.Outcome == ReviewOutcome.Returned),
            decision => Assert.False(string.IsNullOrWhiteSpace(decision.Reason)));
        long HistoryOccAccountInternal() => anchors.Occ.Id;
        var charges = await db.OperationServiceCharges.AsNoTracking()
            .Where(item => services.Select(service => service.Id).Contains(item.OperationServiceId)).ToArrayAsync(ct);
        Assert.Contains(charges, charge => charge.Source == ChargeMarkSource.Automatic);
        // The extra operations bill what the regular day never reaches: NIGHT (dawn arrivals) and OVERTIME.
        var chargeCodes = await db.ChargeDefinitions.AsNoTracking()
            .Where(item => charges.Select(charge => charge.ChargeDefinitionId).Contains(item.Id))
            .Select(item => item.Code).ToArrayAsync(ct);
        Assert.Contains(AutomaticSurchargeCodes.Night, chargeCodes);
        Assert.Contains(AutomaticSurchargeCodes.Overtime, chargeCodes);

        // Nothing happens between 22:30 and 05:30 local.
        var instants = new List<DateTimeOffset>();
        instants.AddRange(legs.Select(item => item.ScheduledAt));
        instants.AddRange(legs.Select(item => item.ActualAt).OfType<DateTimeOffset>());
        instants.AddRange(stands.SelectMany(item => new[] { item.AssignedFrom, item.AssignedTo!.Value, item.CreatedAt }));
        instants.AddRange(operations.SelectMany(item => new[] { item.PlannedStartAt, item.PlannedEndAt, item.ActualStartAt,
            item.ActualEndAt, item.CreatedAt, item.UpdatedAt }).OfType<DateTimeOffset>());
        instants.AddRange(assignments.SelectMany(item => new[] { item.AssignedAt, item.ReleasedAt }).OfType<DateTimeOffset>());
        instants.AddRange(milestones.Select(item => item.ActualAt!.Value));
        instants.AddRange(incidents.SelectMany(item => new[] { item.OccurredAt, item.ReportedAt, item.ResolvedAt })
            .OfType<DateTimeOffset>());
        instants.AddRange(submissions.Select(item => item.SubmittedAt));
        instants.AddRange(decisions.Select(item => item.DecidedAt));
        instants.AddRange(charges.Select(item => item.AppliedAt));
        instants.AddRange(await db.Set<GroundOperationStatusEvent>().AsNoTracking()
            .Where(item => operationIds.Contains(item.GroundOperationId)).Select(item => item.OccurredAt).ToArrayAsync(ct));
        instants.AddRange(await db.Set<TurnaroundStatusEvent>().AsNoTracking()
            .Where(item => ids.Contains(item.TurnaroundId)).Select(item => item.OccurredAt).ToArrayAsync(ct));
        var serviceIds = services.Select(item => item.Id).ToArray();
        instants.AddRange(await db.Set<OperationServiceStatusEvent>().AsNoTracking()
            .Where(item => serviceIds.Contains(item.OperationServiceId)).Select(item => item.OccurredAt).ToArrayAsync(ct));
        var end = clock.ToUtc(options.WindowEnd, HistoryClock.DayEnd);
        Assert.All(instants, at =>
        {
            Assert.True(clock.IsOperatingTime(at), $"{at:O}");
            Assert.True(at <= end, $"{at:O} after the window.");
        });

        // Every OCC report has rows for the window.
        await using var scope = provider.CreateAsyncScope();
        var reports = scope.ServiceProvider.GetRequiredService<IOccReportStore>();
        foreach (var kind in Enum.GetValues<OccReportKind>())
        {
            var result = await reports.ReadAsync(HistoryOccAccount, kind, anchors.Station.PublicId, options.WindowStart,
                options.WindowEnd, 1, 100, OccReportFilters.None, ct);
            Assert.Null(result.Failure);
            Assert.True(result.Table!.Rows.Count > 0, $"OCC report {kind} is empty.");
        }

        // The airline portal of Demo Airlines (airline.client) reads its operations and their report.
        var portal = scope.ServiceProvider.GetRequiredService<IAirlinePortalReportStore>();
        var organization = await db.Organizations.AsNoTracking()
            .Where(item => item.Id == catalog.Demo!.OrganizationId).Select(item => item.PublicId).SingleAsync(ct);
        var portalOperations = (await portal.OperationsAsync(organization, options.WindowStart, options.WindowEnd, null,
            null, ct))!;
        Assert.Contains(portalOperations, item => turnarounds.Any(turnaround => turnaround.OperationCode == item.OperationCode));
        Assert.Contains(portalOperations, item => item.Status == GroundOperationStatus.Approved && item.Services.Count > 0);
        var portalReports = new AirlinePortalReports(
            scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(), portal,
            scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceTreasuryStore>(),
            TimeProvider.System);
        var definition = AirlinePortalReports.All.Find("operations")!;
        var report = await portalReports.ReadAsync(NewReportsAirlineAccount, definition, NewReportsQuery(definition,
            options.WindowStart.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            options.WindowEnd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), ct);
        Assert.Null(report.Failure);
        Assert.NotEmpty(report.Document!.Rows);

        // A second run takes the fast path and writes nothing.
        var before = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Assert.Empty(await SeedHistoryAsSeederAsync(database, options, ct));
        Assert.Equal(before, await HistoryTableCountsAsync(database.ConnectionString, ct));
    }

    /// <summary>
    /// Local measurement (not in CI): one week of operations at the Default volume, after the chunks it needs. Set
    /// <c>ELEVANT_TEST_HISTORY_TIMING=1</c> to run it; the time is written to the test output.
    /// </summary>
    [Fact]
    public async Task DevelopmentHistoryOperationsWeekAtDefaultVolumeTiming()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_TEST_HISTORY_TIMING") != "1") return;
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var options = DevelopmentHistoryOptions.Default;
        await using var connection = await database.OpenAsDevelopmentSeederAsync(ct);
        await using var context = CreateContext(connection);
        context.ChangeTracker.AutoDetectChangesEnabled = false;
        context.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        var chunks = HistoryChunkRegistry.Build(options);
        var output = TestContext.Current.TestOutputHelper;
        foreach (var chunk in chunks)
        {
            var watch = Stopwatch.StartNew();
            await HistoryChunkRunner.RunAsync(context, chunk, options, ct);
            output?.WriteLine($"{chunk.Name}: {watch.Elapsed.TotalSeconds:0.0} s");
            if (chunk.Name.StartsWith("ops:", StringComparison.Ordinal)) break;
        }
        var count = await context.Turnarounds.CountAsync(ct);
        output?.WriteLine($"turnarounds after one week: {count}");
    }
}
