using System.Diagnostics;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed.History;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// An invoice issued before the history (inserted as dbo, with an e-NCF above the base seed's): the history numbers
    /// its E31 after it, contiguous, like the API.
    /// </summary>
    private static async Task<string> InsertPriorFiscalInvoiceAsync(ElevantDbContext db, CancellationToken ct)
    {
        var highest = await db.NonFiscalInvoices.AsNoTracking().Where(item => item.FiscalNumber != null)
            .Select(item => item.FiscalNumber).MaxAsync(ct);
        var sequence = (FinanceInvoicePolicy.IsFiscalNumber(highest)
            ? long.Parse(highest![3..], CultureInfo.InvariantCulture) : 0) + 500;
        var fiscal = FinanceInvoicePolicy.FormatFiscalNumber(sequence);
        var airline = await db.Airlines.AsNoTracking().Where(item => item.IataCode == "ZZ").Select(item => item.Id).SingleAsync(ct);
        var station = await db.Stations.AsNoTracking().Where(item => item.Code == "PUJ").Select(item => item.Id).SingleAsync(ct);
        var account = await db.Users.AsNoTracking().Where(item => item.PublicId == HistoryAnchors.FinanceAccountId)
            .Select(item => item.Id).SingleAsync(ct);
        var at = new DateTimeOffset(2026, 7, 1, 14, 0, 0, TimeSpan.Zero);
        var request = Guid.Parse("0f000000-0000-7000-8000-00000000e310");
        var draft = new Preinvoice
        {
            PublicId = Guid.Parse("0f000000-0000-7000-8000-00000000e311"), AirlineId = airline, StationId = station,
            CreatedByAccountId = account, RequestId = request, PayloadHash = new string('a', 64),
            From = new DateOnly(2026, 6, 30), To = new DateOnly(2026, 6, 30), CurrencyCode = "USD", Total = 118m,
            Status = PreinvoiceStatus.Invoiced, CreatedAt = at, UpdatedAt = at,
        };
        db.Add(draft);
        await db.SaveChangesAsync(ct);
        var invoiceId = Guid.Parse("0f000000-0000-7000-8000-00000000e312");
        db.Add(new NonFiscalInvoice
        {
            PublicId = invoiceId, PreinvoiceId = draft.Id, AirlineId = airline, StationId = station, IssuedByAccountId = account,
            RequestId = request, Number = $"NF-{invoiceId:N}", CurrencyCode = "USD", Total = 118m, PaymentTermDays = 30,
            DueDate = new DateOnly(2026, 7, 31), NetTotal = 100m, DiscountTotal = 0m, TaxTotal = 18m,
            FiscalNumber = fiscal, FiscalSignedAt = at,
            SecurityCode = FinanceInvoicePolicy.SecurityCode(fiscal, 118m, at, "PRIOR"), CreatedAt = at, UpdatedAt = at,
        });
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
        return fiscal;
    }

    private static int Column(FinanceReportData report, string key)
    {
        var index = report.Columns.Select(column => column.Key).ToList().IndexOf(key);
        Assert.True(index >= 0, $"{report.Key} has no column {key}.");
        return index;
    }

    private static decimal Money(string? value) =>
        string.IsNullOrEmpty(value) ? 0m : decimal.Parse(value, NumberStyles.Number, CultureInfo.InvariantCulture);

    [Fact]
    public async Task DevelopmentHistoryFinanceInvoicesCollectsAndFeedsEveryFinanceReport()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        string prior;
        await using (var dbo = CreateContext(database.ConnectionString)) prior = await InsertPriorFiscalInvoiceAsync(dbo, ct);
        var options = DevelopmentHistoryOptions.Small;
        var financeChunks = FinanceHistory.Chunks(options).Select(chunk => chunk.Name).ToArray();
        Assert.Equal(["finance:2026-11a"], financeChunks);
        Assert.Equal(["finance:2026-06", "finance:2026-07", "finance:2026-08", "finance:2026-09", "finance:2026-10",
            "finance:2026-11a"], FinanceHistory.Chunks(DevelopmentHistoryOptions.Default).Select(chunk => chunk.Name));

        // Interrupted inside finance: the next run resumes from there and the one after writes nothing.
        await Assert.ThrowsAsync<DevelopmentHistoryInterruptedException>(() =>
            SeedHistoryAsSeederAsync(database, options with { FailAfterChunk = financeChunks[^1] }, ct));
        var resumed = await SeedHistoryAsSeederAsync(database, options, ct);
        Assert.DoesNotContain(resumed, name => name.StartsWith(FinanceHistory.ChunkPrefix, StringComparison.Ordinal));
        var complete = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Assert.Empty(await SeedHistoryAsSeederAsync(database, options, ct));
        Assert.Equal(complete, await HistoryTableCountsAsync(database.ConnectionString, ct));

        await using var db = CreateContext(database.ConnectionString);
        var anchors = await HistoryAnchors.LoadAsync(db, ct);
        var catalog = await HistoryCatalog.LoadAsync(db, anchors, ct);
        var clock = new HistoryClock(anchors.Station.IanaTimeZone);
        var airlineIds = catalog.Airlines.Select(airline => airline.Id).ToArray();
        var invoices = await db.NonFiscalInvoices.AsNoTracking()
            .Where(item => airlineIds.Contains(item.AirlineId) && item.IssuedByAccountId == anchors.Finance.Id &&
                item.CreatedAt > new DateTimeOffset(2026, 7, 2, 0, 0, 0, TimeSpan.Zero))
            .OrderBy(item => item.FiscalNumber).ToArrayAsync(ct);
        var history = invoices.Where(item => item.Number != $"NF-{Guid.Parse("0f000000-0000-7000-8000-00000000e312"):N}").ToArray();
        Assert.NotEmpty(history);
        Assert.Contains(history, item => item.AirlineId == catalog.Demo!.Id);

        // E31 contiguous, after the prior invoice, in issue order; the security code recomputes.
        var first = long.Parse(prior[3..], CultureInfo.InvariantCulture) + 1;
        var ordered = history.OrderBy(item => item.CreatedAt).ThenBy(item => item.FiscalNumber).ToArray();
        for (var index = 0; index < ordered.Length; index++)
        {
            var invoice = ordered[index];
            Assert.Equal(FinanceInvoicePolicy.FormatFiscalNumber(first + index), invoice.FiscalNumber);
            var customer = await db.Organizations.AsNoTracking()
                .Where(o => db.Airlines.Any(a => a.Id == invoice.AirlineId && a.OrganizationId == o.Id))
                .Select(o => o.Code).SingleAsync(ct);
            Assert.Equal(FinanceInvoicePolicy.SecurityCode(invoice.FiscalNumber!, invoice.Total, invoice.FiscalSignedAt!.Value,
                customer), invoice.SecurityCode);
            Assert.Equal(invoice.CreatedAt, invoice.FiscalSignedAt);
            Assert.True(clock.IsOperatingTime(invoice.CreatedAt));
            Assert.True(invoice.TaxTreatmentsConfigured);
            Assert.NotNull(invoice.CommercialSnapshotJson);
        }

        // Money: lines sum to the totals, Gross == Amount, Net − Discount + Tax == Amount; each line copied once.
        var invoiceIds = history.Select(item => item.Id).ToArray();
        var lines = await db.NonFiscalInvoiceLines.AsNoTracking().Where(item => invoiceIds.Contains(item.InvoiceId))
            .ToArrayAsync(ct);
        foreach (var invoice in history)
        {
            var own = lines.Where(line => line.InvoiceId == invoice.Id).ToArray();
            Assert.NotEmpty(own);
            Assert.Equal(invoice.Total, own.Sum(line => line.Amount));
            Assert.Equal(invoice.TaxTotal, own.Sum(line => line.TaxAmount));
            Assert.Equal(invoice.NetTotal, own.Sum(line => line.NetAmount));
            Assert.All(own, line =>
            {
                Assert.Equal(line.Amount, line.GrossAmount);
                Assert.Equal(line.Amount, line.NetAmount - line.DiscountAmount + line.TaxAmount);
                Assert.Equal(FinanceInvoicePolicy.Tax(line.NetAmount!.Value), line.TaxAmount);
            });
            var draft = await db.Preinvoices.AsNoTracking().SingleAsync(item => item.Id == invoice.PreinvoiceId, ct);
            Assert.Equal(PreinvoiceStatus.Invoiced, draft.Status);
            Assert.Equal(invoice.Total, draft.Total);
            Assert.Equal(invoice.RequestId, draft.RequestId);
            Assert.Matches("^[0-9A-F]{64}$", draft.PayloadHash);
        }
        Assert.Equal(lines.Length, lines.Select(line => line.PreinvoiceLineId).Distinct().Count());
        var billed = await db.PreinvoiceLines.AsNoTracking()
            .Where(line => line.Kind == PreinvoiceLineKind.Service && line.ReleasedAt == null)
            .Select(line => line.OperationServiceId).ToArrayAsync(ct);
        Assert.Equal(billed.Length, billed.Distinct().Count());
        Assert.Contains(lines, line => line.Kind == PreinvoiceLineKind.Charge && line.ParentLineNumber is not null);

        // The last six days stay in «Por facturar»; nothing operated after the cut was invoiced.
        var through = FinanceHistory.InvoicedThrough(options);
        Assert.All(lines, line => Assert.True(line.OperationDate <= through, line.OperationCode));
        await using var scope = provider.CreateAsyncScope();
        var pending = await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
            new GetFinancePendingOperationsQuery(FinanceAccount, anchors.Station.PublicId, through.AddDays(1),
                options.WindowEnd, null, null, 100), ct);
        Assert.NotNull(pending);
        Assert.NotEmpty(pending.Operations);
        Assert.Contains(pending.Operations, operation => operation.Ready);

        // Collections: receipts never after the window, applications within the balances, two with a remainder in the
        // first finance chunk, a credit note E34 when the mix drew one.
        var cap = clock.ToUtc(options.WindowEnd, HistoryClock.DayEnd);
        var receipts = await db.Set<FinanceTreasuryReceipt>().AsNoTracking().Where(item => airlineIds.Contains(item.AirlineId) &&
            item.CreatedAt > new DateTimeOffset(2026, 7, 2, 0, 0, 0, TimeSpan.Zero)).ToArrayAsync(ct);
        Assert.NotEmpty(receipts);
        Assert.All(receipts, receipt => Assert.True(receipt.CreatedAt <= cap && clock.IsOperatingTime(receipt.CreatedAt)));
        var movements = await db.Set<FinanceTreasuryMovement>().AsNoTracking()
            .Where(item => item.InvoiceId != null && invoiceIds.Contains(item.InvoiceId.Value)).ToArrayAsync(ct);
        var notes = await db.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(item => invoiceIds.Contains(item.InvoiceId))
            .ToArrayAsync(ct);
        foreach (var invoice in history)
        {
            var applied = movements.Where(item => item.InvoiceId == invoice.Id).Sum(item => item.InvoiceAmount);
            var credited = notes.Where(item => item.InvoiceId == invoice.Id).Sum(item => item.Amount);
            Assert.True(applied + credited <= invoice.Total, invoice.FiscalNumber);
            Assert.All(movements.Where(item => item.InvoiceId == invoice.Id), item => Assert.True(item.CreatedAt > invoice.CreatedAt));
        }
        Assert.Equal(history.Length, await db.Set<FinanceTreasuryInvoiceAccount>().CountAsync(item => invoiceIds.Contains(item.InvoiceId), ct));
        // At most two in the first finance chunk (Small pays few invoices in full before the end of the window).
        Assert.InRange(receipts.Count(receipt => receipt.Amount > movements.Where(item => item.ReceiptId == receipt.Id)
            .Sum(item => item.ReceiptAmount)), 1, 2);
        Assert.All(notes, note =>
        {
            Assert.True(FinanceInvoicePolicy.IsFiscalNumber(note.Number, FinanceInvoicePolicy.CreditNoteFiscalPrefix));
            Assert.True(note.EffectiveOn >= Elevant.Application.Common.BusinessCalendar.Today(
                history.Single(item => item.Id == note.InvoiceId).CreatedAt));
        });

        // Every Finance report has rows for the window.
        var reports = scope.ServiceProvider.GetRequiredService<IFinanceReportStore>();
        async Task<FinanceReportData> ReportAsync(string key, string? status = null)
        {
            var report = await reports.GetAsync(FinanceAccount, key,
                new FinanceReportFilter(new DateOnly(2026, 11, 1), options.WindowEnd, null, null, null) { Status = status }, ct);
            Assert.NotNull(report);
            Assert.True(report.Rows.Count > 0, $"{key} has no rows.");
            return report;
        }
        foreach (var key in new[] { "revenue", "receivables", "collections", "payables", "sales", "receipts" })
            await ReportAsync(key);
        // «Recargos» shows NIGHT and OVERTIME too: the extra operations are invoiced by the finance-extra chunks.
        var surcharges = await ReportAsync("charges");
        var concept = Column(surcharges, "concept");
        Assert.Contains(surcharges.Rows, row => row[concept]!.StartsWith(AutomaticSurchargeCodes.Night + " ", StringComparison.Ordinal));
        Assert.Contains(surcharges.Rows, row => row[concept]!.StartsWith(AutomaticSurchargeCodes.Overtime + " ", StringComparison.Ordinal));
        var issued = await ReportAsync("invoices");
        var (fiscal, status, balance) = (Column(issued, "fiscalNumber"), Column(issued, "status"),
            Column(issued, "balance"));
        // Each history invoice shows what its receipts applied and notes credited (Small cannot draw every state; the
        // Default run has paid, partial, overdue and credited invoices).
        foreach (var invoice in history)
        {
            var row = Assert.Single(issued.Rows, item => item[fiscal] == invoice.FiscalNumber);
            var applied = movements.Where(item => item.InvoiceId == invoice.Id).Sum(item => item.InvoiceAmount);
            var credited = notes.Where(item => item.InvoiceId == invoice.Id).Sum(item => item.Amount);
            Assert.Equal(invoice.Total - applied - credited, Money(row[balance]));
            if (invoice.Total - applied - credited == 0) Assert.Equal("Pagada", row[status]);
        }
        Assert.Contains(issued.Rows, row => row[status] == "Pagada");

        // The finance statement and the portal of Demo Airlines (airline.client) read the history.
        var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
        var statement = await treasury.StatementAsync(FinanceAccount, options.WindowEnd, anchors.Station.PublicId, null, ct);
        Assert.NotNull(statement);
        Assert.Contains(statement.Invoices, item => history.Any(invoice => invoice.PublicId == item.Id));
        var portal = await treasury.PortalStatementAsync(AccessPortalAccount, options.WindowEnd, null, ct);
        Assert.Null(portal.Failure);
        Assert.Contains(portal.Data!.Invoices, item => history.Any(invoice => invoice.PublicId == item.Id));
        Assert.NotEmpty(portal.Data.Receipts);

        // Payables: the suppliers of PUJ, registered by the disabled clerk and decided by Finanzas (another person).
        var clerk = await db.Users.AsNoTracking().SingleAsync(user => user.Email == PayablesHistory.ClerkEmail, ct);
        Assert.Equal(AccountLifecycleStatus.Disabled, clerk.Status);
        Assert.Null(clerk.PasswordHash);
        var financePerson = await db.Users.AsNoTracking().Where(user => user.Id == anchors.Finance.Id).Select(user => user.PersonId)
            .SingleAsync(ct);
        Assert.NotEqual(clerk.PersonId, financePerson);
        var suppliers = await db.Set<Supplier>().AsNoTracking().Where(item => item.CreatedByAccountId == clerk.Id).ToArrayAsync(ct);
        Assert.Equal(8, suppliers.Length);
        Assert.All(suppliers, supplier => Assert.Equal(anchors.Station.Id, supplier.ScopeStationId));
        var supplierIds = suppliers.Select(item => item.Id).ToArray();
        var payables = await db.Set<SupplierInvoice>().AsNoTracking().Where(item => supplierIds.Contains(item.SupplierId))
            .ToArrayAsync(ct);
        Assert.NotEmpty(payables);
        Assert.Contains(payables, item => item.Status == SupplierInvoiceStatus.Approved);
        Assert.Equal(payables.Length, payables.Select(item => (item.SupplierId, item.DocumentReference)).Distinct().Count());
        var payableIds = payables.Select(item => item.Id).ToArray();
        var payableLines = await db.Set<SupplierInvoiceLine>().AsNoTracking().Where(item => payableIds.Contains(item.DocumentId))
            .ToArrayAsync(ct);
        var reviews = await db.Set<SupplierInvoiceReview>().AsNoTracking().Where(item => payableIds.Contains(item.DocumentId))
            .ToArrayAsync(ct);
        var applications = await db.Set<FinancePayablesApplication>().AsNoTracking()
            .Where(item => payableIds.Contains(item.SupplierInvoiceId)).ToArrayAsync(ct);
        foreach (var payable in payables)
        {
            Assert.True(payable.DueDate >= payable.DocumentDate);
            Assert.Equal(payable.CurrencyCode == "DOP" ? 1m : payable.FxToDop, payable.FxToDop);
            Assert.Equal(payable.Total, payableLines.Where(line => line.DocumentId == payable.Id).Sum(line => line.Total));
            Assert.All(payableLines.Where(line => line.DocumentId == payable.Id), line =>
                Assert.Equal(FinanceInvoicePolicy.Tax(line.Quantity * line.UnitPrice), line.TaxAmount));
            var own = reviews.Where(review => review.DocumentId == payable.Id).ToArray();
            Assert.Equal(payable.Status == SupplierInvoiceStatus.Draft ? 0 : 1, own.Count(review => review.Stage == "Submission"));
            Assert.All(own, review => Assert.True(review.DecidedAt <= cap && clock.IsOperatingTime(review.DecidedAt)));
            if (payable.Status is SupplierInvoiceStatus.Approved or SupplierInvoiceStatus.Rejected)
                Assert.Equal(anchors.Finance.Id, Assert.Single(own, review => review.Stage == "Finance").ActorAccountId);
            if (payable.Status == SupplierInvoiceStatus.Rejected)
                Assert.True(FinancePayablesPolicy.ValidReason(own.Single(review => review.Stage == "Finance").Reason));
            var paid = applications.Where(item => item.SupplierInvoiceId == payable.Id).ToArray();
            Assert.True(paid.Sum(item => item.InvoiceAmount) <= payable.Total);
            Assert.True(paid.Length == 0 || payable.Status == SupplierInvoiceStatus.Approved);
            Assert.All(paid, item => Assert.Equal(clerk.Id, item.ActorAccountId));
        }
    }

    /// <summary>
    /// Local measurement (not in CI): the chunks up to the first finance month at the Default volume, timing each.
    /// Set <c>ELEVANT_TEST_HISTORY_TIMING=1</c> to run it; the times are written to the test output.
    /// </summary>
    [Fact]
    public async Task DevelopmentHistoryFinanceMonthAtDefaultVolumeTiming()
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
        var output = TestContext.Current.TestOutputHelper;
        foreach (var chunk in HistoryChunkRegistry.Build(options))
        {
            // Operations only for June: the first finance month needs nothing else.
            if (chunk.Name.StartsWith("ops:", StringComparison.Ordinal) && string.CompareOrdinal(chunk.Name, "ops:2026-W27") > 0)
                continue;
            var watch = Stopwatch.StartNew();
            await HistoryChunkRunner.RunAsync(context, chunk, options, ct);
            output?.WriteLine($"{chunk.Name}: {watch.Elapsed.TotalSeconds:0.0} s");
            if (chunk.Name == "finance:2026-06") break;
        }
        output?.WriteLine($"invoices: {await context.NonFiscalInvoices.CountAsync(ct)}, lines: " +
            $"{await context.NonFiscalInvoiceLines.CountAsync(ct)}, receipts: {await context.Set<FinanceTreasuryReceipt>().CountAsync(ct)}");
    }
}
