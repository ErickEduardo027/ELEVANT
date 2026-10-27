using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>Accepts an anonymous commercial application without issuing credentials.</summary>
[ApiController]
[ApiVersion("1.0")]
[PrivateResponse]
[Route("api/v{version:apiVersion}/public/commercial-requests")]
public sealed class PublicCommercialRequestsController(
    SubmitCommercialRequestHandler handler) : ControllerBase
{
    [HttpPost(Name = "SubmitCommercialRequest")]
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(16384)]
    [Consumes("application/json")]
    [ProducesResponseType<SubmitCommercialRequestResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<SubmitCommercialRequestResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<SubmitCommercialRequestResponse>> Submit(
        [FromBody] SubmitCommercialRequestRequest request,
        CancellationToken cancellationToken)
    {
        var result = await handler.HandleAsync(new SubmitCommercialRequestCommand(
            request.RequestId, request.AirlineProfileId, request.ServiceIds,
            request.RepresentativeName, request.RepresentativeTitle,
            request.RepresentativeEmail, request.RepresentativePhone,
            request.AuthorityDeclared, request.RepresentativeNationalityCode,
            request.RepresentativeAddress, request.RepresentativeCountry,
            request.RepresentativeProvince, request.RepresentativeMunicipality,
            request.RepresentativeDocumentType, request.RepresentativeDocumentNumber,
            request.PackageVersionIds, request.RepresentativeDistrict),
            cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                CommercialSubmissionFailure.InvalidRequest => (400, "Invalid commercial application."),
                CommercialSubmissionFailure.AirlineUnavailable => (404, "Airline profile is unavailable."),
                CommercialSubmissionFailure.ServiceUnavailable => (409, "Selected service is unavailable."),
                CommercialSubmissionFailure.Conflict => (409, "Request identifier conflicts with an earlier application."),
                _ => throw new InvalidOperationException("Unsupported commercial submission failure."),
            };
            return new ObjectResult(new ProblemDetails
            {
                Status = status, Title = title, Instance = HttpContext.Request.Path,
            }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
        }

        var response = new SubmitCommercialRequestResponse(result.Reference!, result.Replayed);
        return StatusCode(result.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created,
            response);
    }

    [HttpPost("receipt", Name = "LookupCommercialRequestReceipt")]
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(16384)]
    [Consumes("application/json")]
    [ProducesResponseType<SubmitCommercialRequestResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<SubmitCommercialRequestResponse>> LookupReceipt(
        [FromBody] SubmitCommercialRequestRequest request,
        CancellationToken cancellationToken)
    {
        var result = await handler.LookupReceiptAsync(new SubmitCommercialRequestCommand(
            request.RequestId, request.AirlineProfileId, request.ServiceIds,
            request.RepresentativeName, request.RepresentativeTitle,
            request.RepresentativeEmail, request.RepresentativePhone,
            request.AuthorityDeclared, request.RepresentativeNationalityCode,
            request.RepresentativeAddress, request.RepresentativeCountry,
            request.RepresentativeProvince, request.RepresentativeMunicipality,
            request.RepresentativeDocumentType, request.RepresentativeDocumentNumber,
            request.PackageVersionIds, request.RepresentativeDistrict),
            cancellationToken);
        if (result.IsSuccess)
            return Ok(new SubmitCommercialRequestResponse(result.Reference!, true));
        var status = result.Failure == CommercialSubmissionFailure.InvalidRequest ? 400 : 404;
        return new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = status == 400 ? "Invalid commercial application." : "Receipt not found.",
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
