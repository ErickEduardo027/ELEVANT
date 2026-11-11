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
    public async Task FinanceReportsReconcileTreasuryLegacyAndPayablesInTheSixReports()
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
        var now = DateTimeOffset.UtcNow;
        var early = now.AddDays(-2);
        var today = Elevant.Application.Common.BusinessCalendar.Today(now);
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
            EffectiveOn = Elevant.Application.Common.BusinessCalendar.Today(at), ReceiptAmount = amount,
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
        await db.SaveChangesAsync(ct);

        var actors = new ReportTestActors(station.PublicId);
        var reports = new EfFinanceReportStore(db, actors, TimeProvider.System);
        var filter = new FinanceReportFilter(firstDay, today, station.PublicId, null, "USD");
        async Task<FinanceReportData> Read(string key, DateOnly? cutoff = null) => (await reports.GetAsync(FinanceAccount, key, filter with { To = cutoff ?? today }, ct))!;
        static string? Cell(FinanceReportData report, string key, int row = 0) => report.Rows[row][report.Columns.ToList().FindIndex(c => c.Key == key)];
        Assert.Equal("570.00", Cell(await Read("receivables"), "balance"));
        Assert.Equal("750.00", Cell(await Read("receivables", today.AddDays(-1)), "balance"));
        // «Cobranza»: cash once at receipt, every method in Spanish, and what the airlines paid by card apart (4-N19).
        var collections = await Read("collections");
        Assert.Equal("1000.00", Assert.Single(collections.Summary, m => m.Label == "Cobrado USD").Value);
        Assert.Equal("0.00", Assert.Single(collections.Summary, m => m.Label == "Cobrado con tarjeta USD").Value);
        Assert.All(collections.Rows, row => Assert.Equal("Transferencia", row[3]));
        Assert.Equal("500.00", Cell(await Read("revenue"), "packages"));
        Assert.Equal("100.00", Cell(await Read("revenue"), "excess"));
        Assert.Equal("100.00", Cell(await Read("revenue"), "minimum"));
        Assert.Null(Cell(await Read("revenue"), "tax")); // unknown legacy tax remains unknown
        Assert.Equal("ITBIS", Assert.Single((await Read("revenue")).Columns, c => c.Key == "tax").Label);
        // «Recargos» reads the issued lines: the excess, the minimum and the legacy adjustment; a package is not one.
        var charges = await Read("charges");
        Assert.Equal(["Ajuste", "Excedente", "Mínimo"], charges.Rows.Select(row => row[0]!).ToArray());
        Assert.Equal(["300.00", "100.00", "100.00"], charges.Rows.Select(row => row[6]!).ToArray());
        Assert.All(charges.Rows, row => Assert.Null(row[5])); // no ITBIS was frozen on a legacy line
        Assert.Equal("500.00", Assert.Single(charges.Summary, m => m.Label == "Recargos USD").Value);
        // «Ventas» is the book of the simulated e-CF: a non-fiscal invoice issued before ADR-0035 is not a sale.
        var sales = await Read("sales");
        Assert.Empty(sales.Rows);
        Assert.Equal("0", Assert.Single(sales.Summary, m => m.Label == "Facturas e-CF").Value);

        var supplier = new Supplier { PublicId = Guid.NewGuid(), ScopeStationId = station.Id, Code = "REPORT-SUPPLIER", Name = "Synthetic supplier", CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        db.Add(supplier); await db.SaveChangesAsync(ct);
        var payable = new SupplierInvoice { PublicId = Guid.NewGuid(), SupplierId = supplier.Id, ScopeStationId = station.Id, DocumentReference = "QA-SUP-REPORT",
            DocumentDate = firstDay, DueDate = firstDay, Status = SupplierInvoiceStatus.Approved, CurrencyCode = "USD", FxToDop = 60, FxSource = "Frozen QA",
            FxDate = firstDay, Total = 1000, TotalDop = 60000, CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        var payablePayment = new FinancePayablesPayment { PublicId = Guid.NewGuid(), SupplierId = supplier.Id, ScopeStationId = station.Id, Reference = "QA-SUP-PAY",
            PaidOn = firstDay, CurrencyCode = "USD", FxToDop = 60, FxSource = "Frozen QA", FxDate = firstDay, Amount = 1500, AmountDop = 90000,
            CreatedByAccountId = user.Id, CreatedAt = early, UpdatedAt = early };
        db.AddRange(payable, payablePayment); await db.SaveChangesAsync(ct);
        db.AddRange(new FinancePayablesApplication { PublicId = Guid.NewGuid(), PaymentId = payablePayment.Id, SupplierInvoiceId = payable.Id, PaymentAmount = 300,
                InvoiceAmount = 300, RateToInvoice = 1, ActorAccountId = user.Id, AppliedAt = now.AddDays(-1) },
            new FinancePayablesApplication { PublicId = Guid.NewGuid(), PaymentId = payablePayment.Id, SupplierInvoiceId = payable.Id, PaymentAmount = 200,
                InvoiceAmount = 200, RateToInvoice = 1, ActorAccountId = user.Id, AppliedAt = now });
        await db.SaveChangesAsync(ct);
        Assert.Equal("500.00", Cell(await Read("payables"), "balance"));
        Assert.Equal("700.00", Cell(await Read("payables", today.AddDays(-1)), "balance"));
        foreach (var key in FinanceReports.All.Select(d => d.Key))
        {
            var report = await Read(key);
            Assert.All(report.Rows, row => Assert.Equal(report.Columns.Count, row.Count));
            Assert.Null(await reports.GetAsync(Guid.NewGuid(), key, filter, ct));
            Assert.Null(await reports.GetAsync(FinanceAccount, key, filter with { StationId = Guid.NewGuid() }, ct));
        }
        // 4-A: the reports of retired modules left with them.
        foreach (var retired in new[] { "pipeline", "disputes", "tariffs", "credit-notes", "debit-notes", "treasury", "suppliers",
                     "expenses", "packages", "fiscal", "fiscal-simulation" })
            Assert.Null(await reports.GetAsync(FinanceAccount, retired, filter, ct));
    }

    private sealed class ReportTestActors(Guid station) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult<ActorContext?>(id != FinanceAccount ? null :
            new(id, "qa@example.invalid", "Synthetic reports", [], [new(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA", OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new(station, "PUJ")], new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance, new HashSet<string>(["finance.reports.read"]))));
    }
}
