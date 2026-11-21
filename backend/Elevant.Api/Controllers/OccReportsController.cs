using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Station-scoped OCC reports generated on the server, with CSV, Excel and PDF exports through the common report engine
/// (ADR-0048). An export carries the whole period or nothing (3-N13): over its row limit it answers 422
/// <c>report_too_large</c>, without a file or an audit. The optional filters (<c>airlineId</c>, <c>status</c>,
/// <c>agentId</c>, <c>terminalId</c>) apply where the catalog says; any other is 400 <c>invalid_report_query</c>.
/// Failures carry a stable code (<see cref="ReportProblems"/>); a refused permission stays a bare 403.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ReportProblemDetails]
[Route("api/v{version:apiVersion}/occ/reports")]
public sealed class OccReportsController(IOccReportStore store, IReportRenderer renderer) : ControllerBase
{
    [HttpGet(Name = "ListOccReports")]
    [ProducesResponseType<OccReportCatalogResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    public ActionResult<OccReportCatalogResponse> List()
    {
        if (!TryAccount(out _)) return Unauthorized<OccReportCatalogResponse>();
        return Ok(new OccReportCatalogResponse(OccReportCatalog.All
            .Select(item => new OccReportDefinitionResponse(item.Key, item.Title, item.Description, item.Columns)
            {
                ColumnTypes = ReportResponses.Types(item.Specs),
                Filters = item.Filters.Select(Filter).ToArray(),
                AsOfDate = item.AsOfDate,
            })
            .ToArray(), OccReportCatalog.MaxRangeDays));
    }

    [HttpGet("{key}", Name = "GetOccReport")]
    [ProducesResponseType<OccReportPageResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<OccReportPageResponse>> Get([FromRoute] string key,
        [FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "from"), BindRequired] DateOnly from,
        [FromQuery(Name = "to"), BindRequired] DateOnly to,
        [FromQuery] int page = 1, [FromQuery] int limit = 25,
        [FromQuery] Guid? airlineId = null, [FromQuery] string? status = null, [FromQuery] Guid? agentId = null,
        [FromQuery] Guid? terminalId = null, CancellationToken cancellationToken = default)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccReportPageResponse>();
        var definition = OccReportCatalog.Find(key);
        if (definition is null) return ReportProblems.NotFound(this);
        var filters = new OccReportFilters(airlineId, status, agentId, terminalId);
        if (stationId == Guid.Empty || !OccReportCatalog.ValidRange(from, to) || page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue || !OccReportCatalog.ValidFilters(definition, filters))
            return ReportProblems.InvalidQuery(this);
        var result = await store.ReadAsync(actorId, definition.Kind, stationId, from, to, page, limit, filters,
            cancellationToken);
        if (result.Failure is { } failure) return Failure<OccReportPageResponse>(failure);
        var table = result.Table!;
        return Ok(new OccReportPageResponse(definition.Key, definition.Title, table.StationId, table.StationCode,
            table.From, table.To, table.AsOf, definition.Columns,
            table.Rows.Select(row => (IReadOnlyList<OccReportCellResponse>)row
                .Select(cell => new OccReportCellResponse(cell.Value, cell.Type == OccReportCellType.Number ? "number" : "text"))
                .ToArray()).ToArray(),
            table.Page, table.Limit, table.HasMore)
        {
            StationName = table.StationName,
            ColumnTypes = ReportResponses.Types(definition.Specs),
            AppliedFilters = ReportResponses.Filters(table.Filters),
            TotalRows = table.TotalRows ?? table.RowCount,
            Summary = ReportResponses.Summary(table.Summary),
            Totals = ReportResponses.Totals(table.Totals),
            GeneratedBy = table.GeneratedBy,
        });
    }

    [HttpGet("{key}/export", Name = "ExportOccReport")]
    [Produces("text/csv", "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK,
        "text/csv", "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(422, "application/problem+json")]
    public async Task<IActionResult> Export([FromRoute] string key,
        [FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "from"), BindRequired] DateOnly from,
        [FromQuery(Name = "to"), BindRequired] DateOnly to,
        [FromQuery, BindRequired] string format,
        [FromQuery] Guid? airlineId, [FromQuery] string? status, [FromQuery] Guid? agentId, [FromQuery] Guid? terminalId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<object>().Result!;
        var definition = OccReportCatalog.Find(key);
        if (definition is null) return ReportProblems.NotFound(this);
        var filters = new OccReportFilters(airlineId, status, agentId, terminalId);
        if (stationId == Guid.Empty || !OccReportCatalog.ValidRange(from, to) || format is not ("csv" or "xlsx" or "pdf") ||
            !OccReportCatalog.ValidFilters(definition, filters))
            return ReportProblems.InvalidQuery(this);
        // The whole period or nothing (3-N13): one page as large as the format allows, refused when rows follow it.
        var limit = format == "pdf" ? OccReportCatalog.MaxPdfExportRows : OccReportCatalog.MaxExportRows;
        var result = await store.ReadAsync(actorId, definition.Kind, stationId, from, to, 1, limit, filters,
            cancellationToken);
        if (result.Failure is { } readFailure) return Failure<object>(readFailure).Result!;
        var table = result.Table!;
        if (table.HasMore) return ReportProblems.TooLarge(this);
        // Exporting needs «Exportar»; nothing is rendered or returned without it.
        var denied = await store.RecordExportAsync(actorId, definition.Kind, stationId, from, to, format,
            table.RowCount, filters, cancellationToken);
        if (denied is { } failure) return Failure<object>(failure).Result!;
        var (data, contentType) = format switch
        {
            "csv" => (OccReportDocuments.Csv(table), "text/csv; charset=utf-8"),
            "xlsx" => (renderer.RenderXlsx(OccReportDocuments.ToDocument(table)),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            _ => (renderer.RenderPdf(OccReportDocuments.ToDocument(table)), "application/pdf"),
        };
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(data, contentType, $"elevant-occ-{definition.Key}-{table.StationCode}-{from:yyyyMMdd}-{to:yyyyMMdd}.{format}");
    }

    private static OccReportFilterDefinitionResponse Filter(string key) => new(key, OccReportCatalog.FilterLabel(key),
        key switch
        {
            OccReportCatalog.AirlineFilter => "airlineId",
            OccReportCatalog.AgentFilter => "agentId",
            OccReportCatalog.TerminalFilter => "terminalId",
            _ => "status",
        },
        key == OccReportCatalog.StatusFilter
            ? OccReportCatalog.Statuses.Select(item => new OccReportFilterOptionResponse(item.Code, item.Label)).ToArray()
            : []);

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return Problem<T>(401, "Authentication failed.");
    }

    private ActionResult<T> Failure<T>(OccReportFailure failure) => failure switch
    {
        OccReportFailure.Forbidden => Problem<T>(403, "OCC report access is forbidden."),
        _ => ReportProblems.StationUnavailable(this),
    };

    private ActionResult<T> Problem<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
}
