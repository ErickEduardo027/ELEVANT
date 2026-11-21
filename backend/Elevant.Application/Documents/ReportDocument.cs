using System.Globalization;

namespace Elevant.Application.Documents;

/// <summary>
/// What a column holds (ADR-0048). The PDF aligns numbers to the right with thousands and the same decimals in the whole
/// column; the Excel writes real numbers, dates and times with their own format so the user can analyse them.
/// </summary>
public enum ReportColumnType
{
    Text,
    Number,
    Money,
    Percent,
    Date,
    DateTime,
    Time,

    /// <summary>Minutes, printed «h:mm» and written to Excel as a time span (<c>[h]:mm</c>).</summary>
    Duration,
}

/// <summary>
/// A column of a <see cref="ReportDocument"/>. <see cref="Summable"/> money and number columns add up in the totals row;
/// a money column names its currency once (<see cref="Currency"/>) or per row (<see cref="CurrencyColumn"/>, the index of
/// the column with the code), and then the totals are one row per currency.
/// </summary>
public sealed record ReportColumn(string Label, ReportColumnType Type = ReportColumnType.Text)
{
    public bool Summable { get; init; }

    public string? Currency { get; init; }

    public int? CurrencyColumn { get; init; }

    /// <summary>Decimals of a number column; null takes those of its values (at most two).</summary>
    public int? Decimals { get; init; }

    public bool IsNumeric => Type is ReportColumnType.Number or ReportColumnType.Money or ReportColumnType.Percent or
        ReportColumnType.Duration;

    /// <summary>The heading as printed: a fixed currency travels in it, «Total (USD)».</summary>
    public string Heading => Currency is { Length: > 0 } code ? $"{Label} ({code})" : Label;

    public static ReportColumn Text(string label) => new(label);

    public static ReportColumn Number(string label, bool summable = false) =>
        new(label, ReportColumnType.Number) { Summable = summable };

    public static ReportColumn Money(string label, int? currencyColumn = null, string? currency = null) =>
        new(label, ReportColumnType.Money) { Summable = true, CurrencyColumn = currencyColumn, Currency = currency };
}

/// <summary>
/// One cell. <see cref="Text"/> is what prints when the cell has no typed value (a dash, a name); a typed cell carries
/// <see cref="Number"/> (numbers, money, percentages as «50» for 50 %, minutes of a duration) or <see cref="Moment"/>
/// (a local date, date and time or time of day), and the renderers format it by its column.
/// </summary>
public sealed record ReportCell(string Text)
{
    public static readonly ReportCell Empty = new("—");

    public decimal? Number { get; init; }

    public DateTime? Moment { get; init; }

    public bool HasValue => Number is not null || Moment is not null;

    public static ReportCell Of(string? text) => string.IsNullOrWhiteSpace(text) ? Empty : new(text.Trim());

    public static ReportCell Value(decimal value) =>
        new(value.ToString(CultureInfo.InvariantCulture)) { Number = value };

    public static ReportCell Value(decimal? value) => value is { } number ? Value(number) : Empty;

    public static ReportCell Date(DateOnly value) =>
        new(value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)) { Moment = value.ToDateTime(TimeOnly.MinValue) };

    public static ReportCell Date(DateOnly? value) => value is { } date ? Date(date) : Empty;

    /// <summary>A local date and time, already in the station's zone.</summary>
    public static ReportCell DateTime(DateTime local) =>
        new(local.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture))
        {
            Moment = System.DateTime.SpecifyKind(local, DateTimeKind.Unspecified),
        };

    public static ReportCell Time(TimeOnly value) =>
        new(value.ToString("HH:mm", CultureInfo.InvariantCulture)) { Moment = new System.DateTime(1899, 12, 30).Add(value.ToTimeSpan()) };

    public static ReportCell Minutes(decimal minutes) => Value(minutes);
}

/// <summary>A filter that produced the report, with its readable value: «Estación: PUJ · Punta Cana», never an id.</summary>
public sealed record ReportFilter(string Label, string Value);

/// <summary>
/// A figure of the summary with its context (G3, no «números fríos»): «Devueltas» «3» «de 40 revisiones (7.5 %)».
/// </summary>
public sealed record ReportMetric(string Label, string Value, string? Context = null);

/// <summary>A totals row: its label («Total», «Total USD») and one cell per column, null where nothing adds up.</summary>
public sealed record ReportTotalRow(string Label, IReadOnlyList<ReportCell?> Cells, string? Currency = null);

