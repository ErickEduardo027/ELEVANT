using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>Phase 4, block C: the credit and debit notes of an e-CF invoice and what they settle.</summary>
public sealed partial class SqlServerMigrationTests
{
    private const string AdjustmentNoteTaxMigration = "20261109030826_AddAdjustmentNoteTaxAndCharterPrepaymentLink";

    /// <summary>Issues a note of <paramref name="kind"/> with the lines the caller picks from the invoice's limits.</summary>
    private static async Task<FinanceTreasuryResult> IssueNoteAsync(IServiceProvider provider, Guid invoiceId, string kind,
        Func<FinanceTreasuryAdjustmentsData, IReadOnlyList<FinanceTreasuryAdjustmentLineInput>> lines, CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
        var limits = (await treasury.AdjustmentsAsync(FinanceAccount, invoiceId, ct))!;
        return await treasury.IssueAdjustmentAsync(FinanceAccount, invoiceId, new FinanceTreasuryAdjustmentInput(
            Guid.NewGuid(), limits.Version, BusinessCalendar.Today(DateTimeOffset.UtcNow), "Servicio cobrado de más", kind,
            lines(limits)), ct);
    }

    /// <summary>A credit of 1.00 and a tenth of a unit on the first line that still has both.</summary>
    private static IReadOnlyList<FinanceTreasuryAdjustmentLineInput> SmallCredit(FinanceTreasuryAdjustmentsData limits)
    {
        var line = limits.Lines.First(item => item.CreditQuantityRemaining >= 0.1m && item.CreditAmountRemaining >= 1m);
        return [new FinanceTreasuryAdjustmentLineInput(line.InvoiceLineId, 0.1m, 1m)];
    }

    private static async Task<IssueInvoiceResult> IssueOperationAsync(IServiceProvider provider, Guid station, Guid operation,
        CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var issued = await Handler(scope.ServiceProvider)
            .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        return issued;
    }

    /// <summary>
    /// 4-N17: a credit note on an E31 invoice takes the next E34 and a debit note the next E33. Each line freezes the net,
    /// ITBIS and rate of what it adjusts from the invoice line (proportional to cents; the note that exhausts the line
    /// takes its remaining ITBIS exactly). An invoice without e-NCF keeps the internal TC- number. «Ingresos por período»
    /// is net of the notes, and the note's PDF is read by Finance and by the airline in its portal.
    /// </summary>
    [Fact]
    public async Task NotesOfAnEcfInvoiceTakeTheirOwnEcfFreezeTheirItbisAndNetTheRevenue()
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
        var issued = await IssueOperationAsync(provider, station, first, ct);
        Assert.Equal("E310000000001", issued.FiscalNumber);
        var invoiceId = issued.InvoiceId!.Value;
        var invoiceLines = await (from line in setup.NonFiscalInvoiceLines.AsNoTracking()
                                  join invoice in setup.NonFiscalInvoices.AsNoTracking() on line.InvoiceId equals invoice.Id
                                  where invoice.PublicId == invoiceId && line.TaxAmount > 0 && line.ExecutedQuantity > 0
                                  orderby line.LineNumber
                                  select line).ToArrayAsync(ct);
        Assert.True(invoiceLines.Length >= 2, "the invoice has two taxed lines");
        var (credited, debited) = (invoiceLines[0], invoiceLines[1]);
        static decimal Proportional(decimal amount, NonFiscalInvoiceLine line) =>
            decimal.Round(amount * line.TaxAmount!.Value / line.GrossAmount!.Value, 2, MidpointRounding.AwayFromZero);

        // A partial credit of the first line is proportional; the credit of its remainder takes the rest of its ITBIS.
        // A note adjusts a quantity of the line while one remains (FinanceTreasuryRules.CanAdjust).
        var halfQuantity = decimal.Round(credited.ExecutedQuantity / 2m, 4, MidpointRounding.AwayFromZero);
        var half = decimal.Round(credited.Amount / 2m, 2, MidpointRounding.AwayFromZero);
        var firstCredit = await IssueNoteAsync(provider, invoiceId, "Credit",
            _ => [new FinanceTreasuryAdjustmentLineInput(credited.PublicId, halfQuantity, half)], ct);
        Assert.True(firstCredit.IsSuccess, $"{firstCredit.Failure} {firstCredit.Code}");
        var rest = credited.Amount - half;
        var secondCredit = await IssueNoteAsync(provider, invoiceId, "Credit",
            _ => [new FinanceTreasuryAdjustmentLineInput(credited.PublicId, credited.ExecutedQuantity - halfQuantity, rest)], ct);
        Assert.True(secondCredit.IsSuccess, $"{secondCredit.Failure} {secondCredit.Code}");
        var quarter = decimal.Round(debited.Amount / 4m, 2, MidpointRounding.AwayFromZero);
        var debit = await IssueNoteAsync(provider, invoiceId, "Debit",
            _ => [new FinanceTreasuryAdjustmentLineInput(debited.PublicId,
                decimal.Round(debited.ExecutedQuantity / 4m, 4, MidpointRounding.AwayFromZero), quarter)], ct);
        Assert.True(debit.IsSuccess, $"{debit.Failure} {debit.Code}");

