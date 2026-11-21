using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Contracts.Reports;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// The Contratos reports (ADR-0048, «Reportes nuevos»): contracts and their validity, agreed rates, commercial requests
/// and airline permits, on screen by pages and exported as PDF, Excel or CSV. <c>contracts.reports.read</c> reads and
/// exports; every export is audited (<c>contracts.report.exported</c>).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ReportProblemDetails]
[Route("api/v{version:apiVersion}/contracts/reports")]
public sealed class ContractsReportsController(
    IContractsReportStore store,
    IReportRenderer renderer,
    IReportExportAudit audit,
    IActorContextResolver actors,
    TimeProvider timeProvider) : ControllerBase
{
    private TabularReportEndpoint Endpoint => new(store, renderer, audit, actors, timeProvider, "contracts", "contratos");

    [HttpGet(Name = "ListContractsReports")]
    [ProducesResponseType<TabularReportCatalogResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<TabularReportCatalogResponse> List() => Ok(Endpoint.Catalog(ContractsReportCatalog.Area));

    /// <summary>A page of a report (<c>limit</c> 1–100) with the totals, summary and filters of every row.</summary>
    [HttpGet("{reportKey}", Name = "GetContractsReport")]
    [ProducesResponseType<TabularReportPageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public Task<IActionResult> Get(string reportKey, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] Guid? airlineId, [FromQuery] Guid? stationId, [FromQuery] Guid? serviceId, [FromQuery] string? status,
        [FromQuery] string? review, [FromQuery] string? validity, [FromQuery] int? expiresWithinDays,
        [FromQuery] int page = 1, [FromQuery] int limit = 50, CancellationToken cancellationToken = default) =>
        Endpoint.PageAsync(this, reportKey, page, limit, cancellationToken);

    /// <summary>The whole report as PDF (5 000 rows at most), Excel or CSV (25 000).</summary>
    [HttpGet("{reportKey}/export", Name = "ExportContractsReport")]
    [Produces("application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")]
    public Task<IActionResult> Export(string reportKey, [FromQuery] string format, [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, [FromQuery] Guid? airlineId, [FromQuery] Guid? stationId, [FromQuery] Guid? serviceId,
        [FromQuery] string? status, [FromQuery] string? review, [FromQuery] string? validity,
        [FromQuery] int? expiresWithinDays, CancellationToken cancellationToken = default) =>
        Endpoint.ExportAsync(this, reportKey, format, cancellationToken);
}
