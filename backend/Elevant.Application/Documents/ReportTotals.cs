namespace Elevant.Application.Documents;

/// <summary>
/// The totals row of a report (ADR-0048): the sum of every <see cref="ReportColumn.Summable"/> money or number column.
/// Money in several currencies is never added together: when a summable money column takes its currency from another
/// column and the rows mix currencies, there is one «Total USD», «Total DOP»… row per currency. A report without
/// summable columns has no totals row.
/// </summary>
public static class ReportTotals
{
    public static IReadOnlyList<ReportTotalRow> Compute(IReadOnlyList<ReportColumn> columns,
        IReadOnlyList<IReadOnlyList<ReportCell>> rows)
    {
        var summable = Enumerable.Range(0, columns.Count)
            .Where(index => columns[index].Summable && columns[index].Type is ReportColumnType.Number or
                ReportColumnType.Money or ReportColumnType.Duration)
            .ToArray();
        if (summable.Length == 0 || rows.Count == 0) return [];
        var currencyColumn = summable.Select(index => columns[index].CurrencyColumn).FirstOrDefault(index => index is not null);
        if (currencyColumn is { } currencyIndex)
        {
            var currencies = rows.Select(row => row[currencyIndex].Text).Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal).ToArray();
            if (currencies.Length > 1)
                return currencies.Select(currency => Row(columns, summable,
                        rows.Where(row => string.Equals(row[currencyIndex].Text, currency, StringComparison.Ordinal)).ToArray(),
                        $"Total {currency}", currencyIndex, currency))
                    .ToArray();
            return [Row(columns, summable, rows, "Total", currencyIndex, currencies.Single())];
        }
        return [Row(columns, summable, rows, "Total", null, null)];
    }

    /// <summary>The column the label goes in: the first that adds nothing and holds no currency.</summary>
    public static int LabelColumn(IReadOnlyList<ReportColumn> columns, int? currencyColumn) =>
        Enumerable.Range(0, columns.Count)
            .FirstOrDefault(index => !columns[index].Summable && index != currencyColumn, -1);

    private static ReportTotalRow Row(IReadOnlyList<ReportColumn> columns, int[] summable,
        IReadOnlyList<IReadOnlyList<ReportCell>> rows, string label, int? currencyColumn, string? currency)
    {
        var cells = new ReportCell?[columns.Count];
        foreach (var index in summable)
            cells[index] = ReportCell.Value(rows.Sum(row => row[index].Number ?? 0m));
        if (currencyColumn is { } currencyIndex && currency is not null) cells[currencyIndex] = new ReportCell(currency);
        var labelColumn = LabelColumn(columns, currencyColumn);
        if (labelColumn >= 0) cells[labelColumn] = new ReportCell(label);
        return new ReportTotalRow(label, cells, currency);
    }
}
