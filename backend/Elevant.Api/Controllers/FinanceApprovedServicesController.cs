using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Read-only approved execution evidence for AVIAM Finance.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/approved-services")]
public sealed class FinanceApprovedServicesController(
    GetFinanceApprovedServicesHandler handler) : ControllerBase
{
    [HttpGet(Name = "GetFinanceApprovedServices")]
    [ProducesResponseType<FinanceApprovedServicesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<FinanceApprovedServicesResponse>> Get(
        [FromQuery] Guid? stationId,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken cancellationToken)
    {
        if (!stationId.HasValue || !from.HasValue || !to.HasValue)
            return ProblemResult<FinanceApprovedServicesResponse>(400, "Station and date range are required.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<FinanceApprovedServicesResponse>(401, "Authentication failed.");
        }

        var result = await handler.HandleAsync(new GetFinanceApprovedServicesQuery(
            accountId, stationId.Value, from.Value, to.Value), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                FinanceApprovedServicesFailure.InvalidRequest => (400, "Invalid finance evidence range."),
                FinanceApprovedServicesFailure.Unauthorized => (401, "Authentication failed."),
                FinanceApprovedServicesFailure.Forbidden => (403, "Finance access is forbidden."),
                FinanceApprovedServicesFailure.NotFound => (404, "Station was not found."),
                _ => throw new InvalidOperationException("Unsupported finance evidence failure."),
            };
            if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<FinanceApprovedServicesResponse>(status, title);
        }

        var page = result.Data!;
        return Ok(new FinanceApprovedServicesResponse(page.StationId, page.From, page.To,
            page.Services.Select(service => new FinanceApprovedServiceResponse(
                service.Id, service.OperationId, service.TurnaroundId,
                service.ApprovedSubmissionId, service.OperationCode, service.OperationDate,
                service.AirlineId, service.AirlineName, service.FlightNumber, service.ContractCode,
                service.ServiceCode, service.ServiceName, service.ExecutionStatus,
                service.ContractedQuantity, service.ExecutedQuantity, service.BillingUnit,
                service.FrozenUnitPrice, service.FrozenCurrency, service.Ready,
                service.BlockingReason, service.Amount, service.PreinvoiceId)).ToArray(), page.HasMore));
    }

    private ActionResult<T> ProblemResult<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
}
