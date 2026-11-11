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

        // 1-N08: the issuing screen reads what the invoice really queued, never «sent» by default.
        await using (var scope = provider.CreateAsyncScope())
        {
            var status = scope.ServiceProvider.GetRequiredService<IInvoiceEmailStatusStore>();
            var deliveries = (await status.ListAsync(FinanceAccount, invoice.PublicId, ct))!;
            Assert.Equal(email.Select(item => item.Recipient).Order(), deliveries.Select(item => item.Recipient).Order());
            Assert.All(deliveries, item => Assert.Equal(("Pending", (string?)null), (item.Status, item.Reason)));
            Assert.Null(await status.ListAsync(ContractsAccount, invoice.PublicId, ct));
            Assert.Null(await status.ListAsync(FinanceAccount, Guid.NewGuid(), ct));
            // A failure reads as its normalized reason; an invoice nobody could receive has no deliveries.
            await setup.Set<EmailOutboxMessage>().Where(item => item.Purpose == EmailPurpose.InvoiceIssued)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, EmailDeliveryStatus.Failed)
                    .SetProperty(item => item.LastError, "SmtpException: mailbox unavailable"), ct);
            Assert.All((await status.ListAsync(FinanceAccount, invoice.PublicId, ct))!,
                item => Assert.Equal(("Failed", (string?)"send_failed"), (item.Status, item.Reason)));
            await setup.Set<EmailOutboxMessage>().Where(item => item.Purpose == EmailPurpose.InvoiceIssued)
                .ExecuteDeleteAsync(ct);
            Assert.Empty((await status.ListAsync(FinanceAccount, invoice.PublicId, ct))!);
        }

        // The airline reads its own invoice with the e-NCF in the portal (Demo Airlines owns DEV-TAT-0001).
        await using (var portalContext = CreateContext(database.ConnectionString))
        {
            var portal = new Elevant.Persistence.Finance.FinanceTreasuryStore(portalContext,
                new Elevant.Persistence.Identity.EfActorContextResolver(portalContext, TimeProvider.System), TimeProvider.System);
            var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
            var statement = await portal.PortalStatementAsync(airlineAccount, Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow), null, ct);
            Assert.True(statement.IsSuccess);
            var own = Assert.Single(statement.Data!.Invoices, item => item.Id == invoice.PublicId);
            Assert.Equal("E310000000001", own.FiscalNumber);
            Assert.Equal(invoice.Total, own.Balance);
            Assert.Equal("E310000000001", (await portal.PortalInvoiceAsync(airlineAccount, invoice.PublicId, ct)).Data!.Invoice.FiscalNumber);
        }

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

    /// <summary>
    /// 4-N01, 4-N06, 4-N07, 4-N29: a refusal writes nothing (the internal draft, its lines, the package consumption, the
    /// e-NCF and the email included), the operation stays pending and the same key issues once it is fixed; a total of
    /// zero is refused; the key with other operations, or with other versions, is idempotency_conflict and a stale
    /// version is version_conflict. An invoice issued before its receipt existed still replays by its operations.
    /// </summary>
    [Fact]
    public async Task InvoiceIssuanceRollsBackRefusalsComparesReplaysAndChecksVersions()
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

        async Task<IssueInvoiceResult> IssueAsync(Guid requestId, Guid[] operations,
            IReadOnlyList<InvoiceOperationVersion>? versions = null)
        {
            await using var scope = provider.CreateAsyncScope();
            return await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, operations, requestId, versions), ct);
        }
        async Task<(int Drafts, int Lines, int Invoices, int Emails, int Consumptions)> WrittenAsync()
        {
            setup.ChangeTracker.Clear();
            return (await setup.Preinvoices.CountAsync(ct), await setup.PreinvoiceLines.CountAsync(ct),
                await setup.NonFiscalInvoices.CountAsync(ct), await setup.Set<EmailOutboxMessage>().CountAsync(ct),
                await setup.Set<PackageConsumption>().CountAsync(ct));
        }

        // An inactive customer organization is refused before anything is written; reactivated, the same key issues.
        var organization = await (from operation in setup.GroundOperations
                                  join turnaround in setup.Turnarounds on operation.TurnaroundId equals turnaround.Id
                                  join airline in setup.Airlines on turnaround.AirlineId equals airline.Id
                                  where operation.PublicId == first
                                  select airline.OrganizationId).SingleAsync(ct);
        await setup.Organizations.Where(item => item.Id == organization)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.Status, OrganizationStatus.Inactive), ct);
        var before = await WrittenAsync();
        var key = Guid.NewGuid();
        var inactive = await IssueAsync(key, [first]);
        Assert.Equal((IssueInvoiceFailure.Unprocessable, "airline_inactive"), (inactive.Failure!.Value, inactive.Reason));
        Assert.Equal(before, await WrittenAsync());
        await setup.Organizations.Where(item => item.Id == organization)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.Status, OrganizationStatus.Active), ct);
        var issued = await IssueAsync(key, [first]);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        Assert.Equal("E310000000001", issued.FiscalNumber);

        // 4-N29: the key with other operations is a conflict, never the earlier invoice; the same body replays it.
        var reused = await IssueAsync(key, [second]);
        Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"), (reused.Failure!.Value, reused.Reason));
        var widened = await IssueAsync(key, [first, second]);
        Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"), (widened.Failure!.Value, widened.Reason));
        var replay = await IssueAsync(key, [first]);
        Assert.True(replay.Replayed);
        Assert.Equal(issued.InvoiceId, replay.InvoiceId);

        // A stale version is refused; the version on screen issues (expand: versions are optional).
        setup.ChangeTracker.Clear();
        var version = Convert.ToBase64String((await setup.GroundOperations.AsNoTracking()
            .SingleAsync(item => item.PublicId == second, ct)).RowVersion);
        var stale = await IssueAsync(Guid.NewGuid(), [second], [new(second, "AAAAAAAAAAE=")]);
        Assert.Equal((IssueInvoiceFailure.Conflict, "version_conflict"), (stale.Failure!.Value, stale.Reason));

        // 4-N07: a valuation of zero is refused after the draft was valued: nothing stays, no e-NCF is used.
        var services = from service in setup.OperationServices
                       join operation in setup.GroundOperations on service.GroundOperationId equals operation.Id
                       where operation.PublicId == second
                       select service;
        await services.ExecuteUpdateAsync(set => set.SetProperty(item => item.UnitPriceSnapshot, 0m), ct);
        before = await WrittenAsync();
        var zero = await IssueAsync(Guid.NewGuid(), [second], [new(second, version)]);
        Assert.Equal((IssueInvoiceFailure.Unprocessable, "zero_total"), (zero.Failure!.Value, zero.Reason));
        Assert.Equal(before, await WrittenAsync());
        await services.ExecuteUpdateAsync(set => set.SetProperty(item => item.UnitPriceSnapshot, 10m), ct);
        var pricedKey = Guid.NewGuid();
        var priced = await IssueAsync(pricedKey, [second], [new(second, version)]);
        Assert.True(priced.IsSuccess, $"{priced.Failure} {priced.Reason}");
        Assert.Equal("E310000000002", priced.FiscalNumber);

        // 4-N29: the versions are part of the body the key stands for: another version, or none, is a conflict; the
        // same body replays the invoice without a second e-NCF.
        var otherVersion = await IssueAsync(pricedKey, [second], [new(second, "AAAAAAAAAAE=")]);
        Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"), (otherVersion.Failure!.Value, otherVersion.Reason));
        var withoutVersions = await IssueAsync(pricedKey, [second]);
        Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"),
            (withoutVersions.Failure!.Value, withoutVersions.Reason));
        var same = await IssueAsync(pricedKey, [second], [new(second, version)]);
        Assert.Equal((true, priced.InvoiceId, "E310000000002"), (same.Replayed, same.InvoiceId, same.FiscalNumber));
        setup.ChangeTracker.Clear();
        Assert.Equal(2, await setup.NonFiscalInvoices.CountAsync(item => item.FiscalNumber != null, ct));

        // An invoice issued before its receipt existed keeps replaying by its account, station and operations.
        await setup.Set<FinancePricingCommand>().Where(item => item.RequestId == key).ExecuteDeleteAsync(ct);
        var legacy = await IssueAsync(key, [first], [new(first, "AAAAAAAAAAE=")]);
        Assert.Equal((true, issued.InvoiceId), (legacy.Replayed, legacy.InvoiceId));
        var legacyOther = await IssueAsync(key, [second]);
        Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"), (legacyOther.Failure!.Value, legacyOther.Reason));
    }

    /// <summary>
    /// 4-N06: the issuance values up to 500 lines: a selection of 120 services (more than a standalone draft's 100) is
    /// invoiced, and more than 500 billable services are refused with too_many_lines before anything is written.
    /// </summary>
    [Fact]
    public async Task InvoiceIssuanceTakesUpToFiveHundredLines()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var large = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct, extraServices: 118);
        await using (var scope = provider.CreateAsyncScope())
        {
            var issued = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [large], Guid.NewGuid()), ct);
            Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        }
        setup.ChangeTracker.Clear();
        Assert.Equal(120, await setup.NonFiscalInvoiceLines.CountAsync(ct));

        var oversized = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct, extraServices: 499);
        var drafts = await setup.Preinvoices.CountAsync(ct);
        await using (var scope = provider.CreateAsyncScope())
        {
            var refused = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [oversized], Guid.NewGuid()), ct);
            Assert.Equal((IssueInvoiceFailure.Unprocessable, "too_many_lines"), (refused.Failure!.Value, refused.Reason));
        }
        Assert.Equal(drafts, await setup.Preinvoices.CountAsync(ct));
    }

    /// <summary>
    /// 4-N10: Finance's day is the business day of Santo Domingo. An invoice issued at 21:30 of 30/11 (01:30 UTC of 1/12)
    /// is due from 30/11, falls in November's revenue, is not overdue that evening and takes a receipt effective that
    /// day; an earlier date is effective_before_invoice and a receipt of 1/12 is still in the future.
    /// </summary>
    [Fact]
    public async Task FinanceDaysAreTheBusinessDayOfSantoDomingo()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        var clock = new MovableTimeProvider(new DateTimeOffset(2026, 12, 1, 1, 30, 0, TimeSpan.Zero));
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var setup = CreateContext(database.ConnectionString);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        await using var scope = provider.CreateAsyncScope();
        var issued = await Handler(scope.ServiceProvider)
            .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        var evening = new DateOnly(2026, 11, 30);
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        Assert.Equal(evening.AddDays(invoice.PaymentTermDays), invoice.DueDate);

        // November's revenue holds the invoice of 30/11 at 21:30.
        var reports = scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceReportStore>();
        var revenue = (await reports.GetAsync(FinanceAccount, "revenue",
            new Elevant.Application.Abstractions.Finance.FinanceReportFilter(new DateOnly(2026, 11, 1), evening, station, null, "USD"), ct))!;
        Assert.Equal("2026-11", Assert.Single(revenue.Rows)[0]);

        // An invoice due today is not overdue until the business day ends.
        await setup.NonFiscalInvoices.Where(item => item.Id == invoice.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.DueDate, evening), ct);
        var ledger = scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceInvoiceLedgerStore>();
        var tonight = (await ledger.GetAsync(FinanceAccount, invoice.PublicId, ct))!.Summary;
        Assert.Equal(("Pending", 0), (tonight.Status, tonight.DaysOverdue));

        // A receipt of 29/11 cannot be applied before the invoice's day; on 30/11 it is.
        var treasury = scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceTreasuryStore>();
        var airline = await (from item in setup.Turnarounds
                             join carrier in setup.Airlines on item.AirlineId equals carrier.Id
                             where item.OperationCode == "DEV-TAT-0001"
                             select carrier.PublicId).SingleAsync(ct);
        var tomorrow = await treasury.RecordAsync(FinanceAccount, new(Guid.NewGuid(), airline, station, "USD", 10m,
            "TRF-RD-FUTURE", "Transfer", evening.AddDays(1), "Cobro de prueba"), ct);
        Assert.Equal(Elevant.Application.Abstractions.Finance.FinanceTreasuryFailure.Invalid, tomorrow.Failure);
        var receipt = await treasury.RecordAsync(FinanceAccount, new(Guid.NewGuid(), airline, station, "USD", 10m,
            "TRF-RD-2911", "Transfer", evening.AddDays(-1), "Cobro de prueba"), ct);
        Assert.True(receipt.IsSuccess, $"{receipt.Failure} {receipt.Code}");
        var early = await treasury.ApplyAsync(FinanceAccount, receipt.Id!.Value, new(Guid.NewGuid(), receipt.Version!,
            evening.AddDays(-1), "Aplicación de prueba", [new(invoice.PublicId, "0", 10m)]), ct);
        Assert.Equal((Elevant.Application.Abstractions.Finance.FinanceTreasuryFailure.Invalid, "effective_before_invoice"),
            (early.Failure!.Value, early.Code));
        var applied = await treasury.ApplyAsync(FinanceAccount, receipt.Id.Value, new(Guid.NewGuid(), receipt.Version!,
            evening, "Aplicación de prueba", [new(invoice.PublicId, "0", 10m)]), ct);
        Assert.True(applied.IsSuccess, $"{applied.Failure} {applied.Code}");

        // At 00:30 of 1/12 in Santo Domingo the invoice is one day overdue.
        clock.Now = new DateTimeOffset(2026, 12, 1, 4, 30, 0, TimeSpan.Zero);
        await using var later = provider.CreateAsyncScope();
        var overdue = (await later.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceInvoiceLedgerStore>()
            .GetAsync(FinanceAccount, invoice.PublicId, ct))!.Summary;
        Assert.Equal(("Overdue", 1), (overdue.Status, overdue.DaysOverdue));
    }

    private static IssueInvoiceHandler Handler(IServiceProvider services) =>
        new(services.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(),
            services.GetRequiredService<IInvoiceIssuanceStore>());

    /// <summary>
    /// Completes the operation's services, records OCC-approved evidence and approves the operation. With
    /// <paramref name="extraServices"/> the operation gets that many more completed services (4-N06).
    /// </summary>
    private static async Task<Guid> ApproveForInvoicingAsync(ElevantDbContext db, string code, CancellationToken ct,
        string? cloneAs = null, long? airlineId = null, int extraServices = 0)
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
        var definition = await db.ServiceDefinitions.SingleAsync(item => item.Code == "BAGGAGE", ct);
        if (extraServices > 0)
        {
            var template = await db.OperationServices.AsNoTracking().Where(item => item.GroundOperationId == op.Id)
                .OrderBy(item => item.LineNumber).FirstAsync(ct);
            var last = await db.OperationServices.Where(item => item.GroundOperationId == op.Id).MaxAsync(item => item.LineNumber, ct);
            var stamp = DateTimeOffset.UtcNow;
            for (var index = 1; index <= extraServices; index++)
                db.OperationServices.Add(new OperationService
                {
                    PublicId = Guid.NewGuid(), GroundOperationId = op.Id, LineNumber = last + index,
                    ServiceDefinitionId = definition.Id, ContractedQuantity = 1, ExecutedQuantity = 0,
                    BillingUnitSnapshot = template.BillingUnitSnapshot, CurrentStatus = ServiceExecutionStatus.Planned,
                    CreatedAt = stamp, UpdatedAt = stamp,
                });
            await db.SaveChangesAsync(ct);
        }
        var services = await db.OperationServices.Where(item => item.GroundOperationId == op.Id).OrderBy(item => item.LineNumber)
            .Take(2 + extraServices).ToArrayAsync(ct);
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
