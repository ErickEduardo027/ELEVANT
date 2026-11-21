using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Documents;

namespace Elevant.Application.Finance;

/// <summary>
/// A finance report as the common engine prints it (ADR-0048). The store's invariant cells («1234.50», «2026-11-05»)
/// become typed cells by column; a money column takes its currency from the report's «Moneda» column, so the totals are
/// one row per currency when the rows mix them. Every page carries «Simulación — sin validez fiscal».
/// </summary>
public static class FinanceReportDocuments
{
    public const string Area = "Finanzas";

    public static ReportDocument ToDocument(FinanceReportData report, string? generatedBy, DateTimeOffset generatedAt)
    {
        ArgumentNullException.ThrowIfNull(report);
        if (report.Columns.Count == 0 || report.Rows.Any(row => row.Count != report.Columns.Count))
            throw new ArgumentException("Incomplete report.", nameof(report));
        var currencyColumn = report.Columns.Select((column, index) => (column, index))
            .Where(item => item.column.Key == "currency").Select(item => (int?)item.index).FirstOrDefault();
        var columns = report.Columns.Select(column => Column(column, currencyColumn, report.ConsolidationCurrency)).ToArray();
        var rows = report.Rows.Select(row => (IReadOnlyList<ReportCell>)row.Select((value, index) =>
            columns[index].Type != ReportColumnType.Text ? ReportFormat.Parse(columns[index].Type, value)
            : report.Columns[index].Key == "month" ? ReportCell.Of(Month(value)) : ReportCell.Of(value))
            .ToArray()).ToArray();
        var definition = FinanceReports.All.FirstOrDefault(item => item.Key == report.Key);
        return new ReportDocument(Area, report.Title, columns, rows)
        {
            Description = report.Description,
            From = report.From,
            To = report.To,
            AsOfDate = definition?.AsOfDate ?? false,
            StationScope = report.Filters.FirstOrDefault(filter => filter.Label == "Estación")?.Value ??
                "Todas las estaciones autorizadas",
            Filters = report.Filters.Where(filter => filter.Label != "Estación")
                .Select(filter => new ReportFilter(filter.Label, filter.Value)).ToArray(),
            GeneratedAt = generatedAt,
            GeneratedBy = generatedBy,
            Summary = report.Summary.Select(Metric).ToArray(),
            Notes = report.Notes,
            Notice = FinanceInvoicePolicy.Disclaimer,
        };
    }

    /// <summary>«2026-11» reads «11/2026», as the other dates of the reports.</summary>
    private static string? Month(string? value) =>
        value is { Length: 7 } && value[4] == '-' ? $"{value[5..]}/{value[..4]}" : value;

    /// <summary>A column by its store type; «Total USD» is always in the consolidation currency.</summary>
    private static ReportColumn Column(FinanceReportColumn column, int? currencyColumn, string? consolidation) =>
        column.Type switch
        {
            "money" when column.Key == "usd" => ReportColumn.Money(column.Label, currency: consolidation ?? "USD") with
            {
                Label = column.Label.Replace(" USD", string.Empty, StringComparison.Ordinal),
            },
            "money" when column.Key == "dop" => ReportColumn.Money(column.Label, currency: "DOP") with
            {
                Label = column.Label.Replace(" DOP", string.Empty, StringComparison.Ordinal),
            },
            "money" => currencyColumn is null
                ? new ReportColumn(column.Label, ReportColumnType.Money)
                : ReportColumn.Money(column.Label, currencyColumn),
            "number" => ReportColumn.Number(column.Label, summable: true),
            "percent" => new ReportColumn(column.Label, ReportColumnType.Percent),
            "date" => new ReportColumn(column.Label, ReportColumnType.Date),
            _ => ReportColumn.Text(column.Label),
        };

    /// <summary>«USD 1,234.50», «50.0 %», «12»: a figure as it reads, with its context.</summary>
    private static ReportMetric Metric(FinanceReportMetric metric)
    {
        var parsed = decimal.TryParse(metric.Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var value);
        var text = !parsed ? metric.Value : metric.Type switch
        {
            "money" => ReportFormat.Money(value, metric.CurrencyCode),
            "percent" => ReportFormat.Percent(value),
            _ => ReportFormat.Decimal(value, value == decimal.Truncate(value) ? 0 : 2),
        };
        return new ReportMetric(metric.Label, text, metric.Context);
    }
}
