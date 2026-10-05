using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Infrastructure.Identity;

public sealed class HumanResourcesReportXlsxRenderer : IHumanResourcesReportXlsxRenderer
{
    public byte[] Render(HumanResourcesReportSnapshot snapshot, string stationCode)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (string.IsNullOrWhiteSpace(stationCode) ||
            snapshot.Columns.Count == 0 ||
            snapshot.Rows.Any(row => row.Count != snapshot.Columns.Count))
            throw new ArgumentException("The report snapshot is incomplete.", nameof(snapshot));

        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream,
            SpreadsheetDocumentType.Workbook, true))
        {
            var workbook = document.AddWorkbookPart();
            workbook.Workbook = new Workbook();
            var worksheet = workbook.AddNewPart<WorksheetPart>();
            var data = new SheetData();
            worksheet.Worksheet = new Worksheet(data);
            var sheets = workbook.Workbook.AppendChild(new Sheets());
            sheets.Append(new Sheet
            {
                Id = workbook.GetIdOfPart(worksheet), SheetId = 1U,
                Name = "Reporte",
            });
            Append(data, ["ELEVANT · GESTIÓN HUMANA"]);
            Append(data, [$"Estación: {stationCode}"]);
            Append(data, [$"Periodo: {snapshot.From:yyyy-MM-dd} – {snapshot.To:yyyy-MM-dd}"]);
            Append(data, [$"Generado: {snapshot.AsOf.ToUniversalTime():O}"]);
            Append(data, [$"Filas: {snapshot.RowCount}"]);
            Append(data, snapshot.Columns);
            foreach (var row in snapshot.Rows)
                Append(data, row);
            worksheet.Worksheet.Save();
            workbook.Workbook.Save();
        }
        return stream.ToArray();
    }

    private static void Append(SheetData data, IReadOnlyList<string> values) =>
        Append(data, values.Select(value => new HumanResourcesReportCell(value,
            HumanResourcesReportCellType.Text)).ToArray());

    private static void Append(SheetData data,
        IReadOnlyList<HumanResourcesReportCell> values)
    {
        var row = new Row();
        foreach (var value in values)
        {
            var cell = value.Type == HumanResourcesReportCellType.Number
                ? new Cell { DataType = CellValues.Number, CellValue = new CellValue(value.Value) }
                : new Cell
                {
                    DataType = CellValues.InlineString,
                    InlineString = new InlineString(new Text(value.Value)
                    { Space = SpaceProcessingModeValues.Preserve }),
                };
            row.Append(cell);
        }
        data.Append(row);
    }
}
