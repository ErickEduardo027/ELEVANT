using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Commercial;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>The signed Service Order of an operation of the airline's organization (ADR-0032).</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/airline/portal/operations")]
public sealed class AirlineServiceOrderController(AirlineServiceOrderHandler handler) : ControllerBase
{
    [HttpGet("{operationId:guid}/service-order", Name = "GetAirlineServiceOrder")]
    [ProducesResponseType<AirlineServiceOrderResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlineServiceOrderResponse>> Get([FromRoute] Guid operationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(AirlinePortalFailure.Unauthorized);
        var (document, failure) = await handler.GetAsync(accountId, operationId, cancellationToken);
        if (failure is { } error) return Failure(error);
        return Ok(new AirlineServiceOrderResponse(operationId, document!.Content.Number, document.ContentSha256,
            document.Signatures.Select(OperationDocumentResponseMapper.Map).ToArray(), document.Content.CurrencyCode,
            document.Content.TotalAmount));
    }

    [HttpGet("{operationId:guid}/service-order/pdf", Name = "GetAirlineServiceOrderPdf")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> GetPdf([FromRoute] Guid operationId, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(AirlinePortalFailure.Unauthorized).Result!;
        var (pdf, fileName, failure) = await handler.RenderAsync(accountId, operationId, cancellationToken);
        return failure is { } error ? Failure(error).Result! : File(pdf!, "application/pdf", fileName);
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<AirlineServiceOrderResponse> Failure(AirlinePortalFailure failure)
    {
        if (failure == AirlinePortalFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            AirlinePortalFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            AirlinePortalFailure.Forbidden => (StatusCodes.Status403Forbidden, "Airline portal access is forbidden."),
            _ => (StatusCodes.Status404NotFound, "No signed Service Order exists for this operation."),
        };
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
    }
}
