using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinanceReportsReconcileTreasuryLegacyPayablesPackagesAndSeparateFiscalSimulation()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var db = CreateContext(database.ConnectionString);
        var station = await db.Stations.SingleAsync(s => s.Code == "PUJ", ct);
        var airline = await db.Airlines.FirstAsync(ct);
        var user = await db.Users.SingleAsync(u => u.PublicId == FinanceAccount, ct);
        var employee = await db.Employees.FirstAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var early = now.AddDays(-2);
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var firstDay = today.AddDays(-2);
        var pre = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id, CreatedByAccountId = user.Id,
            RequestId = Guid.NewGuid(), PayloadHash = new string('a', 64), From = firstDay, To = firstDay, CurrencyCode = "USD", Total = 1000m,
            Status = PreinvoiceStatus.Invoiced, CreatedAt = early, UpdatedAt = early };
        db.Add(pre); await db.SaveChangesAsync(ct);
        var invoice = new NonFiscalInvoice { PublicId = Guid.NewGuid(), PreinvoiceId = pre.Id, AirlineId = airline.Id, StationId = station.Id,
            IssuedByAccountId = user.Id, RequestId = Guid.NewGuid(), Number = "NF-" + Guid.NewGuid().ToString("N"), CurrencyCode = "USD", Total = 1000m,
            DueDate = firstDay.AddDays(-31), CreatedAt = early, UpdatedAt = early };
        db.Add(invoice); await db.SaveChangesAsync(ct);
        var invoiceLines = new List<NonFiscalInvoiceLine>();
        foreach (var (kind, amount) in new[] { (PreinvoiceLineKind.Package, 500m), (PreinvoiceLineKind.Excess, 100m), (PreinvoiceLineKind.Minimum, 100m), (PreinvoiceLineKind.Adjustment, 300m) })
        {
            // The reporting fixture seeds issued line kinds independently of the pricing workflow.
            var line = new PreinvoiceLine { PublicId = Guid.NewGuid(), PreinvoiceId = pre.Id, Kind = PreinvoiceLineKind.Adjustment, AdjustmentReason = "Synthetic report source", LineNumber = invoiceLines.Count + 1,
                OperationDate = firstDay, OperationCode = "QA", ServiceCode = "QA", ServiceName = "Frozen QA package", BillingUnit = "unit", ExecutedQuantity = 1,
                CurrencyCode = "USD", UnitPrice = amount, Amount = amount, CreatedAt = early, UpdatedAt = early };
            db.Add(line); await db.SaveChangesAsync(ct);
            var issued = new NonFiscalInvoiceLine { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, PreinvoiceLineId = line.Id, Kind = kind,
                LineNumber = line.LineNumber, OperationDate = firstDay, OperationCode = "QA", ServiceCode = "QA", ServiceName = line.ServiceName,
                BillingUnit = "unit", ExecutedQuantity = 1, CurrencyCode = "USD", UnitPrice = amount, Amount = amount, CreatedAt = early, UpdatedAt = early };
            db.Add(issued); await db.SaveChangesAsync(ct); invoiceLines.Add(issued);
        }
        db.NonFiscalPayments.Add(new NonFiscalPayment { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, RecordedByAccountId = user.Id,
            RequestId = Guid.NewGuid(), Reference = "LEGACY-REPORT", CurrencyCode = "USD", Amount = 100m, PaidOn = firstDay, CreatedAt = early, UpdatedAt = early });
        db.NonFiscalCreditNotes.Add(new NonFiscalCreditNote { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, IssuedByAccountId = user.Id,
            RequestId = Guid.NewGuid(), Number = "NC-" + Guid.NewGuid().ToString("N"), CurrencyCode = "USD", Amount = 50m, Reason = "Legacy", CreatedAt = early, UpdatedAt = early });
        var receipt = new FinanceTreasuryReceipt { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id, ActorAccountId = user.Id,
            RequestId = Guid.NewGuid(), Reference = "RECEIPT-REPORT", CurrencyCode = "USD", Method = PaymentMethod.Transfer, ReceivedOn = firstDay,
            Amount = 1000m, Reason = "QA", CreatedAt = early, UpdatedAt = early };
        var reversedReceipt = new FinanceTreasuryReceipt { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id, ActorAccountId = user.Id,
            RequestId = Guid.NewGuid(), Reference = "REVERSED-REPORT", CurrencyCode = "USD", Method = PaymentMethod.Transfer, ReceivedOn = firstDay,
            Amount = 80m, Reason = "QA", CreatedAt = early, UpdatedAt = early };
        db.AddRange(receipt, reversedReceipt); await db.SaveChangesAsync(ct);
        FinanceTreasuryMovement Movement(FinanceTreasuryMovementKind kind, decimal amount, DateTimeOffset at, long? original = null) => new()
        {
            PublicId = Guid.NewGuid(), ReceiptId = kind == FinanceTreasuryMovementKind.ReceiptReversal ? reversedReceipt.Id : receipt.Id,
            InvoiceId = kind is FinanceTreasuryMovementKind.Application or FinanceTreasuryMovementKind.ApplicationReversal ? invoice.Id : null,
            ReversesMovementId = original, ActorAccountId = user.Id, RequestId = Guid.NewGuid(), Kind = kind,
            EffectiveOn = DateOnly.FromDateTime(at.UtcDateTime), ReceiptAmount = amount,
            InvoiceAmount = kind is FinanceTreasuryMovementKind.Application or FinanceTreasuryMovementKind.ApplicationReversal ? amount : 0m,
            ReceiptCurrency = "USD", InvoiceCurrency = kind is FinanceTreasuryMovementKind.Application or FinanceTreasuryMovementKind.ApplicationReversal ? "USD" : null,
            ExchangeRate = 1m, ExchangeRateOn = firstDay, Reference = "QA-MOVE", Reason = "QA", CreatedAt = at, UpdatedAt = at,
        };
        var original = Movement(FinanceTreasuryMovementKind.Application, 300m, early);
        db.Add(original); await db.SaveChangesAsync(ct);
        db.AddRange(Movement(FinanceTreasuryMovementKind.ApplicationReversal, 300m, now.AddDays(-1), original.Id),
            Movement(FinanceTreasuryMovementKind.Application, 200m, now), Movement(FinanceTreasuryMovementKind.Refund, 100m, now),
            Movement(FinanceTreasuryMovementKind.ReceiptReversal, 80m, now));
        var credit = new FinanceTreasuryAdjustmentNote { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, ActorAccountId = user.Id, RequestId = Guid.NewGuid(),
            Number = "NC-LINE-REPORT", Kind = FinanceTreasuryAdjustmentKind.Credit, EffectiveOn = today.AddDays(-1), CurrencyCode = "USD", Amount = 100m,
            Reason = "Two source lines, one note", CreatedAt = now.AddDays(-1), UpdatedAt = now.AddDays(-1) };
        var debit = new FinanceTreasuryAdjustmentNote { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, ActorAccountId = user.Id, RequestId = Guid.NewGuid(),
            Number = "ND-LINE-REPORT", Kind = FinanceTreasuryAdjustmentKind.Debit, EffectiveOn = today, CurrencyCode = "USD", Amount = 20m,
            Reason = "QA", CreatedAt = now, UpdatedAt = now };
        db.AddRange(credit, debit); await db.SaveChangesAsync(ct);
        db.AddRange(new FinanceTreasuryAdjustmentLine { PublicId = Guid.NewGuid(), NoteId = credit.Id, InvoiceLineId = invoiceLines[0].Id, Quantity = 0.1m, Amount = 60m, CreatedAt = now, UpdatedAt = now },
            new FinanceTreasuryAdjustmentLine { PublicId = Guid.NewGuid(), NoteId = credit.Id, InvoiceLineId = invoiceLines[1].Id, Quantity = 0.1m, Amount = 40m, CreatedAt = now, UpdatedAt = now },
            new FinanceTreasuryAdjustmentLine { PublicId = Guid.NewGuid(), NoteId = debit.Id, InvoiceLineId = invoiceLines[0].Id, Quantity = 0, Amount = 20m, CreatedAt = now, UpdatedAt = now });
        db.Add(FinanceFiscalDocument.Create(invoice.Id, user.Id, Guid.NewGuid(), new string('a', 64), FiscalMode.LocalSimulation,
            "Development", FiscalSimulationOutcome.Accepted, "{}", new string('b', 64), "USD", 1000m, early));
        await db.SaveChangesAsync(ct);

        var actors = new ReportTestActors(station.PublicId);
        var reports = new EfFinanceReportStore(db, actors, TimeProvider.System);
        var filter = new FinanceReportFilter(firstDay, today, station.PublicId, null, "USD");
        async Task<FinanceReportData> Read(string key, DateOnly? cutoff = null) => (await reports.GetAsync(FinanceAccount, key, filter with { To = cutoff ?? today }, ct))!;
        static string Cell(FinanceReportData report, string key, int row = 0) => report.Rows[row][report.Columns.ToList().FindIndex(c => c.Key == key)]!;
        Assert.Equal("570.00", Cell(await Read("receivables"), "balance"));
        Assert.Equal("750.00", Cell(await Read("receivables", today.AddDays(-1)), "balance"));
        Assert.Equal("1000.00", Assert.Single((await Read("collections")).Summary, m => m.Label == "Cobrado USD").Value);
        var treasury = await Read("treasury");
        Assert.Equal("300.00", Assert.Single(treasury.Summary, m => m.Label == "Aplicado neto USD").Value);
        var creditReport = await Read("credit-notes");
        Assert.Equal(2, creditReport.Rows.Count); Assert.Equal("150.00", Assert.Single(creditReport.Summary).Value);
        Assert.Single((await Read("debit-notes")).Rows);
        Assert.Equal(2, (await Read("packages")).Rows.Count);
        Assert.Equal("500.00", Cell(await Read("revenue"), "packages"));
        Assert.Equal("100.00", Cell(await Read("revenue"), "excess"));
        Assert.Equal("100.00", Cell(await Read("revenue"), "minimum"));
        Assert.Null((await Read("revenue")).Rows[0][12]); // unknown legacy tax remains unknown
        Assert.Empty((await Read("fiscal")).Rows); Assert.Single((await Read("fiscal-simulation")).Rows);
        var reconciled = Assert.Single((await new EfFinanceReconciliationReadStore(db, TimeProvider.System).ListAsync(FinanceAccount, station.PublicId, 1, 20, ct))!.Rows);
        Assert.Equal(300m, reconciled.PaymentAmount); // payments + net applications; credits are not payments
        using (var json = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(reconciled,
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))))
            Assert.Equal(new[] { "preinvoiceId", "airlineId", "airlineName", "from", "to", "currencyCode", "preinvoiceTotal", "preinvoiceStatus",
                    "invoiceId", "invoiceNumber", "invoiceTotal", "issuedAt", "paymentId", "paymentReference", "paymentAmount", "paymentRecordedAt" }.Order(),
                json.RootElement.EnumerateObject().Select(p => p.Name).Order());

        var supplier = new Supplier { PublicId = Guid.NewGuid(), ScopeStationId = station.Id, Code = "REPORT-SUPPLIER", Name = "Synthetic supplier", CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        db.Add(supplier); await db.SaveChangesAsync(ct);
        var payable = new SupplierInvoice { PublicId = Guid.NewGuid(), SupplierId = supplier.Id, ScopeStationId = station.Id, DocumentReference = "QA-SUP-REPORT",
            DocumentDate = firstDay, DueDate = firstDay, Status = SupplierInvoiceStatus.Approved, CurrencyCode = "USD", FxToDop = 60, FxSource = "Frozen QA",
            FxDate = firstDay, Total = 1000, TotalDop = 60000, CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        var expense = new EmployeeExpenseClaim { PublicId = Guid.NewGuid(), EmployeeId = employee.Id, Department = employee.Department, Description = "Synthetic ramp travel",
            ExpenseDate = firstDay, ScopeStationId = station.Id, Status = EmployeeExpenseStatus.Approved, CurrencyCode = "USD", FxToDop = 60,
            FxSource = "Frozen QA", FxDate = firstDay, Total = 500, TotalDop = 30000, CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        var payablePayment = new FinancePayablesPayment { PublicId = Guid.NewGuid(), SupplierId = supplier.Id, ScopeStationId = station.Id, Reference = "QA-SUP-PAY",
            PaidOn = firstDay, CurrencyCode = "USD", FxToDop = 60, FxSource = "Frozen QA", FxDate = firstDay, Amount = 1500, AmountDop = 90000,
            CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        db.AddRange(payable, expense, payablePayment); await db.SaveChangesAsync(ct);
        db.AddRange(new FinancePayablesApplication { PublicId = Guid.NewGuid(), PaymentId = payablePayment.Id, SupplierInvoiceId = payable.Id, PaymentAmount = 300,
                InvoiceAmount = 300, RateToInvoice = 1, ActorAccountId = user.Id, AppliedAt = now.AddDays(-1) },
            new FinancePayablesApplication { PublicId = Guid.NewGuid(), PaymentId = payablePayment.Id, SupplierInvoiceId = payable.Id, PaymentAmount = 200,
                InvoiceAmount = 200, RateToInvoice = 1, ActorAccountId = user.Id, AppliedAt = now },
            new EmployeeExpensePayment { PublicId = Guid.NewGuid(), ExpenseClaimId = expense.Id, Reference = "QA-REIMB", PaidOn = today, CurrencyCode = "USD", FxToDop = 60,
                FxSource = "Frozen QA", FxDate = firstDay, Amount = 100, AmountDop = 6000, ExpenseAmount = 100, RateToExpense = 1, ActorAccountId = user.Id, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        Assert.Equal("500.00", Cell(await Read("payables"), "balance"));
        Assert.Equal("700.00", Cell(await Read("payables", today.AddDays(-1)), "balance"));
        Assert.Equal("1000.00", Cell(await Read("suppliers"), "unapplied"));
        Assert.Equal("1200.00", Cell(await Read("suppliers", today.AddDays(-1)), "unapplied"));
        Assert.Equal("400.00", Cell(await Read("expenses"), "balance"));
        Assert.Equal("500.00", Cell(await Read("expenses", today.AddDays(-1)), "balance"));
        foreach (var key in FinanceReports.All.Select(d => d.Key))
        {
            var report = await Read(key);
            Assert.All(report.Rows, row => Assert.Equal(report.Columns.Count, row.Count));
            Assert.Null(await reports.GetAsync(Guid.NewGuid(), key, filter, ct));
            Assert.Null(await reports.GetAsync(FinanceAccount, key, filter with { StationId = Guid.NewGuid() }, ct));
        }
    }

    private sealed class ReportTestActors(Guid station) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult<ActorContext?>(id != FinanceAccount ? null :
            new(id, "qa@example.invalid", "Synthetic reports", [], [new(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA", OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new(station, "PUJ")], new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance, new HashSet<string>(["finance.reports.read"]))));
    }
}
