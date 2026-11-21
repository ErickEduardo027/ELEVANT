using System.Globalization;

namespace Elevant.Application.Documents;

/// <summary>
/// How the reports write figures and dates (ADR-0048): es-DO with a comma for thousands and a dot for decimals
/// («1,234.50»), dates «dd/MM/yyyy», times in 24 h and percentages with one decimal («7.5 %»). The format is fixed here,
/// never taken from the host's culture.
/// </summary>
public static class ReportFormat
{
    private static readonly NumberFormatInfo Numbers = new()
    {
        NumberDecimalSeparator = ".", NumberGroupSeparator = ",", NumberGroupSizes = [3], NegativeSign = "-",
    };

    public static string Integer(decimal value) => value.ToString("#,##0", Numbers);

    public static string Integer(int value) => value.ToString("#,##0", Numbers);

    public static string Decimal(decimal value, int decimals) =>
        value.ToString(decimals <= 0 ? "#,##0" : "#,##0." + new string('0', decimals), Numbers);

    public static string Money(decimal value) => Decimal(decimal.Round(value, 2, MidpointRounding.AwayFromZero), 2);

    /// <summary>«USD 1,234.50», or the amount alone without a currency.</summary>
    public static string Money(decimal value, string? currency) =>
        string.IsNullOrWhiteSpace(currency) ? Money(value) : $"{currency.Trim()} {Money(value)}";

    /// <summary>A percentage given as «50» for 50 %: «50.0 %».</summary>
    public static string Percent(decimal value) =>
        $"{Decimal(decimal.Round(value, 1, MidpointRounding.AwayFromZero), 1)} %";

    /// <summary>The share of a part in a whole, «7.5 %», or null when the whole is zero.</summary>
    public static string? Share(decimal part, decimal whole) => whole == 0 ? null : Percent(part / whole * 100m);

    /// <summary>«8 de 50» with its share, the context a figure needs (G3).</summary>
    public static string OfTotal(decimal part, decimal whole, string? noun = null)
    {
        var text = $"de {Integer(whole)}{(string.IsNullOrWhiteSpace(noun) ? string.Empty : " " + noun)}";
        return Share(part, whole) is { } share ? $"{text} ({share})" : text;
    }

    public static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    /// <summary>Minutes as «h:mm» («1:05» is an hour and five minutes); negatives keep their sign.</summary>
    public static string Duration(decimal minutes)
    {
        var total = (long)decimal.Round(Math.Abs(minutes), 0, MidpointRounding.AwayFromZero);
        return $"{(minutes < 0 ? "-" : string.Empty)}{total / 60}:{total % 60:00}";
    }

    /// <summary>The decimals a number column prints: its own, else those of its values, at most two.</summary>
    public static int DecimalsOf(ReportColumn column, IEnumerable<ReportCell> cells) => column.Type switch
    {
        ReportColumnType.Money => 2,
        ReportColumnType.Percent => 1,
        ReportColumnType.Duration => 0,
        _ => column.Decimals ?? Math.Min(2, cells.Select(cell => cell.Number is { } value ? Scale(value) : 0)
            .DefaultIfEmpty(0).Max()),
    };

    /// <summary>How a cell prints in its column; <paramref name="decimals"/> comes from <see cref="DecimalsOf"/>.</summary>
    public static string Display(ReportColumn column, ReportCell cell, int decimals)
    {
        if (cell.Number is { } number)
            return column.Type switch
            {
                ReportColumnType.Money => Money(number),
                ReportColumnType.Percent => Percent(number),
                ReportColumnType.Duration => Duration(number),
                _ => Decimal(decimal.Round(number, decimals, MidpointRounding.AwayFromZero), decimals),
            };
        if (cell.Moment is { } moment)
            return column.Type switch
            {
                ReportColumnType.DateTime => moment.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture),
                ReportColumnType.Time => moment.ToString("HH:mm", CultureInfo.InvariantCulture),
                _ => moment.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
            };
        return cell.Text;
    }

    private static int Scale(decimal value)
    {
        var text = value.ToString("0.############################", CultureInfo.InvariantCulture);
        var dot = text.IndexOf('.', StringComparison.Ordinal);
        return dot < 0 ? 0 : text.Length - dot - 1;
    }

    /// <summary>
    /// A typed cell from an invariant string of the stores: «1234.5» for numbers, «yyyy-MM-dd» or «dd/MM/yyyy» for
    /// dates, «dd/MM/yyyy HH:mm» for date and time, «HH:mm» for times. What does not parse stays as its text («—»).
    /// </summary>
    public static ReportCell Parse(ReportColumnType type, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return ReportCell.Empty;
        var text = value.Trim();
        switch (type)
        {
            case ReportColumnType.Number or ReportColumnType.Money or ReportColumnType.Percent or ReportColumnType.Duration
                when decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var number):
                return ReportCell.Value(number);
            case ReportColumnType.Date when DateOnly.TryParseExact(text, ["yyyy-MM-dd", "dd/MM/yyyy"],
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var date):
                return ReportCell.Date(date);
            case ReportColumnType.DateTime when System.DateTime.TryParseExact(text, ["dd/MM/yyyy HH:mm", "yyyy-MM-dd HH:mm",
                "yyyy-MM-ddTHH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var moment):
                return ReportCell.DateTime(moment);
            case ReportColumnType.Time when TimeOnly.TryParseExact(text, ["HH:mm", "H:mm", "HH:mm:ss"],
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var time):
                return ReportCell.Time(time);
            default:
                return new ReportCell(text);
        }
    }
}
