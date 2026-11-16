using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Contracts OCC can plan flights for at a station on a date (ADR-0027).</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/contracts")]
public sealed class OccReadyContractsController(IOccReadyContractsStore store) : ControllerBase
{
    [HttpGet(Name = "ListOccReadyContracts")]
    [ProducesResponseType<OccReadyContractsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] Guid? stationId, [FromQuery] DateOnly? date,
        CancellationToken cancellationToken)
    {
        if (stationId is null || stationId == Guid.Empty || date is null)
            return Problem(statusCode: 400, title: "Station and date are required.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) || actorId == Guid.Empty)
            return Unauthorized();
        var result = await store.ListAsync(actorId, stationId.Value, date.Value, cancellationToken);
        return result is null ? Forbid() : Ok(Response(result));
    }

    private static OccReadyContractsResponse Response(OccReadyContractsData data) =>
        new(data.StationId, data.StationCode, data.Date, data.Contracts.Select(contract => new OccReadyContractResponse(
            contract.ContractId, contract.ContractCode, contract.AirlineId, contract.AirlineName, contract.AirlineIataCode,
            contract.VersionId, contract.VersionNumber, contract.ValidFrom, contract.ValidTo, contract.RenewalMode,
            contract.Services.Select(service => new OccReadyContractServiceResponse(service.Code, service.Name,
                service.BillingUnit)).ToArray(), contract.FlightsOnDate)).ToArray());
}
