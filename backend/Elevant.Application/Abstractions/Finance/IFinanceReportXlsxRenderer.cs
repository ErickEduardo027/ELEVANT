namespace Elevant.Application.Abstractions.Finance;

public interface IFinanceReportXlsxRenderer
{
    byte[] Render(FinanceReportData report, string filters);
}
