using System.Text;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

public sealed class FinanceReportCsvTests
{
    [Fact]
    public void CsvQuotesSeparatorsAndNeutralisesFormulas()
    {
        var report = new FinanceReportData("charges", "Cargos", "", new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31), null,
            [], [new("concept", "Concepto", "text"), new("amount", "Importe", "money"), new("reason", "Motivo", "text")],
            [["NIGHT · Recargo, nocturno", "-12.50", "=HYPERLINK(\"x\")"], ["Ajuste", "5.00", null]], []);
        var bytes = FinanceReportCsv.Render(report);
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        var lines = Encoding.UTF8.GetString(bytes[3..]).Split(Environment.NewLine);
        Assert.Equal("Concepto,Importe,Motivo", lines[0]);
        Assert.Equal("\"NIGHT · Recargo, nocturno\",-12.50,\"'=HYPERLINK(\"\"x\"\")\"", lines[1]);
        Assert.Equal("Ajuste,5.00,", lines[2]);
    }
}
