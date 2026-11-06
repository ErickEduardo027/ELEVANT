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
        var result = await handler.HandleAsync(Command(request), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title, code) = result.Failure!.Value switch
            {
                CommercialSubmissionFailure.InvalidRequest => (400, "La solicitud no es válida.", "invalid_application"),
                CommercialSubmissionFailure.AirlineUnavailable =>
                    (404, "La aerolínea ya no está disponible.", "airline_unavailable"),
                CommercialSubmissionFailure.ServiceUnavailable =>
                    (409, "Un servicio seleccionado ya no está disponible.", "service_unavailable"),
                CommercialSubmissionFailure.Conflict =>
                    (409, "El identificador ya se usó en otra solicitud.", "idempotency_conflict"),
                _ => throw new InvalidOperationException("Unsupported commercial submission failure."),
            };
            return Coded(status, title, code);
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
        var result = await handler.LookupReceiptAsync(Command(request), cancellationToken);
        if (result.IsSuccess)
            return Ok(new SubmitCommercialRequestResponse(result.Reference!, true));
        return result.Failure == CommercialSubmissionFailure.InvalidRequest
            ? Coded(400, "La solicitud no es válida.", "invalid_application")
            : Coded(404, "No se encontró un envío con estos datos.", "receipt_not_found");
    }

    private static SubmitCommercialRequestCommand Command(SubmitCommercialRequestRequest request) => new(
        request.RequestId, request.AirlineProfileId ?? Guid.Empty, request.ServiceIds,
        request.RepresentativeName, request.RepresentativeTitle,
        request.RepresentativeEmail, request.RepresentativePhone,
        request.AuthorityDeclared, request.RepresentativeNationalityCode,
        request.RepresentativeAddress, request.RepresentativeCountry,
        request.RepresentativeProvince, request.RepresentativeMunicipality,
        request.RepresentativeDocumentType, request.RepresentativeDocumentNumber,
        request.RepresentativeDistrict,
        request.ProposedAirline is { } proposed
            ? new CommercialAirlineProposal(proposed.Name, proposed.CountryCode, proposed.IataCode,
                proposed.IcaoCode, proposed.WebsiteUrl)
            : null);

    private ObjectResult Coded(int status, string title, string code) =>
        new(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
            Extensions = { ["code"] = code },
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
}
