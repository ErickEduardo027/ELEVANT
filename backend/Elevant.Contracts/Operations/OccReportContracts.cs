namespace Elevant.Contracts.Operations;

/// <summary>An option of a fixed filter (the operation statuses): its code and its Spanish label.</summary>
public sealed record OccReportFilterOptionResponse(string Code, string Label);

/// <summary>
/// An optional filter a report accepts (ADR-0048): <c>airline</c> (<c>airlineId</c>), <c>status</c>, <c>agent</c>
/// (<c>agentId</c>) or <c>terminal</c> (<c>terminalId</c>). Only <c>status</c> lists its options; the others take the
/// public id of an airline, ramp agent or terminal from their own catalogs.
/// </summary>
public sealed record OccReportFilterDefinitionResponse(string Key, string Label, string Parameter,
    IReadOnlyList<OccReportFilterOptionResponse> Options);

public sealed record OccReportDefinitionResponse(string Key, string Title, string Description,
    IReadOnlyList<string> Columns)
{
    /// <summary>One per column: text, number, money, percent, date, datetime, time or duration.</summary>
    public IReadOnlyList<string> ColumnTypes { get; init; } = [];

    public IReadOnlyList<OccReportFilterDefinitionResponse> Filters { get; init; } = [];

    /// <summary>A report «a una fecha de corte»: the screen asks only for the date (<c>to</c>) and hides «Desde».</summary>
    public bool AsOfDate { get; init; }
}

public sealed record OccReportCatalogResponse(IReadOnlyList<OccReportDefinitionResponse> Reports, int MaxRangeDays);

public sealed record OccReportCellResponse(string Value, string Type);

/// <summary>A filter applied to a report, with its readable value («Aerolínea» «Arajet»).</summary>
public sealed record ReportAppliedFilterResponse(string Label, string Value);

/// <summary>A summary figure with its context (no «números fríos»): «Devueltas» «3» «de 40 decisiones (7.5 %)».</summary>
public sealed record ReportMetricResponse(string Label, string Value, string? Context);

/// <summary>A totals row of the whole period: its label and one cell per column (empty where nothing adds up).</summary>
public sealed record OccReportTotalRowResponse(string Label, IReadOnlyList<OccReportCellResponse> Cells);

public sealed record OccReportPageResponse(string Key, string Title, Guid StationId, string StationCode,
    DateOnly From, DateOnly To, DateTimeOffset AsOf, IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyList<OccReportCellResponse>> Rows, int Page, int Limit, bool HasMore)
{
    public string? StationName { get; init; }

    public IReadOnlyList<string> ColumnTypes { get; init; } = [];

    public IReadOnlyList<ReportAppliedFilterResponse> AppliedFilters { get; init; } = [];

    /// <summary>Rows of the whole period, every page.</summary>
    public int TotalRows { get; init; }

    public IReadOnlyList<ReportMetricResponse> Summary { get; init; } = [];

    public IReadOnlyList<OccReportTotalRowResponse> Totals { get; init; } = [];

    public string? GeneratedBy { get; init; }
}
