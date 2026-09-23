using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Reads and reports incidents for an assigned ramp operation.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations/{operationId:guid}/incidents")]
public sealed class RampIncidentsController(RampIncidentHandler handler) : ControllerBase
{
    private const long ReportBodyLimitBytes = 16 * 1024;

    /// <summary>Returns canonical incidents visible to the assigned ramp agent.</summary>
    [HttpGet(Name = "GetRampIncidents")]
    [ProducesResponseType<GetRampIncidentsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<GetRampIncidentsResponse>> Get(
        [FromRoute] Guid operationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return UnauthorizedResult<GetRampIncidentsResponse>();
        var result = await handler.GetAsync(accountId, operationId, cancellationToken);
        if (!result.IsSuccess) return FailureResult<GetRampIncidentsResponse>(result.Failure!.Value);
        return Ok(new GetRampIncidentsResponse(
            operationId,
            result.Incidents!.Select(incident => new RampIncidentResponse(
                incident.Id,
                incident.IncidentType,
                incident.Severity,
                incident.Status,
                incident.Description,
                incident.OccurredAt,
                incident.ReportedAt)).ToArray()));
    }

    /// <summary>Atomically reports one incident without duplicating offline retries.</summary>
    [RequestSizeLimit(ReportBodyLimitBytes)]
    [HttpPost(Name = "ReportRampIncident")]
    [Consumes("application/json")]
    [ProducesResponseType<RampIncidentReceiptResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<RampIncidentReceiptResponse>> Report(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] ReportRampIncidentRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return UnauthorizedResult<RampIncidentReceiptResponse>();
        if (!Enum.TryParse<IncidentSeverity>(request.Severity, false, out var severity) ||
            !Enum.IsDefined(severity))
        {
            return ProblemResult<RampIncidentReceiptResponse>(
                StatusCodes.Status400BadRequest, "The incident report is invalid.");
        }

        var result = await handler.ReportAsync(
            accountId,
            operationId,
            request.IncidentType,
            severity,
            request.Description,
            request.OccurredAt,
            installationId,
            idempotencyKey,
            HttpContext.TraceIdentifier,
            cancellationToken);
        if (!result.IsSuccess) return FailureResult<RampIncidentReceiptResponse>(result.Failure!.Value);
        var receipt = result.Receipt!;
        return Ok(new RampIncidentReceiptResponse(
            receipt.ReceiptId,
            receipt.OperationId,
            receipt.IncidentId,
            receipt.Status,
            receipt.OccurredAt,
            receipt.ReportedAt));
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(RampOperationsFailure failure) => failure switch
    {
        RampOperationsFailure.Unauthorized => UnauthorizedResult<T>(),
        RampOperationsFailure.Forbidden => ProblemResult<T>(403, "Incident access is forbidden."),
        RampOperationsFailure.InvalidRequest => ProblemResult<T>(400, "The incident request is invalid."),
        RampOperationsFailure.NotFound => ProblemResult<T>(404, "The ramp operation was not found."),
        RampOperationsFailure.Conflict => ProblemResult<T>(409, "The incident request conflicts with current operational data."),
        _ => throw new ArgumentOutOfRangeException(nameof(failure)),
    };

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(401, "Authentication failed.");
    }

    private ActionResult<T> ProblemResult<T>(int statusCode, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = statusCode };
}
