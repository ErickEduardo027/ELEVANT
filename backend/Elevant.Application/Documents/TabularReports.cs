using System.Globalization;

namespace Elevant.Application.Documents;

/// <summary>How a tabular report reads the calendar: no period, a range (<c>from</c>–<c>to</c>) or a cut-off (<c>to</c>).</summary>
public enum ReportPeriod
{
    None,
    Range,
    AsOf,
}

/// <summary>
/// What a filter takes: the public id of a station, airline or service from their catalogs, one of fixed options, or a
/// number of days.
/// </summary>
public enum ReportFilterKind
{
    Station,
    Airline,
    Service,
    Select,
    Days,
}

/// <summary>An option of a fixed filter: its code and its Spanish label.</summary>
public sealed record ReportFilterOption(string Code, string Label);

/// <summary>
/// An optional filter of a tabular report (ADR-0048, «Reportes nuevos»): its key, Spanish label, the query parameter
/// it reads and what it takes. A select lists its options; the others take an id or a number.
/// </summary>
public sealed record ReportFilterDefinition(string Key, string Label, string Parameter, ReportFilterKind Kind,
    IReadOnlyList<ReportFilterOption> Options)
{
    public static ReportFilterDefinition Station() => new("station", "Estación", "stationId", ReportFilterKind.Station, []);

    public static ReportFilterDefinition Airline() => new("airline", "Aerolínea", "airlineId", ReportFilterKind.Airline, []);

    public static ReportFilterDefinition Service() => new("service", "Servicio", "serviceId", ReportFilterKind.Service, []);

    public static ReportFilterDefinition Select(string key, string label, string parameter,
        params ReportFilterOption[] options) => new(key, label, parameter, ReportFilterKind.Select, options);

    public static ReportFilterDefinition Days(string key, string label, string parameter) =>
        new(key, label, parameter, ReportFilterKind.Days, []);

    /// <summary>The Spanish label of an option, or the code itself.</summary>
    public string LabelOf(string code) =>
        Options.FirstOrDefault(option => string.Equals(option.Code, code, StringComparison.Ordinal))?.Label ?? code;
}

/// <summary>
/// A report of the tables of Contratos, Gestión Humana and the airline portal (ADR-0048, «Reportes nuevos»): its key,
/// title, description, typed columns, how it reads the calendar and the filters it accepts.
/// </summary>
public sealed record TabularReportDefinition(string Key, string Title, string Description,
    IReadOnlyList<ReportColumn> Columns, ReportPeriod Period, IReadOnlyList<ReportFilterDefinition> Filters)
{
    /// <summary>Longest range a report covers, in days.</summary>
    public int MaxRangeDays { get; init; } = TabularReports.DefaultMaxRangeDays;
}

/// <summary>The period and the filters a report was asked for, already validated against its definition.</summary>
public sealed record TabularReportQuery(DateOnly? From, DateOnly? To, IReadOnlyDictionary<string, string> Values)
{
    public static readonly TabularReportQuery Empty = new(null, null, new Dictionary<string, string>());

    public string? Text(string key) => Values.TryGetValue(key, out var value) ? value : null;

    public Guid? Id(string key) => Values.TryGetValue(key, out var value) && Guid.TryParse(value, out var id) ? id : null;

    public int? Number(string key) =>
        Values.TryGetValue(key, out var value) && int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture,
            out var number) ? number : null;
}

/// <summary>Why a tabular report was refused; the API answers each with its <c>ReportProblems</c> code.</summary>
public enum TabularReportFailure
{
    /// <summary>400 <c>invalid_report_query</c>.</summary>
    InvalidQuery,

    /// <summary>403 without a code: the account may not read (or export) the report.</summary>
    Forbidden,

    /// <summary>404 <c>station_unavailable</c>: the station is outside the account's scope.</summary>
    StationUnavailable,

    /// <summary>404 <c>report_not_found</c>: the session's airline or the resource is not there.</summary>
    NotFound,
}

/// <summary>A report as the common engine prints it, or why it was refused.</summary>
public sealed record TabularReportResult(ReportDocument? Document, TabularReportFailure? Failure)
{
    public static TabularReportResult Of(ReportDocument document) => new(document, null);

    public static TabularReportResult Failed(TabularReportFailure failure) => new(null, failure);
}

/// <summary>
/// A source of tabular reports: who may read and export them, and the complete report for a query. The API pages the
/// rows for the screen and renders every row for an export.
/// </summary>
public interface ITabularReportSource
{
    /// <summary>The reports of the source.</summary>
    IReadOnlyList<TabularReportDefinition> Catalog { get; }

    /// <summary>Whether the account may export (on top of reading); null when it may. Checked before anything is read.</summary>
    Task<TabularReportFailure?> AuthorizeExportAsync(Guid actorId, CancellationToken cancellationToken = default);

    Task<TabularReportResult> ReadAsync(Guid actorId, TabularReportDefinition definition, TabularReportQuery query,
        CancellationToken cancellationToken = default);
}

/// <summary>Validation of the query of a tabular report against its definition.</summary>
public static class TabularReports
{
    public const int DefaultMaxRangeDays = 366;

