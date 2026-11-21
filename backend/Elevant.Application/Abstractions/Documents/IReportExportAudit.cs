using Elevant.Application.Documents;

namespace Elevant.Application.Abstractions.Documents;

/// <summary>
/// Records who exported which tabular report, in which format, with which period, filters (their codes and ids, as
/// asked) and how many rows (ADR-0048, «Reportes nuevos»). The action is <c>{area}.report.exported</c>.
/// </summary>
public interface IReportExportAudit
{
    Task RecordAsync(Guid actorId, string area, string reportKey, string format, TabularReportQuery query, int rows,
        CancellationToken cancellationToken = default);
}
