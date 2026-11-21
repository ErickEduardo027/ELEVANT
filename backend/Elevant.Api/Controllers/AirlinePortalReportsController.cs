using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Contracts.Reports;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// The reports of the airline portal (ADR-0048, «Reportes nuevos»): operations and services, invoices and payments, and
/// the statement of account, always of the session's airline. A station outside its contracts is 404
/// <c>station_unavailable</c> and an account without the portal's role a bare 403. Every export is audited
/// (<c>airline-portal.report.exported</c>).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ReportProblemDetails]
[Route("api/v{version:apiVersion}/airline/portal/reports")]
public sealed class AirlinePortalReportsController(
    IAirlinePortalReportSource source,
    IReportRenderer renderer,
    IReportExportAudit audit,
    IActorContextResolver actors,
    TimeProvider timeProvider) : ControllerBase
{
    private TabularReportEndpoint Endpoint => new(source, renderer, audit, actors, timeProvider, "airline-portal", "portal");

    [HttpGet(Name = "ListAirlinePortalReports")]
    [ProducesResponseType<TabularReportCatalogResponse>(StatusCodes.Status200OK, "application/json")]
    public ActionResult<TabularReportCatalogResponse> List() => Ok(Endpoint.Catalog(AirlinePortalReports.Area));

    /// <summary>A page of a report (<c>limit</c> 1–100) with the totals, summary and filters of every row.</summary>
    [HttpGet("{reportKey}", Name = "GetAirlinePortalReport")]
    [ProducesResponseType<TabularReportPageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public Task<IActionResult> Get(string reportKey, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] Guid? stationId, [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default) =>
        Endpoint.PageAsync(this, reportKey, page, limit, cancellationToken);

    /// <summary>The whole report as PDF (5 000 rows at most), Excel or CSV (25 000).</summary>
    [HttpGet("{reportKey}/export", Name = "ExportAirlinePortalReport")]
    [Produces("application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")]
    public Task<IActionResult> Export(string reportKey, [FromQuery] string format, [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, [FromQuery] Guid? stationId, [FromQuery] string? status,
        CancellationToken cancellationToken = default) =>
        Endpoint.ExportAsync(this, reportKey, format, cancellationToken);
}
