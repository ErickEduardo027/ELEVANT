using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/airline/portal/commercial-requests")]
public sealed class AirlineCommercialRequestsController(
    SubmitCommercialRequestHandler handler, ICommercialIntakeStore store) : ControllerBase
{
    [HttpGet(Name = "ListAirlineCommercialRequests")]
    [ProducesResponseType<AirlineCommercialRequestData[]>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId))
            return Unauthorized();
        var requests = await store.ListOwnAsync(actorId, cancellationToken);
        return requests is null ? Forbid() : Ok(requests);
    }

    [HttpPost(Name = "SubmitAirlineAdditionalServiceRequest")]
    [RequestSizeLimit(16384)]
    [Consumes("application/json")]
    [ProducesResponseType<SubmitCommercialRequestResponse>(201, "application/json")]
    [ProducesResponseType<SubmitCommercialRequestResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> Submit(
        [FromBody] SubmitAdditionalServiceRequestRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId))
            return Unauthorized();
        var result = await handler.HandleAdditionalAsync(actorId,
            new SubmitAdditionalServiceRequestCommand(request.RequestId, request.ServiceIds,
                request.RepresentativeName, request.RepresentativeTitle,
                request.RepresentativeEmail, request.RepresentativePhone,
                request.AuthorityDeclared, request.PackageVersionIds), cancellationToken);
        if (result.IsSuccess)
            return StatusCode(result.Replayed ? 200 : 201,
                new SubmitCommercialRequestResponse(result.Reference!, result.Replayed));
        var status = result.Failure switch
        {
            CommercialSubmissionFailure.Forbidden => 403,
            CommercialSubmissionFailure.AirlineUnavailable or
                CommercialSubmissionFailure.ServiceUnavailable or
                CommercialSubmissionFailure.Conflict => 409,
            _ => 400,
        };
        return new ObjectResult(new ProblemDetails
        {
            Status = status, Title = "Commercial request could not be submitted.",
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
