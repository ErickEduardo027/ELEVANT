using System.Text;
using Elevant.Application.Abstractions.Finance;

namespace Elevant.Application.Finance;

/// <summary>RFC 4180 CSV with a UTF-8 BOM so spreadsheets keep accents; values stay invariant.</summary>
public static class FinanceReportCsv
{
    public static byte[] Render(FinanceReportData report)
    {
        ArgumentNullException.ThrowIfNull(report);
        var builder = new StringBuilder();
        builder.AppendLine(string.Join(',', report.Columns.Select(column => Escape(column.Label))));
        foreach (var row in report.Rows)
            builder.AppendLine(string.Join(',', row.Select(Escape)));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(builder.ToString())];
    }

    /// <summary>Quotes when needed and neutralises spreadsheet formulas (=, +, -, @) in text cells.</summary>
    private static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        var text = value[0] is '=' or '+' or '@' || value[0] == '-' && !decimal.TryParse(value,
            System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out _)
            ? "'" + value : value;
        return text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
    }
}
