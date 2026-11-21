using System.Text;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;

namespace Elevant.UnitTests.Application;

/// <summary>The query of a tabular report is validated against its definition (ADR-0048, «Reportes nuevos»).</summary>
public sealed class TabularReportsTests
{
    private static readonly TabularReportDefinition Agreements = ContractsReportCatalog.All.Find("agreements")!;
    private static readonly TabularReportDefinition Requests = ContractsReportCatalog.All.Find("requests")!;

    private static KeyValuePair<string, string?>[] Parameters(params (string Name, string Value)[] items) =>
        items.Select(item => new KeyValuePair<string, string?>(item.Name, item.Value)).ToArray();

    [Fact]
    public void AReportWithoutAPeriodTakesItsFiltersAndRefusesDates()
    {
        var airline = Guid.NewGuid().ToString("D");
        var query = TabularReports.Parse(Agreements, null, null,
            Parameters(("airlineId", airline), ("STATUS", "Active"), ("expiresWithinDays", "60"), ("page", "2")));
        Assert.NotNull(query);
        Assert.Equal(airline, query.Text("airline"));
        Assert.Equal("Active", query.Text("status"));
        Assert.Equal(60, query.Number("expiresWithinDays"));
        Assert.Null(TabularReports.Parse(Agreements, "2026-10-01", "2026-10-31", []));
    }

    [Theory]
    [InlineData("status", "active")]
    [InlineData("airlineId", "00000000-0000-0000-0000-000000000000")]
    [InlineData("airlineId", "not-a-guid")]
    [InlineData("expiresWithinDays", "0")]
    [InlineData("expiresWithinDays", "3651")]
    [InlineData("expiresWithinDays", "-5")]
    [InlineData("review", "Verified")]
    public void AnUnknownOptionAnEmptyIdOrAFilterOfAnotherReportIsRefused(string name, string value) =>
        Assert.Null(TabularReports.Parse(Agreements, null, null, Parameters((name, value))));

    [Theory]
    [InlineData(null, "2026-10-31")]
    [InlineData("2026-10-31", "2026-10-01")]
    [InlineData("2025-09-30", "2026-10-01")]
    [InlineData("01/10/2026", "2026-10-31")]
    public void ARangeNeedsBothDatesInOrderWithinAYear(string? from, string to) =>
        Assert.Null(TabularReports.Parse(Requests, from, to, []));

    [Fact]
    public void ARangeOfAYearIsAccepted()
    {
        var query = TabularReports.Parse(Requests, "2025-11-01", "2026-10-31", []);
        Assert.Equal((new DateOnly(2025, 11, 1), new DateOnly(2026, 10, 31)), (query!.From, query.To));
    }

    [Fact]
    public void TheAppliedFiltersNameTheirValues()
    {
        var airline = Guid.NewGuid().ToString("D");
        var query = TabularReports.Parse(Agreements, null, null,
            Parameters(("airlineId", airline), ("status", "Suspended"), ("expiresWithinDays", "1")))!;
        var applied = TabularReports.Applied(Agreements, query, (_, id) => id == airline ? "Arajet" : null);
        Assert.Equal([new ReportFilter("Aerolínea", "Arajet"), new ReportFilter("Estado", "Suspendido"),
            new ReportFilter("Vence en", "1 día")], applied);
    }

    [Fact]
    public void TheCsvKeepsInvariantFiguresAndNeutralizesFormulas()
    {
        var document = new ReportDocument("Contratos", "Prueba",
            [ReportColumn.Text("Nombre"), ReportColumn.Money("Precio", currency: "USD"), new("Vence", ReportColumnType.Date)],
            [[ReportCell.Of("=HYPERLINK(\"x\")"), ReportCell.Value(1234.5m), ReportCell.Date(new DateOnly(2026, 11, 30))]]);
        var text = Encoding.UTF8.GetString(TabularReports.Csv(document));
        Assert.StartsWith("﻿Nombre,Precio (USD),Vence\r\n", text, StringComparison.Ordinal);
        Assert.Contains("\"'=HYPERLINK(\"\"x\"\")\",1234.50,30/11/2026", text, StringComparison.Ordinal);
    }

    [Fact]
    public void PermitValidityCountsThirtyDaysAhead()
    {
        var today = new DateOnly(2026, 11, 21);
        Assert.Equal("expired", ContractsReportCatalog.ValidityCode(today.AddDays(-1), today));
        Assert.Equal("expiring", ContractsReportCatalog.ValidityCode(today.AddDays(30), today));
        Assert.Equal("current", ContractsReportCatalog.ValidityCode(today.AddDays(31), today));
    }
}
