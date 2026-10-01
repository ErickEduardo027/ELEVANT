using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Finance decisions on a published airline preinvoice objection.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/preinvoices/{preinvoiceId:guid}/resolution")]
public sealed class FinanceDisputeResolutionsController(
    ResolvePreinvoiceDisputeHandler handler) : ControllerBase
{
    [HttpPost(Name = "ResolveFinancePreinvoiceDispute")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<ResolvePreinvoiceDisputeResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ResolvePreinvoiceDisputeResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<ResolvePreinvoiceDisputeResponse>> Resolve(
        Guid preinvoiceId, [FromBody] ResolvePreinvoiceDisputeRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(401, "Authentication failed.");
        }
        var result = await handler.HandleAsync(new(accountId, preinvoiceId,
            request.RequestId, request.Decision, request.Reason), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                ResolvePreinvoiceDisputeFailure.Unauthorized => (401, "Authentication failed."),
                ResolvePreinvoiceDisputeFailure.Forbidden => (403, "Finance access is forbidden."),
                ResolvePreinvoiceDisputeFailure.InvalidRequest => (400, "Invalid resolution request."),
                ResolvePreinvoiceDisputeFailure.NotFound => (404, "Preinvoice was not found."),
                ResolvePreinvoiceDisputeFailure.Conflict => (409, "Dispute cannot be resolved."),
                _ => throw new InvalidOperationException("Unsupported resolution failure."),
            };
            if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(status, title);
        }
        return StatusCode(result.Replayed ? 200 : 201,
            new ResolvePreinvoiceDisputeResponse(result.ResolutionId!.Value,
                result.PreinvoiceId!.Value, result.Status!, result.Replayed));
    }

    private ActionResult<ResolvePreinvoiceDisputeResponse> ProblemResult(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
}
