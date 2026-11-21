using Elevant.Application.Documents;

namespace Elevant.Application.Abstractions.Documents;

/// <summary>
/// The common report engine (ADR-0048): every area's report exports through it as PDF and Excel, with the same
/// letterhead, filters, «Generado el … por …», totals and summary.
/// </summary>
public interface IReportRenderer
{
    byte[] RenderPdf(ReportDocument document);

    byte[] RenderXlsx(ReportDocument document);
}