    /// <summary>The parameters every report accepts besides its own filters.</summary>
    public static readonly IReadOnlySet<string> CommonParameters =
        new HashSet<string>(["from", "to", "page", "limit", "format"], StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The query of a report, or null when it is not valid: a range needs <c>from</c> ≤ <c>to</c> within
    /// <see cref="TabularReportDefinition.MaxRangeDays"/>, a cut-off needs <c>to</c> and no <c>from</c>, and a report
    /// without a period takes neither. A filter of another report, an empty or malformed id, an unknown option or a
    /// number of days outside 1–3650 is refused.
    /// </summary>
    public static TabularReportQuery? Parse(TabularReportDefinition definition, string? from, string? to,
        IEnumerable<KeyValuePair<string, string?>> parameters)
    {
        ArgumentNullException.ThrowIfNull(definition);
        DateOnly? start = null, end = null;
        if (!TryDate(from, out start) || !TryDate(to, out end)) return null;
        switch (definition.Period)
        {
            case ReportPeriod.None when start is not null || end is not null:
                return null;
            case ReportPeriod.AsOf when start is not null || end is null || end == DateOnly.MaxValue:
                return null;
            case ReportPeriod.Range when start is null || end is null || end < start || end == DateOnly.MaxValue ||
                end.Value.DayNumber - start.Value.DayNumber >= definition.MaxRangeDays:
                return null;
        }
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, raw) in parameters)
        {
            if (CommonParameters.Contains(name)) continue;
            var filter = definition.Filters.FirstOrDefault(item =>
                string.Equals(item.Parameter, name, StringComparison.OrdinalIgnoreCase));
            if (filter is null || values.ContainsKey(filter.Key)) return null;
            var value = raw?.Trim() ?? string.Empty;
            var valid = filter.Kind switch
            {
                ReportFilterKind.Station or ReportFilterKind.Airline or ReportFilterKind.Service =>
                    Guid.TryParseExact(value, "D", out var id) && id != Guid.Empty,
                ReportFilterKind.Select => filter.Options.Any(option => string.Equals(option.Code, value, StringComparison.Ordinal)),
                ReportFilterKind.Days => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var days) &&
                    days is >= 1 and <= 3650,
                _ => false,
            };
            if (!valid) return null;
            values[filter.Key] = value;
        }
        return new TabularReportQuery(start, end, values);
    }

    private static bool TryDate(string? text, out DateOnly? date)
    {
        date = null;
        if (text is null) return true;
        if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var value))
            return false;
        date = value;
        return true;
    }

    /// <summary>The definition of a key, or null.</summary>
    public static TabularReportDefinition? Find(this IReadOnlyList<TabularReportDefinition> catalog, string? key) =>
        catalog.FirstOrDefault(item => string.Equals(item.Key, key, StringComparison.Ordinal));

    /// <summary>
    /// «Estación: PUJ · Punta Cana», «Aerolínea: Arajet»… The filters of a query by name, for the document and the screen;
    /// <paramref name="names"/> resolves an id to its readable name.
    /// </summary>
    public static IReadOnlyList<ReportFilter> Applied(TabularReportDefinition definition, TabularReportQuery query,
        Func<ReportFilterDefinition, string, string?> names)
    {
        var filters = new List<ReportFilter>();
        foreach (var filter in definition.Filters)
        {
            if (query.Text(filter.Key) is not { } value) continue;
            var text = filter.Kind switch
            {
                ReportFilterKind.Select => filter.LabelOf(value),
                ReportFilterKind.Days => value == "1" ? "1 día" : $"{value} días",
                _ => names(filter, value) ?? "No encontrado",
            };
            filters.Add(new ReportFilter(filter.Label, text));
        }
        return filters;
    }

    /// <summary>A CSV of the document (UTF-8 with BOM, RFC 4180); a text that starts like a formula is neutralized.</summary>
    public static byte[] Csv(ReportDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var builder = new System.Text.StringBuilder();
        builder.Append(string.Join(',', document.Columns.Select(column => Quote(column.Heading)))).Append("\r\n");
        var decimals = document.Columns.Select((column, index) =>
            ReportFormat.DecimalsOf(column, document.Rows.Select(row => row[index]))).ToArray();
        foreach (var row in document.Rows)
            builder.Append(string.Join(',', row.Select((cell, index) => Quote(Csv(document.Columns[index], cell, decimals[index])))))
                .Append("\r\n");
        var preamble = System.Text.Encoding.UTF8.GetPreamble();
        var body = System.Text.Encoding.UTF8.GetBytes(builder.ToString());
        return [.. preamble, .. body];
    }

    private static string Csv(ReportColumn column, ReportCell cell, int decimals)
    {
        if (cell.Number is { } number)
        {
            var places = column.Type == ReportColumnType.Money ? 2 : Math.Max(0, decimals);
            return decimal.Round(number, places, MidpointRounding.AwayFromZero)
                .ToString("F" + places.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        }
        return ReportFormat.Display(column, cell, decimals);
    }

    private static string Quote(string value)
    {
        var safe = value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' && !decimal.TryParse(value,
            NumberStyles.Number, CultureInfo.InvariantCulture, out _) ? "'" + value : value;
        return safe.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{safe.Replace("\"", "\"\"", StringComparison.Ordinal)}\"" : safe;
    }
}
