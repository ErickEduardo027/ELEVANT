using System.Text;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

/// <summary>ADR-0048: how each area's report becomes the common <see cref="ReportDocument"/>.</summary>
public sealed class ReportDocumentsTests
{
    private static readonly DateTimeOffset At = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    private static OccReportTable Table(params IReadOnlyList<OccReportCell>[] rows) => new(
        OccReportCatalog.Find("services-by-airline")!, Guid.NewGuid(), "PUJ", new(2026, 8, 1), new(2026, 8, 31),
        At, rows, 1, 5000, false)
    {
        TimeZoneId = "America/Santo_Domingo", GeneratedBy = "Ana Pérez",
        Filters = [new("Aerolínea", "Arajet")],
    };

    private static readonly IReadOnlyList<OccReportCell> Row =
    [
        new("Aerolíneas \"Caribe\", S.A."), new("=HYPERLINK(\"x\")"), new("Operación"),
        OccReportCell.Number(2), OccReportCell.Number(3.5m), OccReportCell.Number(-1),
    ];

    [Fact]
    public void TheOccCsvKeepsItsFormatAndNamesFiltersAndAuthor()
    {
        var bytes = OccReportDocuments.Csv(Table(Row, Row));
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        var text = Encoding.UTF8.GetString(bytes[3..]);
        Assert.Contains("Servicios ejecutados por aerolínea", text);
        Assert.Contains("Período: 01/08/2026 – 31/08/2026", text);
        Assert.Contains("Aerolínea: Arajet", text);
        Assert.Contains("Generado: 26/10/2026 08:00 (hora local) por Ana Pérez", text);
        Assert.Contains("Filas: 2", text);
        Assert.Contains("Aerolínea,Servicio,Unidad,Operaciones,Cantidad contratada,Cantidad ejecutada", text);
        Assert.Contains("\"Aerolíneas \"\"Caribe\"\", S.A.\",\"'=HYPERLINK(\"\"x\"\")\",Operación,2,3.5,-1", text);
        Assert.Throws<ArgumentException>(() => OccReportDocuments.Csv(Table([new OccReportCell("solo una")])));
    }

    [Fact]
    public void AnOccTableBecomesTypedCellsWithItsStationAndAuthor()
    {
        var definition = OccReportCatalog.Find("operations")!;
        IReadOnlyList<OccReportCell> row =
        [
            new("05/08/2026"), new("OP-1"), new("Arajet"), new("HI1000"), new("Aprobada"), new("06:00"), new("07:00"),
            new("—"), new("07:10"), new("Ana Pérez"),
        ];
        var table = new OccReportTable(definition, Guid.NewGuid(), "PUJ", new(2026, 8, 1), new(2026, 8, 31), At, [row], 1, 50,
            false) { StationName = "Punta Cana", GeneratedBy = "Ana Pérez" };
        var document = OccReportDocuments.ToDocument(table);
        Assert.Equal("Centro de Control Operacional", document.Area);
        Assert.Equal("PUJ · Punta Cana", document.StationLabel);
        Assert.Equal(new DateTime(2026, 8, 5), document.Rows[0][0].Moment);
        Assert.Equal(new TimeSpan(6, 0, 0), document.Rows[0][5].Moment!.Value.TimeOfDay);
        Assert.Equal("—", document.Rows[0][7].Text);
        Assert.Null(document.Rows[0][7].Moment);
        Assert.Equal("Generado el 26/10/2026 08:00 (hora local de la estación) por Ana Pérez", document.GeneratedLabel);
    }