        setup.ChangeTracker.Clear();
        async Task<(string Number, FinanceTreasuryAdjustmentLine Line)> NoteAsync(Guid noteId)
        {
            var note = await setup.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().SingleAsync(item => item.PublicId == noteId, ct);
            return (note.Number, await setup.Set<FinanceTreasuryAdjustmentLine>().AsNoTracking()
                .SingleAsync(item => item.NoteId == note.Id, ct));
        }
        var (firstNumber, firstLine) = await NoteAsync(firstCredit.Id!.Value);
        var (secondNumber, secondLine) = await NoteAsync(secondCredit.Id!.Value);
        var (debitNumber, debitLine) = await NoteAsync(debit.Id!.Value);
        Assert.Equal(("E340000000001", "E340000000002", "E330000000001"), (firstNumber, secondNumber, debitNumber));
        var firstTax = Proportional(half, credited);
        Assert.Equal((half - firstTax, firstTax, FinanceInvoicePolicy.ItbisRate),
            (firstLine.NetAmount!.Value, firstLine.TaxAmount!.Value, firstLine.TaxRate!.Value));
        Assert.Equal((rest - (credited.TaxAmount!.Value - firstTax), credited.TaxAmount.Value - firstTax),
            (secondLine.NetAmount!.Value, secondLine.TaxAmount!.Value));
        var debitTax = Proportional(quarter, debited);
        Assert.Equal((quarter - debitTax, debitTax), (debitLine.NetAmount!.Value, debitLine.TaxAmount!.Value));

        // «Ingresos por período» shows the notes and is net of them: total, ITBIS and «Facturado neto».
        await using (var scope = provider.CreateAsyncScope())
        {
            var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
            var revenue = (await scope.ServiceProvider.GetRequiredService<IFinanceReportStore>().GetAsync(FinanceAccount,
                "revenue", new FinanceReportFilter(today.AddDays(-1), today.AddDays(1), station, null, "USD"), ct))!;
            var row = Assert.Single(revenue.Rows);
            string? Cell(string key) => row[revenue.Columns.ToList().FindIndex(column => column.Key == key)];
            var allTax = await (from line in setup.NonFiscalInvoiceLines.AsNoTracking()
                                join invoice in setup.NonFiscalInvoices.AsNoTracking() on line.InvoiceId equals invoice.Id
                                where invoice.PublicId == invoiceId
                                select line.TaxAmount!.Value).SumAsync(ct);
            Assert.Equal(ReportMoney(credited.Amount), Cell("credit_notes"));
            Assert.Equal(ReportMoney(quarter), Cell("debit_notes"));
            var net = issued.Total!.Value - credited.Amount + quarter;
            Assert.Equal(ReportMoney(net), Cell("total"));
            Assert.Equal(ReportMoney(allTax - credited.TaxAmount.Value + debitTax), Cell("tax"));
            Assert.Equal(ReportMoney(net), Assert.Single(revenue.Summary, metric => metric.Label == "Facturado neto USD").Value);
            Assert.Equal(ReportMoney(issued.Total.Value),
                Assert.Single(revenue.Summary, metric => metric.Label == "Facturado USD").Value);
        }

