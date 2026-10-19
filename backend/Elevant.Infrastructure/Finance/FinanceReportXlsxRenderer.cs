using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Abstractions.Finance;

namespace Elevant.Infrastructure.Finance;

public sealed class FinanceReportXlsxRenderer : IFinanceReportXlsxRenderer
{
    public byte[] Render(FinanceReportData report, string filters)
    {
        ArgumentNullException.ThrowIfNull(report);
        if (report.Columns.Count == 0 || report.Rows.Any(r => r.Count != report.Columns.Count)) throw new ArgumentException("Incomplete report.", nameof(report));
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbook = document.AddWorkbookPart(); workbook.Workbook = new Workbook();
            var worksheet = workbook.AddNewPart<WorksheetPart>(); var data = new SheetData(); worksheet.Worksheet = new Worksheet(data);
            workbook.Workbook.AppendChild(new Sheets()).Append(new Sheet { Id = workbook.GetIdOfPart(worksheet), SheetId = 1, Name = "Finanzas" });
            AppendText(data, ["ELEVANT · " + report.Title]);
            AppendText(data, [filters]);
            AppendText(data, [report.Description]);
            AppendText(data, report.Columns.Select(x => x.Label).ToArray());
            foreach (var values in report.Rows)
            {
                var row = new Row();
                for (var i = 0; i < values.Count; i++)
                {
                    var value = values[i] ?? string.Empty; var type = report.Columns[i].Type;
                    row.Append(type is "money" or "number" or "percent" && decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out _)
                        ? new Cell { DataType = CellValues.Number, CellValue = new CellValue(value) } : TextCell(value));
                }
                data.Append(row);
            }
            foreach (var note in report.Notes) AppendText(data, [note]);
            worksheet.Worksheet.Save(); workbook.Workbook.Save();
        }
        return stream.ToArray();
    }
    private static Cell TextCell(string value) => new() { DataType = CellValues.InlineString, InlineString = new InlineString(new Text(value) { Space = SpaceProcessingModeValues.Preserve }) };
    private static void AppendText(SheetData data, IReadOnlyList<string> values)
    {
        var row = new Row(); foreach (var value in values) row.Append(TextCell(value)); data.Append(row);
    }
}
