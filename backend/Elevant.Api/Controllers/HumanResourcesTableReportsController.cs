using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Contracts.Reports;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// The tabular reports of Gestión Humana (ADR-0048, «Reportes nuevos»): «Plantilla de personal» and «Trazabilidad y
/// auditoría», on screen by pages and exported as PDF, Excel or CSV. They read what «Empleados» and «Trazabilidad /
/// Auditoría» show the account, with «Reportes» to read and «Exportar» to export; every export is audited
/// (<c>human-resources.report.exported</c>).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ReportProblemDetails]
[Route("api/v{version:apiVersion}/human-resources/table-reports")]
public sealed class HumanResourcesTableReportsController(
    IHumanResourcesTableReportSource source,
    IReportRenderer renderer,
    IReportExportAudit audit,
    IActorContextResolver actors,
    TimeProvider timeProvider) : ControllerBase
{
    private TabularReportEndpoint Endpoint => new(source, renderer, audit, actors, timeProvider, "human-resources", "gh");

    [HttpGet(Name = "ListHumanResourcesTableReports")]
    [ProducesResponseType<TabularReportCatalogResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<TabularReportCatalogResponse> List() => Ok(Endpoint.Catalog(HumanResourcesReportCatalog.Area));

    /// <summary>A page of a report (<c>limit</c> 1–100) with the summary and filters of every row.</summary>
    [HttpGet("{reportKey}", Name = "GetHumanResourcesTableReport")]
    [ProducesResponseType<TabularReportPageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public Task<IActionResult> Get(string reportKey, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] string? department, [FromQuery] string? status, [FromQuery] Guid? stationId, [FromQuery] string? account,
        [FromQuery] string? category, [FromQuery] string? action, [FromQuery] int page = 1, [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default) =>
        Endpoint.PageAsync(this, reportKey, page, limit, cancellationToken);

    /// <summary>The whole report as PDF (5 000 rows at most), Excel or CSV (25 000).</summary>
    [HttpGet("{reportKey}/export", Name = "ExportHumanResourcesTableReport")]
    [Produces("application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")]
    public Task<IActionResult> Export(string reportKey, [FromQuery] string format, [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, [FromQuery] string? department, [FromQuery] string? status, [FromQuery] Guid? stationId,
        [FromQuery] string? account, [FromQuery] string? category, [FromQuery] string? action,
        CancellationToken cancellationToken = default) =>
        Endpoint.ExportAsync(this, reportKey, format, cancellationToken);
}
