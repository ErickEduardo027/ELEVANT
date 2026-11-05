using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>ADR-0035: Finance invoices approved operations directly, with a simulated e-CF and ITBIS 18 %.</summary>
    [Fact]
    public async Task InvoiceIssuanceTaxesApprovedOperationsAssignsEcfAndSettlesCharterPrepayment()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var first = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var second = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);

        async Task<IssueInvoiceResult> IssueAsync(Guid requestId, params Guid[] operations)
        {
            await using var scope = provider.CreateAsyncScope();
            return await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, operations, requestId), ct);
        }

        // Contracts cannot issue invoices.
        await using (var scope = provider.CreateAsyncScope())
            Assert.Equal(IssueInvoiceFailure.Forbidden, (await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(ContractsAccount, station, [first], Guid.NewGuid()), ct)).Failure);

        var requestId = Guid.NewGuid();
        var issued = await IssueAsync(requestId, first);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        Assert.Equal("E310000000001", issued.FiscalNumber);
        Assert.False(issued.Replayed);
        var replay = await IssueAsync(requestId, first);
        Assert.True(replay.Replayed);
        Assert.Equal(issued.InvoiceId, replay.InvoiceId);
        var again = await IssueAsync(Guid.NewGuid(), first);
        Assert.Equal((IssueInvoiceFailure.Conflict, "already_invoiced"), (again.Failure!.Value, again.Reason));

        setup.ChangeTracker.Clear();
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        Assert.True(FinanceInvoicePolicy.IsFiscalNumber(invoice.FiscalNumber));
        Assert.Equal(6, invoice.SecurityCode!.Length);
        Assert.NotNull(invoice.FiscalSignedAt);
        var preinvoice = await setup.Preinvoices.AsNoTracking().SingleAsync(item => item.Id == invoice.PreinvoiceId, ct);
        Assert.Equal(PreinvoiceStatus.Invoiced, preinvoice.Status);
        var lines = await setup.PreinvoiceLines.AsNoTracking().Where(line => line.PreinvoiceId == preinvoice.Id && !line.IsExcluded)
            .ToArrayAsync(ct);
        Assert.NotEmpty(lines);
        Assert.All(lines, line =>
        {
            Assert.Equal(FinanceInvoicePolicy.ItbisRate, line.TaxRate);
            Assert.Equal(FinanceInvoicePolicy.Tax(line.NetAmount!.Value), line.TaxAmount);
            Assert.Equal(line.NetAmount + line.TaxAmount, line.Amount);
        });
        Assert.Equal(lines.Sum(line => line.Amount), invoice.Total);
        Assert.True(invoice.Total > 0);
        var email = await setup.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.InvoiceIssued).ToArrayAsync(ct);
        Assert.NotEmpty(email);
        Assert.All(email, item => Assert.Equal($"invoice:{invoice.PublicId:D}", item.AttachmentReference));
        Assert.Contains(email, item => item.Subject.Contains("E310000000001", StringComparison.Ordinal));
        Assert.Equal(1, await setup.AuditEntries.CountAsync(item => item.Action == "finance.invoice.issued", ct));

        // One invoice is always for a single airline.
        var secondTurnaround = await setup.GroundOperations.Where(item => item.PublicId == second).Select(item => item.TurnaroundId).SingleAsync(ct);
        var airlineId = await setup.Turnarounds.Where(item => item.Id == secondTurnaround).Select(item => item.AirlineId).SingleAsync(ct);
        var stamp = DateTimeOffset.UtcNow;
        var otherOrganization = new Elevant.Domain.Entities.Identity.Organization { PublicId = Guid.NewGuid(), Code = "QA-MIXED-AIR",
            LegalName = "MIXED SYNTHETIC AIRLINE", DisplayName = "Mixed Airline", Type = OrganizationType.AirlineCustomer,
            Status = OrganizationStatus.Active, CreatedAt = stamp, UpdatedAt = stamp };
        setup.Organizations.Add(otherOrganization);
        await setup.SaveChangesAsync(ct);
        var mixedAirline = new Elevant.Domain.Entities.Reference.Airline { PublicId = Guid.NewGuid(), OrganizationId = otherOrganization.Id,
            IataCode = "QM", IcaoCode = "QMX", Name = "Mixed Airline", IsActive = true, CreatedAt = stamp, UpdatedAt = stamp };
        setup.Airlines.Add(mixedAirline);
        await setup.SaveChangesAsync(ct);
        long? otherAirline = mixedAirline.Id;
        var third = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct, cloneAs: "DEV-TAT-MIXED", airlineId: otherAirline);
        var mixed = await IssueAsync(Guid.NewGuid(), second, third);
        Assert.Equal((IssueInvoiceFailure.Unprocessable, "mixed_airline"), (mixed.Failure!.Value, mixed.Reason));
        // An operation that is not approved by OCC is not invoiced.
        await setup.GroundOperations.Where(item => item.PublicId == third).ExecuteUpdateAsync(set => set.SetProperty(item => item.CurrentStatus, GroundOperationStatus.PendingReview), ct);
        var pending = await IssueAsync(Guid.NewGuid(), third);
        Assert.Equal((IssueInvoiceFailure.Conflict, "operation_not_approved"), (pending.Failure!.Value, pending.Reason));

        // A charter's confirmed prepayment settles its invoice; the excess stays available to the airline.
        var financeId = await setup.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id).SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        setup.Set<CharterAgreement>().Add(new CharterAgreement
        {
            PublicId = Guid.NewGuid(), TurnaroundId = secondTurnaround, AirlineId = airlineId, CurrencyCode = invoice.CurrencyCode,
            PrepaymentStatus = CharterPrepaymentStatus.Confirmed, PrepaymentAmount = 100000m, PrepaymentReference = "TRF-QA-001",
            PrepaymentConfirmedAt = now, PrepaymentConfirmedByAccountId = financeId, CreatedByAccountId = financeId,
            CreatedAt = now, UpdatedAt = now,
        });
        await setup.SaveChangesAsync(ct);
        var charter = await IssueAsync(Guid.NewGuid(), second);
        Assert.True(charter.IsSuccess, $"{charter.Failure} {charter.Reason}");
        Assert.Equal("E310000000002", charter.FiscalNumber);
        setup.ChangeTracker.Clear();
        var charterInvoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == charter.InvoiceId, ct);
        var receipt = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.Reference == "PREPAGO TRF-QA-001", ct);
        Assert.Equal(100000m, receipt.Amount);
        Assert.Equal(charterInvoice.Total, await setup.Set<FinanceTreasuryMovement>().AsNoTracking()
            .Where(item => item.InvoiceId == charterInvoice.Id).SumAsync(item => item.InvoiceAmount, ct));
    }

    private static IssueInvoiceHandler Handler(IServiceProvider services) =>
        new(services.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(),
            services.GetRequiredService<IInvoiceIssuanceStore>());

    /// <summary>Completes the operation's services, records OCC-approved evidence and approves the operation.</summary>
    private static async Task<Guid> ApproveForInvoicingAsync(ElevantDbContext db, string code, CancellationToken ct,
        string? cloneAs = null, long? airlineId = null)
    {
        db.ChangeTracker.Clear();
        var tat = await db.Turnarounds.SingleAsync(item => item.OperationCode == code, ct);
        GroundOperation op;
        if (cloneAs is null)
            op = await db.GroundOperations.SingleAsync(item => item.TurnaroundId == tat.Id, ct);
        else
        {
            var now = DateTimeOffset.UtcNow;
            var clone = new Turnaround
            {
                PublicId = Guid.NewGuid(), OperationCode = cloneAs, AirlineId = airlineId ?? tat.AirlineId, StationId = tat.StationId,
                OperationDate = tat.OperationDate, AircraftTypeId = tat.AircraftTypeId, AircraftRegistration = "HI-MIX",
                CurrentStatus = tat.CurrentStatus, Source = tat.Source, CreatedAt = now, UpdatedAt = now,
            };
            db.Turnarounds.Add(clone);
            await db.SaveChangesAsync(ct);
            op = new GroundOperation { PublicId = Guid.NewGuid(), TurnaroundId = clone.Id, CurrentStatus = GroundOperationStatus.Approved,
                CreatedAt = now, UpdatedAt = now };
            db.GroundOperations.Add(op);
            await db.SaveChangesAsync(ct);
            return op.PublicId;
        }
        op.CurrentStatus = GroundOperationStatus.Approved;
        var services = await db.OperationServices.Where(item => item.GroundOperationId == op.Id).OrderBy(item => item.LineNumber)
            .Take(2).ToArrayAsync(ct);
        var definition = await db.ServiceDefinitions.SingleAsync(item => item.Code == "BAGGAGE", ct);
        var contract = await db.Contracts.SingleAsync(item => item.ContractCode == "DEV-CONTRACT-0001", ct);
        var version = await db.ContractVersions.SingleAsync(item => item.ContractId == contract.Id, ct);
        var rate = await db.ContractServiceRates.SingleAsync(item => item.ContractVersionId == version.Id &&
            item.ServiceDefinitionId == definition.Id, ct);
        var at = new DateTimeOffset(tat.OperationDate.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero);
        foreach (var service in services)
        {
            service.ServiceDefinitionId = definition.Id; service.ContractServiceRateId = rate.Id;
            service.CurrentStatus = ServiceExecutionStatus.Completed; service.ContractedQuantity = 1; service.ExecutedQuantity = 1;
            service.UnitPriceSnapshot = 10; service.CurrencyCodeSnapshot = "USD"; service.BillingUnitSnapshot = "minute";
            db.Set<OperationServiceStatusEvent>().Add(new() { OperationServiceId = service.Id, ToStatus = ServiceExecutionStatus.InProgress, OccurredAt = at });
            db.Set<OperationServiceStatusEvent>().Add(new() { OperationServiceId = service.Id, FromStatus = ServiceExecutionStatus.InProgress,
                ToStatus = ServiceExecutionStatus.Completed, OccurredAt = at.AddMinutes(30) });
        }
        var agent = await db.RampAgents.SingleAsync(item => item.EmployeeNumber == "DEV-RA-001", ct);
        var checklist = await db.OperationChecklists.FirstOrDefaultAsync(item => item.GroundOperationId == op.Id, ct);
        if (checklist is null)
        {
            var template = await db.OperationChecklists.AsNoTracking().Select(item => item.ChecklistTemplateVersionId).FirstAsync(ct);
            checklist = new OperationChecklist
            {
                PublicId = Guid.NewGuid(), GroundOperationId = op.Id, ChecklistTemplateVersionId = template, RevisionNumber = 1,
                Status = ChecklistStatus.Submitted, StartedAt = at, SubmittedAt = at.AddHours(2), SubmittedByRampAgentId = agent.Id,
                CreatedAt = at, UpdatedAt = at,
            };
            db.OperationChecklists.Add(checklist);
            await db.SaveChangesAsync(ct);
        }
        var submission = new OperationSubmission
        {
            PublicId = Guid.NewGuid(), GroundOperationId = op.Id, OperationChecklistId = checklist.Id, RevisionNumber = 1,
            Status = SubmissionStatus.Approved, SubmittedByRampAgentId = agent.Id, SubmittedAt = at.AddHours(2),
            CreatedAt = at.AddHours(2), UpdatedAt = at.AddHours(2),
            EvidenceJson = JsonSerializer.Serialize(new { version = 2, services = Array.Empty<object>(), incidents = Array.Empty<object>(), charges = Array.Empty<object>() }),
        };
        db.OperationSubmissions.Add(submission);
        await db.SaveChangesAsync(ct);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(db, op.Id, ct, submission.SubmittedAt)).ToJson();
        var reviewerId = await db.Users.Where(item => item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000001"))
            .Select(item => item.Id).SingleAsync(ct);
        db.ReviewDecisions.Add(new() { PublicId = Guid.NewGuid(), OperationSubmissionId = submission.Id, ReviewerAccountId = reviewerId,
            Outcome = ReviewOutcome.Approved, DecidedAt = at.AddHours(3), CreatedAt = at.AddHours(3), UpdatedAt = at.AddHours(3) });
        await db.SaveChangesAsync(ct);
        return op.PublicId;
    }
}
