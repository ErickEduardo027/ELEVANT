using Elevant.Contracts.Operations;

namespace Elevant.Contracts.Reports;

/// <summary>An option of a fixed filter: its code and its Spanish label.</summary>
public sealed record TabularReportFilterOptionResponse(string Code, string Label);

/// <summary>
/// A filter a report accepts (ADR-0048, «Reportes nuevos»): its key, label, the query parameter and its kind —
/// <c>station</c>, <c>airline</c> or <c>service</c> (a public id from their catalogs), <c>select</c> (one of
/// <see cref="Options"/>) or <c>days</c> (a whole number of days).
/// </summary>
public sealed record TabularReportFilterResponse(string Key, string Label, string Parameter, string Kind,
    IReadOnlyList<TabularReportFilterOptionResponse> Options);

/// <summary>
/// A report of the catalog: its columns with their types (text, number, money, percent, date, datetime, time,
/// duration), its filters and how it reads the calendar: <c>none</c>, <c>range</c> (<c>from</c>–<c>to</c>) or
/// <c>asOf</c> (only <c>to</c>; the screen hides «Desde»).
/// </summary>
public sealed record TabularReportDefinitionResponse(string Key, string Title, string Description,
    IReadOnlyList<string> Columns, IReadOnlyList<string> ColumnTypes, IReadOnlyList<TabularReportFilterResponse> Filters,
    string Period, int MaxRangeDays);

public sealed record TabularReportCatalogResponse(string Area, IReadOnlyList<TabularReportDefinitionResponse> Reports);

/// <summary>
/// A cell with its invariant value: numbers with a dot («1234.5»), dates <c>yyyy-MM-dd</c>, date and time
/// <c>yyyy-MM-ddTHH:mm</c> (local time) and times <c>HH:mm</c>. <c>type</c> is its column's type, or <c>text</c> for a
/// dash or a name.
/// </summary>
public sealed record TabularReportCellResponse(string Value, string Type);

/// <summary>A totals row of every row of the report: its label and one cell per column (empty where nothing adds up).</summary>
public sealed record TabularReportTotalRowResponse(string Label, IReadOnlyList<TabularReportCellResponse> Cells);

/// <summary>
/// A page of a tabular report. <see cref="TotalRows"/>, <see cref="Totals"/> and <see cref="Summary"/> are of every row,
/// not of the page; <see cref="AppliedFilters"/> name the filters by their readable value and
/// <see cref="GeneratedBy"/> who asked for it.
/// </summary>
public sealed record TabularReportPageResponse(string Key, string Title, string Area, DateOnly? From, DateOnly? To,
    DateTimeOffset AsOf, IReadOnlyList<string> Columns, IReadOnlyList<string> ColumnTypes,
    IReadOnlyList<IReadOnlyList<TabularReportCellResponse>> Rows, int Page, int Limit, bool HasMore, int TotalRows)
{
    public string? Description { get; init; }

    /// <summary>«PUJ · Aeropuerto Internacional de Punta Cana», or «Todas las estaciones autorizadas».</summary>
    public string? Station { get; init; }

    public IReadOnlyList<ReportAppliedFilterResponse> AppliedFilters { get; init; } = [];

    public IReadOnlyList<ReportMetricResponse> Summary { get; init; } = [];

    public IReadOnlyList<TabularReportTotalRowResponse> Totals { get; init; } = [];

    public IReadOnlyList<string> Notes { get; init; } = [];

    public string? GeneratedBy { get; init; }
}
