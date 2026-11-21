using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Documents;

namespace Elevant.Infrastructure.Documents;

/// <summary>The common report engine (ADR-0048): one PDF and one Excel writer for every area.</summary>
public sealed class ReportRenderer : IReportRenderer
{
    private readonly ReportPdfRenderer pdf = new();
    private readonly ReportXlsxRenderer xlsx = new();

    public byte[] RenderPdf(ReportDocument document) => pdf.Render(document);

    public byte[] RenderXlsx(ReportDocument document) => xlsx.Render(document);
}