    [Fact]
    public void TheOccSummaryGivesContextAndTheProductivityTotalsAddUp()
    {
        IReadOnlyList<IReadOnlyList<OccReportCell>> operations =
        [
            [new("01/08/2026"), new("A"), new("Arajet"), new("—"), new("Aprobada"), new("—"), new("—"), new("—"), new("—"), new("Ana")],
            [new("01/08/2026"), new("B"), new("JetBlue"), new("—"), new("Devuelta"), new("—"), new("—"), new("—"), new("—"), new("Sin asignar")],
        ];
        var summary = OccReportDocuments.Summary(OccReportKind.Operations, operations);
        Assert.Contains(summary, metric => metric.Label == "Aprobadas" && metric.Value == "1" &&
            metric.Context == "de 2 operaciones (50.0 %)");
        Assert.Contains(summary, metric => metric.Label == "Operaciones" && metric.Context == "de 2 aerolíneas");

        var productivity = OccReportCatalog.Find("agent-productivity")!;
        IReadOnlyList<IReadOnlyList<OccReportCell>> agents =
        [
            [new("Ana"), new("E1"), OccReportCell.Number(3), OccReportCell.Number(2), OccReportCell.Number(1), OccReportCell.Number(90)],
            [new("Luis"), new("E2"), OccReportCell.Number(1), OccReportCell.Number(1), OccReportCell.Number(0), OccReportCell.Number(45)],
        ];
        var total = Assert.Single(OccReportDocuments.Totals(productivity, agents));
        Assert.Equal("Total", total.Cells[0]!.Text);
        Assert.Equal(4m, total.Cells[2]!.Number);
        Assert.Equal(135m, total.Cells[5]!.Number);
        Assert.Null(total.Cells[1]);
    }

    [Fact]
    public void OccFiltersAreValidatedAgainstEachReport()
    {
        var operations = OccReportCatalog.Find("operations")!;
        var coverage = OccReportCatalog.Find("coverage-assignments")!;
        Assert.True(OccReportCatalog.ValidFilters(operations, new(Guid.NewGuid(), "Approved", Guid.NewGuid())));
        Assert.False(OccReportCatalog.ValidFilters(operations, new(Status: "approved")));
        Assert.False(OccReportCatalog.ValidFilters(operations, new(TerminalId: Guid.NewGuid())));
        Assert.False(OccReportCatalog.ValidFilters(operations, new(AirlineId: Guid.Empty)));
        Assert.True(OccReportCatalog.ValidFilters(coverage, new(AgentId: Guid.NewGuid(), TerminalId: Guid.NewGuid())));
        Assert.False(OccReportCatalog.ValidFilters(coverage, new(AirlineId: Guid.NewGuid())));
        Assert.Equal(7, OccReportCatalog.All.Count);
        Assert.Equal(11, coverage.Columns.Count);
    }