        // The PDF of the note: Finance of the station and the airline in its portal; nobody else.
        await using (var scope = provider.CreateAsyncScope())
        {
            var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
            var document = (await treasury.AdjustmentNoteDocumentAsync(FinanceAccount, firstCredit.Id.Value, ct))!;
            Assert.Equal(("E340000000001", "Credit", "E310000000001", half), (document.Number, document.Kind,
                document.InvoiceFiscalNumber, document.Amount));
            Assert.Equal(firstTax, Assert.Single(document.Lines).TaxAmount);
            Assert.Null(await treasury.AdjustmentNoteDocumentAsync(ContractsAccount, firstCredit.Id.Value, ct));
            var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
            var portal = await treasury.PortalAdjustmentNoteDocumentAsync(airlineAccount, debit.Id.Value, ct);
            Assert.Equal(("E330000000001", "Debit"), (portal.Data!.Number, portal.Data.Kind));
            Assert.Equal(FinanceTreasuryFailure.NotFound,
                (await treasury.PortalAdjustmentNoteDocumentAsync(airlineAccount, Guid.NewGuid(), ct)).Failure);
            // An AVIAM account is not an airline of the portal.
            Assert.False((await treasury.PortalAdjustmentNoteDocumentAsync(FinanceAccount, debit.Id.Value, ct)).IsSuccess);
        }

