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
[RampProblemDetails]
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
        if (!TryGetAccountId(out var accountId)) return RampProblems.Failure(this, RampOperationsFailure.Unauthorized);
        var result = await handler.GetAsync(accountId, operationId, cancellationToken);
        if (!result.IsSuccess) return RampProblems.Failure(this, result.Failure!.Value);
        return Ok(new GetRampIncidentsResponse(
            operationId,
            result.Incidents!.Select(incident => new RampIncidentResponse(
                incident.Id,
                incident.IncidentType,
                incident.Severity,
                incident.Status,
                incident.Description,
                incident.OccurredAt,
                incident.ReportedAt,
                incident.DelayCode)).ToArray()));
    }

    /// <summary>
    /// Atomically reports one incident without duplicating offline retries. Its time must fit the operation's window
    /// (409 <c>time_outside_operation_window</c>, 3-N25).
    /// </summary>
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
        if (!TryGetAccountId(out var accountId)) return RampProblems.Failure(this, RampOperationsFailure.Unauthorized);
        if (!Enum.TryParse<IncidentSeverity>(request.Severity, false, out var severity) ||
            !Enum.IsDefined(severity))
        {
            return RampProblems.InvalidCommand(this);
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
            cancellationToken,
            request.DelayCode);
        if (!result.IsSuccess) return RampProblems.Failure(this, result.Failure!.Value, result.Code);
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

}
