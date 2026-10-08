using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Server-side finance reports, readable as JSON or exported as CSV or PDF.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/reports")]
public sealed class FinanceReportsController(
    IFinanceReportStore store,
    IFinancialDocumentPdfRenderer renderer,
    IActorContextResolver actors,
    IFinanceReportExportAudit audit) : ControllerBase
{
    [HttpGet(Name = "ListFinanceReports")]
    [ProducesResponseType<FinanceReportDefinition[]>(StatusCodes.Status200OK, "application/json")]
    public IActionResult List() => Ok(FinanceReports.All);

    [HttpGet("{reportKey}", Name = "GetFinanceReport")]
    [ProducesResponseType<FinanceReportData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Get(string reportKey, [FromQuery, BindRequired] DateOnly from,
        [FromQuery, BindRequired] DateOnly to, [FromQuery] Guid? stationId, [FromQuery] Guid? airlineId,
        [FromQuery] string? currency, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        if (FinanceReports.All.All(item => item.Key != reportKey))
            return Problem(statusCode: 400, title: "Unknown finance report.");
        var report = await store.GetAsync(actorId, reportKey, new FinanceReportFilter(from, to, stationId, airlineId, currency),
            cancellationToken);
        return report is null ? Problem(statusCode: 403, title: "Finance report access is forbidden or the filters are invalid.")
            : Ok(report);
    }

    /// <summary>Exports a report as CSV (UTF-8 with BOM) or PDF; every export is audited.</summary>
    [HttpGet("{reportKey}/export", Name = "ExportFinanceReport")]
    [Produces("text/csv", "application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "text/csv", "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Export(string reportKey, [FromQuery, BindRequired] string format,
        [FromQuery, BindRequired] DateOnly from, [FromQuery, BindRequired] DateOnly to, [FromQuery] Guid? stationId,
        [FromQuery] Guid? airlineId, [FromQuery] string? currency, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        if (format is not ("csv" or "pdf") || FinanceReports.All.All(item => item.Key != reportKey))
            return Problem(statusCode: 400, title: "Unknown report or export format.");
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.reports.export"))
            return Problem(statusCode: 403, title: "Finance report export is forbidden.");
        var filter = new FinanceReportFilter(from, to, stationId, airlineId, currency);
        var report = await store.GetAsync(actorId, reportKey, filter, cancellationToken);
        if (report is null) return Problem(statusCode: 403, title: "Finance report access is forbidden or the filters are invalid.");
        await audit.RecordAsync(actorId, reportKey, format, filter, cancellationToken);
        var name = $"elevant-{reportKey}-{from:yyyyMMdd}-{to:yyyyMMdd}";
        var filters = $"Período {from:yyyy-MM-dd} a {to:yyyy-MM-dd}" +
            (currency is null ? string.Empty : $" · Moneda {currency}") +
            (stationId is null ? " · Todas las estaciones autorizadas" : " · Estación filtrada") +
            (airlineId is null ? string.Empty : " · Aerolínea filtrada");
        return format == "csv"
            ? File(FinanceReportCsv.Render(report), "text/csv; charset=utf-8", $"{name}.csv")
            : File(renderer.RenderReport(report, filters), "application/pdf", $"{name}.pdf");
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
