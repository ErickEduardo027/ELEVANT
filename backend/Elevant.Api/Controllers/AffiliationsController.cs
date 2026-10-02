using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>Development airline affiliation intake and public reference options.</summary>
[ApiController]
[ApiVersion("1.0")]
[PrivateResponse]
[Route("api/v{version:apiVersion}/commercial")]
public sealed class AffiliationsController(IAffiliationStore store) : ControllerBase
{
    [AllowAnonymous]
    [HttpGet("affiliation-options", Name = "GetAffiliationOptions")]
    [ProducesResponseType<AffiliationOptionsResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AffiliationOptionsResponse>> GetOptions(
        CancellationToken cancellationToken)
    {
        var options = await store.GetOptionsAsync(cancellationToken);
        return Ok(new AffiliationOptionsResponse(
            options.Stations.Select(station => new AffiliationStationOptionResponse(
                station.Id, station.Code, station.Name)).ToArray(),
            options.Services.Select(service => new AffiliationServiceOptionResponse(
                service.Id, service.Code, service.Name,
                service.DefaultBillingUnit)).ToArray()));
    }
}
