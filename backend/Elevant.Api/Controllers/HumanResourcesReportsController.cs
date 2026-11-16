using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Contracts.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Station-scoped, current G.H. reports and complete private exports. Failures carry a stable code
/// (<see cref="ReportProblems"/>, 3-N13); a refused role stays a bare 403.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ReportProblemDetails]
[Route("api/v{version:apiVersion}/human-resources/reports")]
public sealed class HumanResourcesReportsController(
    IHumanResourcesReportStore store,
    IHumanResourcesReportPdfRenderer pdf,
    IHumanResourcesReportXlsxRenderer xlsx) : ControllerBase
{
    private const int MaxExportRows = 5000;

    [HttpGet("expirations", Name = "ListHumanResourcesExpirations")]
    [ProducesResponseType<HumanResourcesReportPageResponse<HumanResourcesExpirationResponse>>(200)]
    public async Task<ActionResult<HumanResourcesReportPageResponse<HumanResourcesExpirationResponse>>>
        Expirations([FromQuery, BindRequired] Guid stationId,
            [FromQuery(Name = "from"), BindRequired] DateOnly from,
            [FromQuery(Name = "to"), BindRequired] DateOnly to,
            [FromQuery] int page = 1, [FromQuery] int limit = 20,
            [FromQuery] string? documentKind = null,
            [FromQuery] string? validity = null,
            CancellationToken cancellationToken = default)
    {
        if (!TryAccount(out var actorId)) return UnauthorizedPage<HumanResourcesExpirationResponse>();
        if (!Valid(stationId, from, to, page, limit) ||
            !HumanResourcesReportPolicy.ValidExpirationFilters(
                HumanResourcesReportKind.Expirations, documentKind, validity))
            return ReportProblems.InvalidQuery(this);
        var result = await store.ListExpirationsAsync(actorId, stationId, from, to,
            page, limit, documentKind, validity, cancellationToken);
        return Page(result, row => new HumanResourcesExpirationResponse(row.Id,
            row.RampProfileId, row.AgentName, row.EmployeeNumber, row.Kind,
            row.Code, row.ExpiresOn), documentKind, validity);
    }

    [HttpGet("account-movements", Name = "ListHumanResourcesAccountMovements")]
    [ProducesResponseType<HumanResourcesReportPageResponse<HumanResourcesAccountMovementResponse>>(200)]
    public async Task<ActionResult<HumanResourcesReportPageResponse<HumanResourcesAccountMovementResponse>>>
        AccountMovements([FromQuery, BindRequired] Guid stationId,
            [FromQuery(Name = "from"), BindRequired] DateOnly from,
            [FromQuery(Name = "to"), BindRequired] DateOnly to,
            [FromQuery] int page = 1, [FromQuery] int limit = 20,
            CancellationToken cancellationToken = default)
    {
        if (!TryAccount(out var actorId)) return UnauthorizedPage<HumanResourcesAccountMovementResponse>();
        if (!Valid(stationId, from, to, page, limit))
            return ReportProblems.InvalidQuery(this);
        var result = await store.ListAccountMovementsAsync(actorId, stationId, from, to,
            page, limit, cancellationToken);
        return Page(result, row => new HumanResourcesAccountMovementResponse(row.Id,
            row.AccountId, row.RampProfileId, row.AgentName, row.EmployeeNumber,
            row.Kind, row.OccurredAt));
    }

    [HttpGet("staff-distribution", Name = "ListHumanResourcesStaffDistribution")]
    [ProducesResponseType<HumanResourcesReportPageResponse<HumanResourcesStaffDistributionResponse>>(200)]
    public async Task<ActionResult<HumanResourcesReportPageResponse<HumanResourcesStaffDistributionResponse>>>
        StaffDistribution([FromQuery, BindRequired] Guid stationId,
            [FromQuery(Name = "from"), BindRequired] DateOnly from,
            [FromQuery(Name = "to"), BindRequired] DateOnly to,
            [FromQuery] int page = 1, [FromQuery] int limit = 20,
            CancellationToken cancellationToken = default)
    {
        if (!TryAccount(out var actorId)) return UnauthorizedPage<HumanResourcesStaffDistributionResponse>();
        if (!Valid(stationId, from, to, page, limit))
            return ReportProblems.InvalidQuery(this);
        var result = await store.ListStaffDistributionAsync(actorId, stationId, from, to,
            page, limit, cancellationToken);
        return Page(result, row => new HumanResourcesStaffDistributionResponse(row.Id,
            row.RampProfileId, row.AgentName, row.EmployeeNumber, row.TerminalId,
            row.TerminalCode, row.PositionCode, row.WorkDate, row.StartsAtLocal,
            row.EndsAtLocal));
    }

    [HttpGet("qualification-coverage", Name = "ListHumanResourcesQualificationCoverage")]
    [ProducesResponseType<HumanResourcesReportPageResponse<HumanResourcesQualificationCoverageResponse>>(200)]
    public async Task<ActionResult<HumanResourcesReportPageResponse<HumanResourcesQualificationCoverageResponse>>>
        QualificationCoverage([FromQuery, BindRequired] Guid stationId,
            [FromQuery(Name = "from"), BindRequired] DateOnly from,
            [FromQuery(Name = "to"), BindRequired] DateOnly to,
            [FromQuery] int page = 1, [FromQuery] int limit = 20,
            CancellationToken cancellationToken = default)
    {
        if (!TryAccount(out var actorId)) return UnauthorizedPage<HumanResourcesQualificationCoverageResponse>();
        if (!Valid(stationId, from, to, page, limit))
            return ReportProblems.InvalidQuery(this);
        var result = await store.ListQualificationCoverageAsync(actorId, stationId,
            from, to, page, limit, cancellationToken);
        return Page(result, row => new HumanResourcesQualificationCoverageResponse(
            row.EquipmentTypeId, row.EquipmentCode, row.EquipmentName,
            row.EligibleAgents, row.QualifiedAgents));
    }

    [HttpGet("{kind}/export", Name = "ExportHumanResourcesReport")]
    [Produces("application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK,
        "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(422, "application/problem+json")]
    public async Task<IActionResult> Export([FromRoute] string kind,
        [FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "from"), BindRequired] DateOnly from,
        [FromQuery(Name = "to"), BindRequired] DateOnly to,
        [FromQuery, BindRequired] string format,
        [FromQuery] string? documentKind,
        [FromQuery] string? validity,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return UnauthorizedResult();
        if (!Valid(stationId, from, to, 1, 1) ||
            format is not ("pdf" or "xlsx") || !TryKind(kind, out var reportKind) ||
            !HumanResourcesReportPolicy.ValidExpirationFilters(reportKind,
                documentKind, validity))
            return ReportProblems.InvalidQuery(this);
        var result = await store.ReadSnapshotAsync(actorId, stationId, reportKind,
            from, to, MaxExportRows, documentKind, validity, cancellationToken);
        if (result.Failure is { } failure) return FailureResult(failure);
        var snapshot = result.Snapshot!;
        var data = format == "pdf"
            ? pdf.Render(snapshot, snapshot.StationCode)
            : xlsx.Render(snapshot, snapshot.StationCode);
        var auditFailure = await store.RecordExportAsync(actorId, stationId,
            reportKind, from, to, format, snapshot.RowCount, documentKind,
            validity, cancellationToken);
        if (auditFailure is { } failureAfterSnapshot)
            return FailureResult(failureAfterSnapshot);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var contentType = format == "pdf" ? "application/pdf" :
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        return File(data, contentType,
            $"elevant-gh-{kind}-{from:yyyyMMdd}-{to:yyyyMMdd}.{format}");
    }

    private ActionResult<HumanResourcesReportPageResponse<TResponse>> Page<TRow, TResponse>(
        HumanResourcesReportReadResult<TRow> result, Func<TRow, TResponse> map,
        string? documentKind = null, string? validity = null)
    {
        if (result.Failure is { } failure)
            return failure == HumanResourcesReportFailure.ForbiddenRole
                ? ProblemPage<TResponse>(403, "Human resources report access is forbidden.")
                : ReportProblems.StationUnavailable(this);
        var page = result.Page!;
        return Ok(new HumanResourcesReportPageResponse<TResponse>(page.StationId,
            page.From, page.To, page.Page, page.Limit, page.HasMore, page.AsOf,
            page.Rows.Select(map).ToArray())
        {
            DocumentKind = documentKind,
            Validity = validity,
        });
    }

    private static bool TryKind(string kind, out HumanResourcesReportKind reportKind)
    {
        reportKind = kind switch
        {
            "expirations" => HumanResourcesReportKind.Expirations,
            "account-movements" => HumanResourcesReportKind.AccountMovements,
            "staff-distribution" => HumanResourcesReportKind.StaffDistribution,
            "qualification-coverage" => HumanResourcesReportKind.QualificationCoverage,
            _ => (HumanResourcesReportKind)(-1),
        };
        return Enum.IsDefined(reportKind);
    }

    private static bool Valid(Guid stationId, DateOnly from, DateOnly to,
        int page, int limit) => stationId != Guid.Empty &&
        HumanResourcesReportPolicy.ValidRange(from, to) && page > 0 &&
        limit is >= 1 and <= 100 && (long)(page - 1) * limit <= int.MaxValue;

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) &&
        actorId != Guid.Empty;

    private ActionResult<HumanResourcesReportPageResponse<T>> UnauthorizedPage<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemPage<T>(401, "Authentication failed.");
    }

    private ObjectResult UnauthorizedResult()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult(401, "Authentication failed.");
    }

    private ObjectResult FailureResult(HumanResourcesReportFailure failure) =>
        failure switch
        {
            HumanResourcesReportFailure.ForbiddenRole =>
                ProblemResult(403, "Human resources report access is forbidden."),
            HumanResourcesReportFailure.ForbiddenStation => ReportProblems.StationUnavailable(this),
            HumanResourcesReportFailure.TooLarge => ReportProblems.TooLarge(this),
            _ => throw new ArgumentOutOfRangeException(nameof(failure)),
        };

    private ActionResult<HumanResourcesReportPageResponse<T>> ProblemPage<T>(int code, string title) =>
        new ObjectResult(Details(code, title)) { StatusCode = code };

    private ObjectResult ProblemResult(int code, string title) =>
        new ObjectResult(Details(code, title)) { StatusCode = code };

    private ProblemDetails Details(int code, string title) => new()
    {
        Status = code, Title = title, Instance = HttpContext.Request.Path,
    };
}
