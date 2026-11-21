using System.Globalization;
using System.Security.Claims;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Documents;
using Elevant.Contracts.Reports;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The screen and the exports of a tabular report (ADR-0048, «Reportes nuevos»), shared by Contratos, Gestión Humana
/// and the airline portal. The query is validated against the report before anything is read (400
/// <c>invalid_report_query</c>); an unknown report is 404 <c>report_not_found</c>, a station outside the scope 404
/// <c>station_unavailable</c>, a refused account a bare 403, and an export over its row limit 422
/// <c>report_too_large</c>. «Exportar» is checked before reading, the file carries «Generado el … por …», and every
/// export is audited.
/// </summary>
internal sealed class TabularReportEndpoint(
    ITabularReportSource source,
    IReportRenderer renderer,
    IReportExportAudit audit,
    IActorContextResolver actors,
    TimeProvider timeProvider,
    string area,
    string filePrefix)
{
    public const int MaxPageLimit = 100;
    public const int MaxPdfRows = 5000;
    public const int MaxSheetRows = 25000;

    public TabularReportCatalogResponse Catalog(string areaTitle) => new(areaTitle, source.Catalog.Select(Definition).ToArray())
    {
        MaxRangeDays = source.Catalog.Max(definition => definition.MaxRangeDays),
    };

    public static TabularReportDefinitionResponse Definition(TabularReportDefinition definition) => new(definition.Key,
        definition.Title, definition.Description, definition.Columns.Select(column => column.Heading).ToArray(),
        ReportResponses.Types(definition.Columns), definition.Filters.Select(filter => new TabularReportFilterResponse(
            filter.Key, filter.Label, filter.Parameter, Kind(filter.Kind),
            filter.Options.Select(option => new TabularReportFilterOptionResponse(option.Code, option.Label)).ToArray()))
            .ToArray(), Period(definition.Period), definition.MaxRangeDays)
    {
        AsOfDate = definition.Period != ReportPeriod.Range,
    };

    public async Task<IActionResult> PageAsync(ControllerBase controller, string reportKey, int page, int limit,
        CancellationToken cancellationToken)
    {
        if (!TryActor(controller, out var actorId)) return Unauthorized(controller);
        if (source.Catalog.Find(reportKey) is not { } definition) return ReportProblems.NotFound(controller);
        if (page < 1 || page > 100_000 || limit is < 1 or > MaxPageLimit ||
            Query(controller, definition) is not { } query)
            return ReportProblems.InvalidQuery(controller);
        var result = await source.ReadAsync(actorId, definition, query, cancellationToken);
        if (result.Failure is { } failure) return Failure(controller, failure);
        var document = await StampAsync(actorId, result.Document!, cancellationToken);
        return controller.Ok(Page(definition, document, page, limit));
    }

    public async Task<IActionResult> ExportAsync(ControllerBase controller, string reportKey, string? format,
        CancellationToken cancellationToken)
    {
        if (!TryActor(controller, out var actorId)) return Unauthorized(controller);
        if (source.Catalog.Find(reportKey) is not { } definition) return ReportProblems.NotFound(controller);
        if (format is not ("pdf" or "xlsx" or "csv") || Query(controller, definition) is not { } query)
            return ReportProblems.InvalidQuery(controller);
        if (await source.AuthorizeExportAsync(actorId, cancellationToken) is { } refused)
            return Failure(controller, refused);
        var result = await source.ReadAsync(actorId, definition, query, cancellationToken);
        if (result.Failure is { } failure) return Failure(controller, failure);
        var document = await StampAsync(actorId, result.Document!, cancellationToken);
        if (document.Rows.Count > (format == "pdf" ? MaxPdfRows : MaxSheetRows)) return ReportProblems.TooLarge(controller);
        var (data, contentType) = format switch
        {
            "pdf" => (renderer.RenderPdf(document), "application/pdf"),
            "xlsx" => (renderer.RenderXlsx(document), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            _ => (TabularReports.Csv(document), "text/csv; charset=utf-8"),
        };
        await audit.RecordAsync(actorId, area, definition.Key, format, query, document.Rows.Count, cancellationToken);
        controller.Response.Headers["X-Content-Type-Options"] = "nosniff";
        return controller.File(data, contentType, $"{FileName(filePrefix, definition.Key, query)}.{format}");
    }

    /// <summary>«elevant-contratos-tarifas-20261101-20261130», or with the cut-off alone.</summary>
    public static string FileName(string prefix, string key, TabularReportQuery query) => (query.From, query.To) switch
    {
        ({ } from, { } to) => $"elevant-{prefix}-{key}-{from:yyyyMMdd}-{to:yyyyMMdd}",
        (null, { } to) => $"elevant-{prefix}-{key}-{to:yyyyMMdd}",
        _ => $"elevant-{prefix}-{key}",
    };

    /// <summary>The document as generated now by the account, in the station's (or AVIAM's) local time.</summary>
    private async Task<ReportDocument> StampAsync(Guid actorId, ReportDocument document, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return document with
        {
            GeneratedAt = timeProvider.GetUtcNow(),
            GeneratedBy = document.GeneratedBy ?? actor?.DisplayName,
        };
    }

    public static TabularReportPageResponse Page(TabularReportDefinition definition, ReportDocument document, int page,
        int limit)
    {
        var rows = document.Rows.Skip((page - 1) * limit).Take(limit)
            .Select(row => (IReadOnlyList<TabularReportCellResponse>)row.Select((cell, index) =>
                Cell(document.Columns[index], cell)).ToArray())
            .ToArray();
        return new TabularReportPageResponse(definition.Key, document.Title, document.Area, document.From, document.To,
            document.GeneratedAt, document.Columns.Select(column => column.Heading).ToArray(),
            ReportResponses.Types(document.Columns), rows, page, limit, (long)page * limit < document.Rows.Count,
            document.Rows.Count)
        {
            Description = document.Description,
            Station = document.StationLabel,
            StationCode = document.StationCode,
            StationName = document.StationName,
            AppliedFilters = ReportResponses.Filters(document.Filters),
            Summary = ReportResponses.Summary(document.Summary),
            Totals = document.EffectiveTotals.Select(total => new TabularReportTotalRowResponse(total.Label,
                total.Cells.Select((cell, index) => cell is null
                    ? new TabularReportCellResponse(string.Empty, "text")
                    : Cell(document.Columns[index], cell)).ToArray())).ToArray(),
            Notes = document.Notes,
            GeneratedBy = document.GeneratedBy,
        };
    }

    /// <summary>A typed cell with its invariant value; a dash or a name is <c>text</c>.</summary>
    public static TabularReportCellResponse Cell(ReportColumn column, ReportCell cell)
    {
        if (cell.Number is { } number)
            return new(number.ToString(CultureInfo.InvariantCulture), ReportResponses.Type(column.Type));
        if (cell.Moment is { } moment)
            return new(column.Type switch
            {
                ReportColumnType.DateTime => moment.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture),
                ReportColumnType.Time => moment.ToString("HH:mm", CultureInfo.InvariantCulture),
                _ => moment.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            }, ReportResponses.Type(column.Type));
        return new(cell.Text, "text");
    }

    private static TabularReportQuery? Query(ControllerBase controller, TabularReportDefinition definition)
    {
        var parameters = controller.Request.Query;
        if (parameters.Any(item => item.Value.Count != 1)) return null;
        return TabularReports.Parse(definition, Single(parameters, "from"), Single(parameters, "to"),
            parameters.Select(item => new KeyValuePair<string, string?>(item.Key, item.Value.ToString())));
    }

    private static string? Single(IQueryCollection parameters, string name) =>
        parameters.TryGetValue(name, out var value) ? value.ToString() : null;

    private static string Kind(ReportFilterKind kind) => kind switch
    {
        ReportFilterKind.Station => "station",
        ReportFilterKind.Airline => "airline",
        ReportFilterKind.Service => "service",
        ReportFilterKind.Days => "days",
        _ => "select",
    };

    private static string Period(ReportPeriod period) => period switch
    {
        ReportPeriod.Range => "range",
        ReportPeriod.AsOf => "asOf",
        _ => "none",
    };

    private static ObjectResult Failure(ControllerBase controller, TabularReportFailure failure) => failure switch
    {
        TabularReportFailure.InvalidQuery => ReportProblems.InvalidQuery(controller),
        TabularReportFailure.StationUnavailable => ReportProblems.StationUnavailable(controller),
        TabularReportFailure.NotFound => ReportProblems.NotFound(controller),
        _ => new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status403Forbidden, Title = "No tiene permiso para este reporte.",
            Instance = controller.HttpContext.Request.Path,
        }) { StatusCode = StatusCodes.Status403Forbidden },
    };

    private static ObjectResult Unauthorized(ControllerBase controller)
    {
        controller.Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status401Unauthorized, Title = "Authentication failed.",
            Instance = controller.HttpContext.Request.Path,
        }) { StatusCode = StatusCodes.Status401Unauthorized };
    }

    private static bool TryActor(ControllerBase controller, out Guid actorId) =>
        Guid.TryParse(controller.User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;
}