/// <summary>
/// The common report every area exports as PDF and Excel (ADR-0048): who and what (area, title, description), where and
/// when (station, period or cut-off date), the filters applied with their names, who generated it and when in the
/// station's local time, typed columns, rows, totals, the summary with context and the notes.
/// </summary>
public sealed record ReportDocument(string Area, string Title, IReadOnlyList<ReportColumn> Columns,
    IReadOnlyList<IReadOnlyList<ReportCell>> Rows)
{
    public string? Description { get; init; }

    public string? StationCode { get; init; }

    public string? StationName { get; init; }

    /// <summary>The station line when the report covers several: «Todas las estaciones autorizadas».</summary>
    public string? StationScope { get; init; }

    public DateOnly? From { get; init; }

    public DateOnly? To { get; init; }

    /// <summary>A report «a una fecha de corte»: it prints «Fecha de corte: dd/MM/yyyy» and the screen hides «Desde».</summary>
    public bool AsOfDate { get; init; }

    public IReadOnlyList<ReportFilter> Filters { get; init; } = [];

    public DateTimeOffset GeneratedAt { get; init; }

    /// <summary>The station's IANA zone for «Generado el …»; null is AVIAM's calendar.</summary>
    public string? TimeZoneId { get; init; }

    public string? GeneratedBy { get; init; }

    public IReadOnlyList<ReportMetric> Summary { get; init; } = [];

    public IReadOnlyList<string> Notes { get; init; } = [];

    /// <summary>A legend every page carries (Finance: «Simulación — sin validez fiscal»).</summary>
    public string? Notice { get; init; }

    /// <summary>
    /// Who the document is for, printed in every footer: «Uso interno» for AVIAM; a document the airline portal hands
    /// to the airline says «Documento para la aerolínea».
    /// </summary>
    public string Audience { get; init; } = "Uso interno";

    /// <summary>Totals computed from the rows (<see cref="ReportTotals"/>); a document may bring its own.</summary>
    public IReadOnlyList<ReportTotalRow>? Totals { get; init; }

    public IReadOnlyList<ReportTotalRow> EffectiveTotals => Totals ?? ReportTotals.Compute(Columns, Rows);

    /// <summary>«PUJ · Aeropuerto Internacional de Punta Cana», the code alone, or the scope of several stations.</summary>
    public string? StationLabel => StationCode is { Length: > 0 } code
        ? StationName is { Length: > 0 } name && !string.Equals(name, code, StringComparison.Ordinal) ? $"{code} · {name}" : code
        : StationScope;

    /// <summary>«01/08/2026 – 31/08/2026», or the date alone under «Fecha de corte».</summary>
    public string? PeriodLabel => (From, To) switch
    {
        (_, { } to) when AsOfDate => ReportFormat.Date(to),
        ({ } from, { } to) when from == to => ReportFormat.Date(to),
        ({ } from, { } to) => $"{ReportFormat.Date(from)} – {ReportFormat.Date(to)}",
        (null, { } to) => ReportFormat.Date(to),
        _ => null,
    };

    public string PeriodHeading => AsOfDate || From is null ? "Fecha de corte" : "Período";

    /// <summary>«Generado el 26/10/2026 08:00 (hora local de la estación) por Ana Pérez».</summary>
    public string GeneratedLabel
    {
        get
        {
            var local = TimeZoneInfo.ConvertTime(GeneratedAt, Common.BusinessCalendar.Zone(TimeZoneId));
            var text = $"Generado el {local.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)} " +
                (StationCode is null ? "(hora local)" : "(hora local de la estación)");
            return string.IsNullOrWhiteSpace(GeneratedBy) ? text : $"{text} por {GeneratedBy.Trim()}";
        }
    }

    public string RowsLabel => Rows.Count == 1 ? "1 fila" : $"{ReportFormat.Integer(Rows.Count)} filas";

    /// <summary>The metadata both formats print first: station, period, filters, generation and rows.</summary>
    public IReadOnlyList<ReportFilter> Metadata
    {
        get
        {
            var items = new List<ReportFilter> { new("Área", Area) };
            if (StationLabel is { } station) items.Add(new("Estación", station));
            if (PeriodLabel is { } period) items.Add(new(PeriodHeading, period));
            items.AddRange(Filters);
            items.Add(new("Generado", GeneratedLabel["Generado ".Length..]));
            items.Add(new("Filas", RowsLabel));
            return items;
        }
    }

    /// <summary>Throws when a row does not have one cell per column.</summary>
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Title) || Columns.Count == 0 || Rows.Any(row => row is null || row.Count != Columns.Count))
            throw new ArgumentException("The report document is incomplete.");
        foreach (var column in Columns)
            if (column.CurrencyColumn is { } index && (index < 0 || index >= Columns.Count))
                throw new ArgumentException("A money column points to a currency column that does not exist.");
    }
}
