using Elevant.Application.Documents;

namespace Elevant.Application.Abstractions.Commercial;

/// <summary>
/// The reports of <c>ContractsReportCatalog</c> (ADR-0048, «Reportes nuevos»), read from the database under
/// <c>contracts.reports.read</c> and AVIAM's internal staff.
/// </summary>
public interface IContractsReportStore : ITabularReportSource;
