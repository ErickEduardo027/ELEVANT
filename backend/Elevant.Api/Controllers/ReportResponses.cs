using System.Globalization;
using Elevant.Application.Documents;
using Elevant.Contracts.Operations;

namespace Elevant.Api.Controllers;

/// <summary>The JSON shapes of the common report engine (ADR-0048) shared by the report controllers.</summary>
internal static class ReportResponses
{
    /// <summary>«text», «number», «money», «percent», «date», «datetime», «time» or «duration».</summary>
    public static string Type(ReportColumnType type) => type.ToString().ToLowerInvariant();

    public static IReadOnlyList<string> Types(IEnumerable<ReportColumn> columns) =>
        columns.Select(column => Type(column.Type)).ToArray();

    public static IReadOnlyList<ReportAppliedFilterResponse> Filters(IEnumerable<ReportFilter> filters) =>
        filters.Select(filter => new ReportAppliedFilterResponse(filter.Label, filter.Value)).ToArray();

    public static IReadOnlyList<ReportMetricResponse> Summary(IEnumerable<ReportMetric> metrics) =>
        metrics.Select(metric => new ReportMetricResponse(metric.Label, metric.Value, metric.Context)).ToArray();

    /// <summary>A totals row with invariant numbers («1234.5»), as the rows carry them.</summary>
    public static IReadOnlyList<OccReportTotalRowResponse> Totals(IEnumerable<ReportTotalRow> totals) =>
        totals.Select(total => new OccReportTotalRowResponse(total.Label, total.Cells.Select(cell => cell switch
        {
            null => new OccReportCellResponse(string.Empty, "text"),
            { Number: { } number } => new OccReportCellResponse(number.ToString(CultureInfo.InvariantCulture), "number"),
            _ => new OccReportCellResponse(cell.Text, "text"),
        }).ToArray())).ToArray();
}
