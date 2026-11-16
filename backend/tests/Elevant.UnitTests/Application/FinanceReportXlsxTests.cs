using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Abstractions.Finance;
using Elevant.Infrastructure.Finance;

namespace Elevant.UnitTests.Application;

public sealed class FinanceReportXlsxTests
{
    [Fact]
    public void ExportsNumbersAsNumbersAndUntrustedTextWithoutFormulaExecution()
    {
        var report = new FinanceReportData("qa", "QA", "Sintético", new(2026,1,1), new(2026,1,2), null, [],
            [new("name", "Cliente", "text"), new("amount", "Importe", "money")],
            [new string?[] { "=HYPERLINK(\"https://example.test\")", "1234.5000" }], []);
        var bytes = new FinanceReportXlsxRenderer().Render(report, "PUJ");
        using var stream = new MemoryStream(bytes); using var book = SpreadsheetDocument.Open(stream, false);
        var cells = book.WorkbookPart!.WorksheetParts.Single().Worksheet.Descendants<Cell>().ToArray();
        Assert.Empty(book.WorkbookPart.WorksheetParts.Single().Worksheet.Descendants<CellFormula>());
        Assert.Contains(cells, c => c.DataType?.Value == CellValues.Number && c.CellValue?.Text == "1234.5000");
        Assert.Contains(cells, c => c.DataType?.Value == CellValues.InlineString && c.InnerText.StartsWith("=HYPERLINK", StringComparison.Ordinal));
    }
}
