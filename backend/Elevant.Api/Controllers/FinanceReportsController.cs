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

/// <summary>
/// Server-side finance reports, readable as JSON or exported as CSV, XLSX or PDF (4-A): the six reports of
/// <see cref="FinanceReports.All"/>. Every refusal carries its code: <c>unknown_finance_report</c>,
/// <c>invalid_report_export_format</c>, <c>invalid_report_query</c> or <c>forbidden</c>.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/reports")]
public sealed class FinanceReportsController(
    IFinanceReportStore store,
    IFinancialDocumentPdfRenderer renderer,
    IFinanceReportXlsxRenderer xlsx,
    IActorContextResolver actors,
    IFinanceReportExportAudit audit) : ControllerBase
{
    /// <summary>Longest period a report covers, in days.</summary>
    private const int MaxPeriodDays = 731;

    [HttpGet(Name = "ListFinanceReports")]
    [ProducesResponseType<FinanceReportDefinition[]>(StatusCodes.Status200OK, "application/json")]
    public IActionResult List() => Ok(FinanceReports.All);

    [HttpGet("{reportKey}", Name = "GetFinanceReport")]
    [FinanceQueryProblem(FinanceResults.InvalidReportQueryCode)]
    [ProducesResponseType<FinanceReportData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Get(string reportKey, [FromQuery, BindRequired] DateOnly from,
        [FromQuery, BindRequired] DateOnly to, [FromQuery] Guid? stationId, [FromQuery] Guid? airlineId,
        [FromQuery] string? currency, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return FinanceResults.Unauthorized(this);
        if (FinanceReports.All.All(item => item.Key != reportKey))
            return FinanceResults.Coded(this, StatusCodes.Status400BadRequest, "Unknown finance report.",
                FinanceResults.UnknownReportCode);
        if (!IsValidFilter(from, to, currency)) return InvalidQuery();
        var report = await store.GetAsync(actorId, reportKey, new FinanceReportFilter(from, to, stationId, airlineId, currency),
            cancellationToken);
        return report is null ? FinanceResults.Forbidden(this, "Finance report access is forbidden.") : Ok(report);
    }

    /// <summary>Exports a report as CSV (UTF-8 with BOM), XLSX or PDF; every export is audited.</summary>
    [HttpGet("{reportKey}/export", Name = "ExportFinanceReport")]
    [FinanceQueryProblem(FinanceResults.InvalidReportQueryCode)]
    [Produces("text/csv", "application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "text/csv", "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Export(string reportKey, [FromQuery, BindRequired] string format,
        [FromQuery, BindRequired] DateOnly from, [FromQuery, BindRequired] DateOnly to, [FromQuery] Guid? stationId,
        [FromQuery] Guid? airlineId, [FromQuery] string? currency, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return FinanceResults.Unauthorized(this);
        if (FinanceReports.All.All(item => item.Key != reportKey))
            return FinanceResults.Coded(this, StatusCodes.Status400BadRequest, "Unknown finance report.",
                FinanceResults.UnknownReportCode);
        if (format is not ("csv" or "pdf" or "xlsx"))
            return FinanceResults.Coded(this, StatusCodes.Status400BadRequest, "Unknown export format.",
                FinanceResults.InvalidExportFormatCode);
        if (!IsValidFilter(from, to, currency)) return InvalidQuery();
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.reports.export"))
            return FinanceResults.Forbidden(this, "Finance report export is forbidden.");
        var filter = new FinanceReportFilter(from, to, stationId, airlineId, currency);
        var report = await store.GetAsync(actorId, reportKey, filter, cancellationToken);
        if (report is null) return FinanceResults.Forbidden(this, "Finance report access is forbidden.");
        await audit.RecordAsync(actorId, reportKey, format, filter, cancellationToken);
        var name = $"elevant-{reportKey}-{from:yyyyMMdd}-{to:yyyyMMdd}";
        var filters = $"Período {from:yyyy-MM-dd} a {to:yyyy-MM-dd}" +
            (currency is null ? string.Empty : $" · Moneda {currency}") +
            (stationId is null ? " · Todas las estaciones autorizadas" : " · Estación filtrada") +
            (airlineId is null ? string.Empty : " · Aerolínea filtrada");
        if (format == "xlsx") return File(xlsx.Render(report, filters), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{name}.xlsx");
        return format == "csv"
            ? File(FinanceReportCsv.Render(report), "text/csv; charset=utf-8", $"{name}.csv")
            : File(renderer.RenderReport(report, filters), "application/pdf", $"{name}.pdf");
    }

    /// <summary>An ordered period of at most two years and, when given, a currency Finance invoices in.</summary>
    private static bool IsValidFilter(DateOnly from, DateOnly to, string? currency) =>
        to != DateOnly.MaxValue && to >= from && to.DayNumber - from.DayNumber <= MaxPeriodDays &&
        currency is null or "USD" or "DOP";

    private ObjectResult InvalidQuery() => FinanceResults.Coded(this, StatusCodes.Status400BadRequest,
        "The report query is invalid.", FinanceResults.InvalidReportQueryCode);

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
