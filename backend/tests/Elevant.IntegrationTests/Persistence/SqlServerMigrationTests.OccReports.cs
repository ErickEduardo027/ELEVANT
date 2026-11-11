using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// The OCC reports read the operational projections (phase 3, block E): productivity goes to whoever worked each
/// stretch of an operation (3-N14), «Servicios ejecutados» counts the billable services of the approved operations
/// only, the same set Finance has «Por facturar» (3-N15), and what a person reads is Spanish in the station's local
/// time (3-N26).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly string[] ReportAgentSurnames = ["Alfa", "Bravo", "Charlie"];

    [Fact]
    public async Task OccReportsAttributeWorkToWhoWorkedItAndCountOnlyApprovedBillableServices()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var reports = scope.ServiceProvider.GetRequiredService<IOccReportStore>();
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");
        await using var context = CreateContext(database.ConnectionString);
        var station = await context.Stations.SingleAsync(item => item.Code == "PUJ", ct);
        var seeded = await context.Turnarounds.SingleAsync(item => item.OperationCode == "DEV-TAT-0001", ct);
        var seededOperation = await context.GroundOperations.SingleAsync(item => item.TurnaroundId == seeded.Id, ct);
        var templates = await context.OperationServices.AsNoTracking()
            .Where(item => item.GroundOperationId == seededOperation.Id).OrderBy(item => item.LineNumber).ToArrayAsync(ct);
        var serviceNames = await context.ServiceDefinitions.AsNoTracking()
            .Where(item => item.Id == templates[0].ServiceDefinitionId || item.Id == templates[1].ServiceDefinitionId)
            .ToDictionaryAsync(item => item.Id, item => item.Name, ct);
        var occAccount = await context.Users.Where(user => user.PublicId == occ).Select(user => user.Id).SingleAsync(ct);
        var day = new DateOnly(2026, 7, 15);
        static DateTimeOffset At(int hour, int minute) => new(2026, 7, 15, hour, minute, 0, TimeSpan.Zero);
        var now = DateTimeOffset.UtcNow;

        var persons = ReportAgentSurnames.Select(name => new Person
        {
            PublicId = Guid.CreateVersion7(), FirstName = "Reporte", LastName = name, IdentificationType = "TEST",
            IdentificationNumber = $"REPORT-{name.ToUpperInvariant()}", CreatedAt = now, UpdatedAt = now,
        }).ToArray();
        context.Persons.AddRange(persons);
        await context.SaveChangesAsync(ct);
        var agents = persons.Select((person, index) => new RampAgent
        {
            PublicId = Guid.CreateVersion7(), PersonId = person.Id, EmployeeNumber = $"DEV-RPT-{index + 1:000}",
            Category = "Development test", HireDate = new DateOnly(2026, 1, 1), IsActive = true, CreatedAt = now,
            UpdatedAt = now,
        }).ToArray();
        context.RampAgents.AddRange(agents);
        await context.SaveChangesAsync(ct);
        var (alfa, bravo, charlie) = (agents[0].Id, agents[1].Id, agents[2].Id);

        async Task<GroundOperation> OperationAsync(string code, GroundOperationStatus status, DateTimeOffset? start,
            DateTimeOffset? end)
        {
            var turnaround = new Turnaround
            {
                PublicId = Guid.CreateVersion7(), OperationCode = code, AirlineId = seeded.AirlineId, StationId = station.Id,
                OperationDate = day, AircraftTypeId = seeded.AircraftTypeId, AircraftRegistration = "HI-RPT",
                CurrentStatus = TurnaroundStatus.Confirmed, Source = OperationalDataSource.Internal, CreatedAt = now,
                UpdatedAt = now,
            };
            context.Turnarounds.Add(turnaround);
            await context.SaveChangesAsync(ct);
            var operation = new GroundOperation
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, CurrentStatus = status,
                PlannedStartAt = At(13, 0), PlannedEndAt = At(14, 30), ActualStartAt = start, ActualEndAt = end,
                CreatedAt = now, UpdatedAt = now,
            };
            context.GroundOperations.Add(operation);
            await context.SaveChangesAsync(ct);
            return operation;
        }

        void Assign(GroundOperation operation, long agent, DateTimeOffset assignedAt, DateTimeOffset? releasedAt = null) =>
            context.OperationAgentAssignments.Add(new OperationAgentAssignment
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, RampAgentId = agent,
                AssignmentRole = "primary", AssignedAt = assignedAt, ReleasedAt = releasedAt, CreatedAt = now,
                UpdatedAt = now,
            });

        void Serve(GroundOperation operation, int line, OperationService template, ServiceExecutionStatus status,
            decimal executed, bool excluded = false) =>
            context.OperationServices.Add(new OperationService
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, LineNumber = line,
                ServiceDefinitionId = template.ServiceDefinitionId, ContractServiceRateId = template.ContractServiceRateId,
                ContractedQuantity = 1m, ExecutedQuantity = executed, BillingUnitSnapshot = template.BillingUnitSnapshot,
                UnitPriceSnapshot = template.UnitPriceSnapshot, CurrencyCodeSnapshot = template.CurrencyCodeSnapshot,
                CurrentStatus = status, CreatedAt = now, UpdatedAt = now,
                BillingExcludedAt = excluded ? now : null, BillingExcludedByAccountId = excluded ? occAccount : null,
                BillingExclusionReason = excluded ? "Excluido por OCC en la revisión." : null,
            });

        // Approved, 13:00–14:15Z: Alfa was released at a stand change before the start, Bravo worked until the
        // handover at 13:30 and Charlie from there to the end.
        var relayed = await OperationAsync("PUJ-20260715-901", GroundOperationStatus.Approved, At(13, 0), At(14, 15));
        Assign(relayed, alfa, At(10, 0), At(12, 30));
        Assign(relayed, bravo, At(12, 30), At(13, 30));
        Assign(relayed, charlie, At(13, 30));
        // Approved, 15:00–16:00Z, Bravo alone: the approval releases nobody (3-D).
        var single = await OperationAsync("PUJ-20260715-902", GroundOperationStatus.Approved, At(15, 0), At(16, 0));
        Assign(single, bravo, At(11, 0));
        // Not started: it belongs to Alfa, without minutes.
        var planned = await OperationAsync("PUJ-20260715-903", GroundOperationStatus.Assigned, null, null);
        Assign(planned, alfa, At(11, 0));
        // Handed off and still pending review: Charlie worked it, but none of its services count until it is approved.
        var pending = await OperationAsync("PUJ-20260715-904", GroundOperationStatus.PendingReview, At(17, 0), At(18, 0));
        Assign(pending, charlie, At(16, 30));
        // 3-N15: the completed service and the one in exception with a quantity are billed; the one not performed, the
        // one OCC excluded in the review, the planned one and those of the operation under review are not.
        Serve(relayed, 1, templates[0], ServiceExecutionStatus.Completed, 2m);
        Serve(relayed, 2, templates[1], ServiceExecutionStatus.Exception, 1m);
        Serve(single, 1, templates[0], ServiceExecutionStatus.NotPerformed, 0m);
        Serve(single, 2, templates[1], ServiceExecutionStatus.Exception, 1m, excluded: true);
        Serve(planned, 1, templates[0], ServiceExecutionStatus.Planned, 0m);
        Serve(pending, 1, templates[0], ServiceExecutionStatus.Completed, 1m);
        await context.SaveChangesAsync(ct);

        // 3-N26: OCC approved the relayed operation at 14:30Z (10:30 in Punta Cana) with a safety incident of Charlie.
        var template = await context.OperationChecklists.AsNoTracking().Select(item => item.ChecklistTemplateVersionId)
            .FirstAsync(ct);
        var checklist = new OperationChecklist
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = relayed.Id, ChecklistTemplateVersionId = template,
            RevisionNumber = 1, Status = ChecklistStatus.Submitted, StartedAt = At(13, 0), SubmittedAt = At(14, 15),
            SubmittedByRampAgentId = charlie, CreatedAt = now, UpdatedAt = now,
        };
        context.OperationChecklists.Add(checklist);
        await context.SaveChangesAsync(ct);
        var submission = new OperationSubmission
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = relayed.Id, OperationChecklistId = checklist.Id,
            RevisionNumber = 1, Status = SubmissionStatus.Approved, SubmittedByRampAgentId = charlie,
            SubmittedAt = At(14, 15), CreatedAt = now, UpdatedAt = now,
        };
        context.OperationSubmissions.Add(submission);
        context.Incidents.Add(new Incident
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = relayed.Id, ReportedByRampAgentId = charlie,
            IncidentType = "Safety", Severity = IncidentSeverity.High, Status = IncidentStatus.Closed,
            Description = "Cono de seguridad fuera de su lugar.", OccurredAt = At(13, 40), ReportedAt = At(13, 45),
            CreatedAt = now, UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);
        context.ReviewDecisions.Add(new ReviewDecision
        {
            PublicId = Guid.CreateVersion7(), OperationSubmissionId = submission.Id, ReviewerAccountId = occAccount,
            Outcome = ReviewOutcome.Approved, DecidedAt = At(14, 30), CreatedAt = now, UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);

        async Task<string[][]> RowsAsync(OccReportKind kind)
        {
            var result = await reports.ReadAsync(occ, kind, station.PublicId, day, day, 1, 100, ct);
            Assert.Null(result.Failure);
            // The exports write «Generado» in the station's zone (3-N26).
            Assert.Equal(station.IanaTimeZone, result.Table!.TimeZoneId);
            return result.Table.Rows.Select(row => row.Select(cell => cell.Value).ToArray()).ToArray();
        }
        static decimal Number(string value) => decimal.Parse(value, NumberStyles.Number, CultureInfo.InvariantCulture);

        // 3-N14: one row per agent who worked; Alfa keeps only the operation not started yet, without minutes; Bravo
        // adds his 30 minutes before the handover to his 60 alone; Charlie his 45 after it and the 60 under review.
        var productivity = await RowsAsync(OccReportKind.AgentProductivity);
        Assert.Equal(["Reporte Alfa", "Reporte Bravo", "Reporte Charlie"], productivity.Select(row => row[0]));
        Assert.Equal([1m, 0m, 0m, 0m], productivity[0][2..].Select(Number));
        Assert.Equal([2m, 2m, 0m, 90m], productivity[1][2..].Select(Number));
        Assert.Equal([2m, 1m, 0m, 105m], productivity[2][2..].Select(Number));
        Assert.Equal("DEV-RPT-002", productivity[1][1]);

        // «Agentes» of the operations report lists who worked each one, never the agent released before the start.
        var operations = (await RowsAsync(OccReportKind.Operations)).ToDictionary(row => row[1]);
        Assert.Equal("Reporte Bravo, Reporte Charlie", operations["PUJ-20260715-901"][9]);
        Assert.Equal("Reporte Bravo", operations["PUJ-20260715-902"][9]);
        Assert.Equal("Reporte Alfa", operations["PUJ-20260715-903"][9]);
        Assert.Equal("Reporte Charlie", operations["PUJ-20260715-904"][9]);

        // 3-N15: only the approved operation's billable services: one operation per service, with its quantities.
        var services = (await RowsAsync(OccReportKind.ServicesByAirline)).ToDictionary(row => row[1]);
        Assert.Equal(2, services.Count);
        Assert.Equal([1m, 1m, 2m], services[serviceNames[templates[0].ServiceDefinitionId]][3..].Select(Number));
        Assert.Equal([1m, 1m, 1m], services[serviceNames[templates[1].ServiceDefinitionId]][3..].Select(Number));
        // 3-N26: the unit as Finance names it in its catalog, never the code of the rate snapshot.
        var units = await context.BillingUnits.AsNoTracking().ToDictionaryAsync(item => item.Code, item => item.Name, ct);
        Assert.Equal(units[templates[0].BillingUnitSnapshot], services[serviceNames[templates[0].ServiceDefinitionId]][2]);
        Assert.Equal(units[templates[1].BillingUnitSnapshot], services[serviceNames[templates[1].ServiceDefinitionId]][2]);
        Assert.DoesNotContain(services.Values, row => row[2] == templates[0].BillingUnitSnapshot);
        Assert.Equal("1", services[serviceNames[templates[0].ServiceDefinitionId]][4]);
        // The same set Finance has in «Por facturar» for the day (ServiceBillability, 3-N11). The preinvoice pipeline
        // report left with the preinvoice (4-A): the pending operations of the day are the cross-check.
        var toInvoice = await scope.ServiceProvider.GetRequiredService<Elevant.Application.Finance.IFinancePendingOperationsReadStore>()
            .GetAsync(new Elevant.Application.Finance.GetFinancePendingOperationsQuery(FinanceAccount, station.PublicId, day, day,
                null, null), ct);
        Assert.NotNull(toInvoice);
        Assert.Equal(services.Values.Sum(row => Number(row[3])), (decimal)toInvoice.Operations.Sum(item => item.Services.Count));

        // 3-N26: the review lists the incident in Spanish, its decision in the station's local time, and the status of
        // every operation is Spanish.
        var review = Assert.Single(await RowsAsync(OccReportKind.Reviews));
        Assert.Equal(["15/07/2026", "PUJ-20260715-901"], review[..2]);
        Assert.Equal(["1", "Aprobada", "—", "15/07/2026 10:30", "Seguridad (alta)"], review[3..]);
        Assert.Equal("Aprobada", operations["PUJ-20260715-901"][4]);
        Assert.Equal("Pendiente de revisión", operations["PUJ-20260715-904"][4]);
        Assert.Equal(["09:00", "10:15"], operations["PUJ-20260715-901"][7..9]);
    }
}
