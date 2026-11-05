using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// A charter on the tablet (ADR-0033): the agent records the carrier data and adds the services at
/// Finance's base tariff. Idempotent per device like every ramp command.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampChartersController(CharterHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 2 * 1024;

    /// <summary>The charter of the operation; 404 when the flight has a contract.</summary>
    [HttpGet("{operationId:guid}/charter", Name = "GetRampCharter")]
    [ProducesResponseType<RampCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<RampCharterResponse>> Get([FromRoute] Guid operationId, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.ReadForAgentAsync(accountId, operationId, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(Map(data!));
    }

    /// <summary>Adds a service to the charter at the base tariff; one line per service.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("{operationId:guid}/charter/services", Name = "AddRampCharterService")]
    [Consumes("application/json")]
    [ProducesResponseType<RampCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<RampCharterResponse>> AddService(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] AddCharterServiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.AddServiceAsync(accountId, operationId, request.ServiceDefinitionId,
            request.Quantity, installationId, idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(Map(data!));
    }

    /// <summary>Records the carrier's address and who pays, as the representative gives them.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPut("{operationId:guid}/charter/details", Name = "UpdateRampCharterDetails")]
    [Consumes("application/json")]
    [ProducesResponseType<RampCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<RampCharterResponse>> UpdateDetails(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] UpdateCharterDetailsRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.UpdateDetailsAsync(accountId, operationId, request.CarrierAddress,
            request.ChargesPayableBy, installationId, idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(Map(data!));
    }

    private static RampCharterResponse Map(CharterView view) => new(view.OperationId, view.CharterId, view.CurrencyCode,
        view.CarrierAddress, view.ChargesPayableBy, view.PrepaymentStatus, view.PrepaymentAmount,
        view.Catalog.Select(item => new CharterCatalogItemResponse(item.ServiceDefinitionId, item.Code, item.Name,
            item.BillingUnit, item.UnitPrice, item.MinimumQuantity)).ToArray());

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<RampCharterResponse> Failure(RampOperationsFailure failure)
    {
        if (failure == RampOperationsFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            RampOperationsFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            RampOperationsFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to the ramp operation is forbidden."),
            RampOperationsFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The charter entry is invalid."),
            RampOperationsFailure.NotFound => (StatusCodes.Status404NotFound, "The operation is not a charter of yours."),
            _ => (StatusCodes.Status409Conflict, "The charter entry conflicts with the operation's current state."),
        };
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
    }
}