        // An invoice issued without e-NCF keeps the internal number of its notes.
        var legacy = await IssueOperationAsync(provider, station, second, ct);
        await setup.NonFiscalInvoices.Where(item => item.PublicId == legacy.InvoiceId)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.FiscalNumber, (string?)null)
                .SetProperty(item => item.SecurityCode, (string?)null)
                .SetProperty(item => item.FiscalSignedAt, (DateTimeOffset?)null), ct);
        var legacyCredit = await IssueNoteAsync(provider, legacy.InvoiceId!.Value, "Credit",
            SmallCredit, ct);
        Assert.True(legacyCredit.IsSuccess, $"{legacyCredit.Failure} {legacyCredit.Code}");
        Assert.StartsWith("TC-", (await NoteAsync(legacyCredit.Id!.Value)).Number, StringComparison.Ordinal);
    }

    /// <summary>
    /// 4-N17: two notes issued at the same time on two E31 invoices never share an E34: the sequence is read under
    /// UPDLOCK, HOLDLOCK in the serializable transaction and the unique number is the last guard.
    /// </summary>
    [Fact]
    public async Task TwoNotesIssuedAtOnceNeverShareAnEcf()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var invoices = new List<Guid>();
        foreach (var code in new[] { "DEV-TAT-0001", "DEV-TAT-0002" })
            invoices.Add((await IssueOperationAsync(provider, station, await ApproveForInvoicingAsync(setup, code, ct), ct))
                .InvoiceId!.Value);

        var notes = await Task.WhenAll(invoices.Select(invoice => Task.Run(() => IssueNoteAsync(provider, invoice, "Credit",
            SmallCredit, ct), ct)));
        Assert.All(notes, note => Assert.True(note.IsSuccess, $"{note.Failure} {note.Code}"));
        setup.ChangeTracker.Clear();
        var ids = notes.Select(note => note.Id!.Value).ToArray();
        Assert.Equal(["E340000000001", "E340000000002"], (await setup.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
            .Where(note => ids.Contains(note.PublicId)).Select(note => note.Number).ToArrayAsync(ct)).Order().ToArray());
    }

    /// <summary>
    /// The migration of phase 4, block C round-trips, and its downgrade stops while a note froze an ITBIS (52400) or a
    /// receipt names its charter (52401), instead of dropping that history.
    /// </summary>
    [Fact]
    public async Task AdjustmentNoteTaxMigrationRoundTripsAndKeepsItsHistory()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var context = CreateContext(database.ConnectionString);
        async Task<bool> ColumnAsync(string table, string column) =>
            await context.Database.SqlQuery<int>(
                $"SELECT COUNT(*) AS Value FROM sys.columns WHERE object_id = OBJECT_ID({table}) AND name = {column}")
                .SingleAsync(ct) == 1;
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, AdjustmentNoteTaxMigration) - 1];
        Assert.True(await ColumnAsync("commercial.finance_treasury_adjustment_lines", "tax_amount"));

        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.False(await ColumnAsync("commercial.finance_treasury_adjustment_lines", "net_amount"));
        Assert.False(await ColumnAsync("commercial.finance_treasury_receipts", "charter_agreement_id"));
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.True(await ColumnAsync("commercial.finance_treasury_adjustment_lines", "tax_rate"));
        Assert.True(await ColumnAsync("commercial.finance_treasury_receipts", "charter_agreement_id"));

        // A note that froze its ITBIS is a fiscal snapshot: the downgrade stops.
        var station = await context.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var issued = await IssueOperationAsync(provider, station, await ApproveForInvoicingAsync(context, "DEV-TAT-0001", ct), ct);
        var note = await IssueNoteAsync(provider, issued.InvoiceId!.Value, "Credit",
            SmallCredit, ct);
        Assert.True(note.IsSuccess, $"{note.Failure} {note.Code}");
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52400, failure.Number);
        Assert.True(await ColumnAsync("commercial.finance_treasury_adjustment_lines", "tax_amount"));

        // A receipt of a charter's prepayment is what keeps it from being applied twice: the downgrade stops too.
        await context.Set<FinanceTreasuryAdjustmentLine>().ExecuteUpdateAsync(set => set
            .SetProperty(item => item.NetAmount, (decimal?)null).SetProperty(item => item.TaxAmount, (decimal?)null)
            .SetProperty(item => item.TaxRate, (decimal?)null), ct);
        context.ChangeTracker.Clear();
        var turnaround = await context.Turnarounds.AsNoTracking().SingleAsync(item => item.OperationCode == "DEV-TAT-0002", ct);
        var financeId = await context.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id).SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var agreement = new Elevant.Domain.Entities.Operations.CharterAgreement
        {
            PublicId = Guid.NewGuid(), TurnaroundId = turnaround.Id, AirlineId = turnaround.AirlineId, CurrencyCode = "USD",
            PrepaymentStatus = CharterPrepaymentStatus.Pending, CreatedByAccountId = financeId, CreatedAt = now, UpdatedAt = now,
        };
        context.Add(agreement);
        await context.SaveChangesAsync(ct);
        context.Add(new FinanceTreasuryReceipt
        {
            PublicId = Guid.NewGuid(), AirlineId = turnaround.AirlineId, StationId = turnaround.StationId,
            ActorAccountId = financeId, RequestId = Guid.NewGuid(), Reference = "PREPAGO QA-ROUND", CurrencyCode = "USD",
            Method = PaymentMethod.Transfer, ReceivedOn = BusinessCalendar.Today(now), Amount = 10m,
            Reason = "Prepago del charter confirmado por Finanzas.", CharterAgreementId = agreement.Id, CreatedAt = now,
            UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);
        var charter = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52401, charter.Number);
    }
    /// <summary>
    /// 4-N24: an invoice that nobody paid and that a credit note brought to zero is «Anulada» (Voided) in «Facturas», in
    /// its status filter and in the airline's statement, never «Pagada».
    /// </summary>
    [Fact]
    public async Task AnInvoiceCreditedInFullWithoutAnyPaymentIsVoided()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        IssueInvoiceResult issued;
        await using (var scope = provider.CreateAsyncScope())
            issued = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        var invoiceId = issued.InvoiceId!.Value;
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);

        await using (var scope = provider.CreateAsyncScope())
        {
            var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
            var limits = (await treasury.AdjustmentsAsync(FinanceAccount, invoiceId, ct))!;
            var credit = await treasury.IssueAdjustmentAsync(FinanceAccount, invoiceId, new FinanceTreasuryAdjustmentInput(
                Guid.NewGuid(), limits.Version, today, "Factura emitida por error", "Credit",
                limits.Lines.Select(line => new FinanceTreasuryAdjustmentLineInput(line.InvoiceLineId,
                    line.CreditQuantityRemaining, line.CreditAmountRemaining)).ToArray()), ct);
            Assert.True(credit.IsSuccess, $"{credit.Failure} {credit.Code}");
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var ledger = scope.ServiceProvider.GetRequiredService<IFinanceInvoiceLedgerStore>();
            var summary = (await ledger.GetAsync(FinanceAccount, invoiceId, ct))!.Summary;
            Assert.Equal((FinanceInvoiceStatus.Voided, 0m, 0m), (summary.Status, summary.Balance, summary.Paid));
            Assert.Equal(issued.Total, summary.Credited);
            var voided = (await ledger.ListAsync(FinanceAccount, station, null, FinanceInvoiceStatus.Voided, 1, 25, null, ct))!;
            Assert.Equal(invoiceId, Assert.Single(voided.Invoices).Id);
            Assert.Empty((await ledger.ListAsync(FinanceAccount, station, null, FinanceInvoiceStatus.Paid, 1, 25, null, ct))!
                .Invoices);
            var organization = await (from invoice in setup.NonFiscalInvoices
                                      join airline in setup.Airlines on invoice.AirlineId equals airline.Id
                                      join owner in setup.Organizations on airline.OrganizationId equals owner.Id
                                      where invoice.PublicId == invoiceId
                                      select owner.PublicId).SingleAsync(ct);
            Assert.Equal(FinanceInvoiceStatus.Voided,
                (await ledger.GetStatementForAirlineAsync(organization, invoiceId, ct))!.Status);
        }
    }
}
