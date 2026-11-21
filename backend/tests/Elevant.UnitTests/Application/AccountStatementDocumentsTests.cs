using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Documents;
using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

/// <summary>The statement of account as a document of the engine (ADR-0048, «Reportes nuevos»).</summary>
public sealed class AccountStatementDocumentsTests
{
    private static readonly Guid Invoice = Guid.NewGuid();
    private static readonly Guid PesoInvoice = Guid.NewGuid();

    private static AccountStatementInput Input() => new("Arajet", "PUJ", new DateOnly(2026, 11, 20),
        [
            new AccountStatementInvoice(Invoice, "NF-1", "E310000000001", "USD", 1000m, 570m, new DateOnly(2026, 10, 1)),
            new AccountStatementInvoice(PesoInvoice, "NF-2", "E310000000002", "DOP", 5900m, 0m, new DateOnly(2026, 10, 14)),
        ],
        [
            new AccountStatementMovement("Invoice", Invoice, "USD", 1000m, new DateOnly(2026, 9, 1), "E310000000001"),
            new AccountStatementMovement("Receipt", null, "USD", 500m, new DateOnly(2026, 9, 10), "TR-1"),
            new AccountStatementMovement("Application", Invoice, "USD", 400m, new DateOnly(2026, 9, 11), "TR-1"),
            new AccountStatementMovement("Credit", Invoice, "USD", 30m, new DateOnly(2026, 9, 12), "E340000000001"),
            new AccountStatementMovement("Refund", null, "USD", 100m, new DateOnly(2026, 9, 13), "DEV-1"),
            new AccountStatementMovement("Invoice", PesoInvoice, "DOP", 5900m, new DateOnly(2026, 9, 14), "E310000000002"),
        ],
        [
            new FinanceTreasuryAgingData("DOP", 5900m, 5900m, 0, 0, 0, 0, 0, 0),
            new FinanceTreasuryAgingData("USD", 570m, 0m, 0m, 570m, 0m, 0m, 0m, 0m),
        ]);

    [Fact]
    public void EveryMovementCarriesTheRunningBalanceOfItsCurrency()
    {
        var document = AccountStatementDocuments.ToDocument(Input());
        document.Validate();
        Assert.Equal(["Factura", "Cobro recibido", "Aplicación a factura", "Nota de crédito", "Devolución", "Factura"],
            document.Rows.Select(row => row[1].Text));
        Assert.Equal([1000m, 500m, 500m, 470m, 570m, 5900m], document.Rows.Select(row => row[8].Number!.Value));
        // The application moves nothing: neither a charge nor a credit.
        Assert.Equal((null, null), (document.Rows[2][6].Number, document.Rows[2][7].Number));
        Assert.Equal("E310000000001", document.Rows[2][3].Text);
        Assert.Equal(new DateTime(2026, 10, 1), document.Rows[0][4].Moment);
    }

    [Fact]
    public void ItIsACutOffDocumentOfTheAirlineWithTheAgingAsSummaryAndTotalsPerCurrency()
    {
        var document = AccountStatementDocuments.ToDocument(Input());
        Assert.True(document.AsOfDate);
        Assert.Equal("Fecha de corte", document.PeriodHeading);
        Assert.Equal("20/11/2026", document.PeriodLabel);
        Assert.Contains(new ReportFilter("Aerolínea", "Arajet"), document.Filters);
        Assert.Equal("PUJ", document.StationLabel);
        Assert.Equal("Simulación — sin validez fiscal", document.Notice);
        var overdue = Assert.Single(document.Summary, metric => metric.Label == "Vencido USD");
        Assert.Equal(("USD 570.00", "100.0 % del saldo por cobrar"), (overdue.Value, overdue.Context));
        Assert.Equal("de 2 facturas emitidas (50.0 %)",
            Assert.Single(document.Summary, metric => metric.Label == "Facturas con saldo").Context);
        var totals = document.EffectiveTotals;
        Assert.Equal(["Total DOP", "Total USD"], totals.Select(total => total.Label));
        Assert.Equal((1100m, 530m), (totals[1].Cells[6]!.Number, totals[1].Cells[7]!.Number));
        Assert.Null(totals[1].Cells[8]); // the running balance is never added up
    }

    [Theory]
    [InlineData(0, 300, 50, 0, "paid")]
    [InlineData(0, 0, 1000, 0, "voided")]
    [InlineData(570, 300, 0, 10, "overdue")]
    [InlineData(570, 0, 0, 0, "pending")]
    public void TheInvoiceStatusFollowsThePortal(decimal balance, decimal paid, decimal credited, int days, string code)
    {
        Assert.Equal(code, InvoiceStatusLabels.Code(balance, paid, credited, days));
        Assert.True(InvoiceStatusLabels.Matches(null, code));
        Assert.Equal(code is "pending" or "overdue", InvoiceStatusLabels.Matches("open", code));
    }
    [Fact]
    public void TheConsolidatedStatementGroupsEveryAirlineWithItsOwnRunningBalance()
    {
        var other = Guid.NewGuid();
        var input = new AccountStatementInput(AccountStatementDocuments.AllAirlines, null, new DateOnly(2026, 11, 20),
            [
                new AccountStatementInvoice(Invoice, "NF-1", "E310000000001", "USD", 1000m, 1000m, new DateOnly(2026, 10, 1)),
                new AccountStatementInvoice(other, "NF-9", "E310000000009", "USD", 200m, 200m, new DateOnly(2026, 10, 2)),
            ],
            [
                new AccountStatementMovement("Invoice", other, "USD", 200m, new DateOnly(2026, 9, 2), "E310000000009") { Airline = "JetBlue" },
                new AccountStatementMovement("Invoice", Invoice, "USD", 1000m, new DateOnly(2026, 9, 1), "E310000000001") { Airline = "Arajet" },
                new AccountStatementMovement("Receipt", null, "USD", 300m, new DateOnly(2026, 9, 5), "TR-1") { Airline = "Arajet" },
            ],
            [new FinanceTreasuryAgingData("USD", 1200m, 0m, 0m, 1200m, 0m, 0m, 0m, 0m)]);
        var document = AccountStatementDocuments.ToConsolidatedDocument(input);
        document.Validate();
        Assert.Equal("Aerolínea", document.Columns[0].Label);
        Assert.Equal([("Arajet", 1000m), ("Arajet", 700m), ("JetBlue", 200m)],
            document.Rows.Select(row => (row[0].Text!, row[9].Number!.Value)));
        Assert.Contains(new ReportFilter("Aerolínea", "Todas las aerolíneas"), document.Filters);
        Assert.Equal(("2", "de 2 facturas emitidas (100.0 %)"),
            (Assert.Single(document.Summary, metric => metric.Label == "Aerolíneas").Value,
                Assert.Single(document.Summary, metric => metric.Label == "Facturas con saldo").Context));
    }
}