    [Fact]
    public void TheQualificationCoverageIsACutOffWithShareAndRosterContext()
    {
        var snapshot = new HumanResourcesReportSnapshot(HumanResourcesReportKind.QualificationCoverage, Guid.NewGuid(),
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), At,
            ["Equipo", "Nombre", "Elegibles", "Habilitados", "Sin habilitación vigente", "% habilitados"],
            [
                [Cell("GPU"), Cell("Planta eléctrica"), Number("8"), Number("6"), Number("2"), Number("75")],
                [Cell("BELT"), Cell("Cinta"), Number("4"), Number("4"), Number("0"), Number("100")],
            ]) { StationCode = "PUJ", StationAgents = 50, GeneratedBy = "Ana Pérez" };
        var document = HumanResourcesReportCatalog.ToDocument(snapshot);
        Assert.True(document.AsOfDate);
        Assert.Equal("31/10/2026", document.PeriodLabel);
        Assert.Equal("Fecha de corte", document.PeriodHeading);
        Assert.Equal(ReportColumnType.Percent, document.Columns[5].Type);
        Assert.Contains(document.Summary, metric => metric.Label == "Agentes activos de la estación" && metric.Value == "50");
        Assert.Contains(document.Summary, metric => metric.Label == "Equipos con cobertura completa" &&
            metric.Context == "de 2 equipos (50.0 %)");
        Assert.Contains(document.Summary, metric => metric.Label == "Habilitaciones vigentes" &&
            metric.Context == "de 12 elegibles (83.3 %)");
    }

    [Fact]
    public void ExpirationFiltersPrintInSpanish()
    {
        var snapshot = new HumanResourcesReportSnapshot(HumanResourcesReportKind.Expirations, Guid.NewGuid(),
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), At, ["Agente", "Empleado", "Clase", "Documento", "Vence"],
            [[Cell("Ana"), Cell("E1"), Cell("Permiso"), Cell("Carnet aeroportuario"),
                new HumanResourcesReportCell("20/10/2026", HumanResourcesReportCellType.Date)]])
        {
            StationCode = "PUJ", DocumentKind = "Permit", Validity = "Current",
        };
        var document = HumanResourcesReportCatalog.ToDocument(snapshot);
        Assert.Equal([new ReportFilter("Clase", "Permisos"), new ReportFilter("Vigencia", "Vigentes")], document.Filters);
        Assert.Equal(new DateTime(2026, 10, 20), document.Rows[0][4].Moment);
        Assert.False(document.AsOfDate);
    }

    [Fact]
    public void AFinanceReportNamesItsFiltersCarriesTheSimulationNoticeAndTotalsPerCurrency()
    {
        var report = new FinanceReportData("receivables", "Cuentas por cobrar y antigüedad", "Saldo pendiente.",
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), "USD",
            [new FinanceReportMetric("Cobro sobre facturado USD", "33.3", "percent"),
                new FinanceReportMetric("Por cobrar USD", "1200.5", "money", "USD", "en 2 facturas abiertas")],
            [new("airline", "Aerolínea", "text"), new("currency", "Moneda", "text"), new("balance", "Saldo", "money"),
                new("invoices", "Facturas abiertas", "number")],
            [["Arajet", "USD", "1000.00", "1"], ["JetBlue", "DOP", "200.50", "1"]], ["Nota."])
        {
            Filters = [new("Estación", "PUJ · Punta Cana"), new("Aerolínea", "Todas"), new("Moneda", "Todas")],
        };
        var document = FinanceReportDocuments.ToDocument(report, "Ana Pérez", At);
        Assert.Equal("PUJ · Punta Cana", document.StationLabel);
        Assert.DoesNotContain(document.Filters, filter => filter.Label == "Estación");
        Assert.True(document.AsOfDate);
        Assert.Equal(FinanceInvoicePolicy.Disclaimer, document.Notice);
        Assert.Equal(1, document.Columns[2].CurrencyColumn);
        Assert.Equal("33.3 %", document.Summary[0].Value);
        Assert.Equal("USD 1,200.50", document.Summary[1].Value);
        Assert.Equal("en 2 facturas abiertas", document.Summary[1].Context);
        var totals = document.EffectiveTotals;
        Assert.Equal(["Total DOP", "Total USD"], totals.Select(total => total.Label).ToArray());
        Assert.Equal(1000m, totals[1].Cells[2]!.Number);
        Assert.True(FinanceReports.All.Single(item => item.Key == "payables").AsOfDate);
        Assert.False(FinanceReports.All.Single(item => item.Key == "revenue").AsOfDate);
    }

    [Theory]
    [InlineData(1234567.891, 2, "1,234,567.89")]
    [InlineData(-1500, 0, "-1,500")]
    [InlineData(0.5, 1, "0.5")]
    public void FiguresUseThousandsAndAFixedNumberOfDecimals(double value, int decimals, string expected) =>
        Assert.Equal(expected, ReportFormat.Decimal((decimal)value, decimals));

    [Fact]
    public void FormatsReadAsTheReportPrintsThem()
    {
        Assert.Equal("7.5 %", ReportFormat.Percent(7.46m));
        Assert.Equal("USD 1,234.50", ReportFormat.Money(1234.5m, "USD"));
        Assert.Equal("1:05", ReportFormat.Duration(65));
        Assert.Equal("de 50 facturas (16.0 %)", ReportFormat.OfTotal(8, 50, "facturas"));
        Assert.Equal("de 0", ReportFormat.OfTotal(0, 0));
        var column = ReportColumn.Number("Cantidad");
        Assert.Equal(1, ReportFormat.DecimalsOf(column, [ReportCell.Value(1m), ReportCell.Value(2.5000m)]));
        Assert.Equal(ReportCell.Empty, ReportFormat.Parse(ReportColumnType.Date, " "));
        Assert.Equal("Pendiente", ReportFormat.Parse(ReportColumnType.Date, "Pendiente").Text);
    }

    private static HumanResourcesReportCell Cell(string value) => new(value, HumanResourcesReportCellType.Text);

    private static HumanResourcesReportCell Number(string value) => new(value, HumanResourcesReportCellType.Number);
}
