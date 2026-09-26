using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[PrivateResponse]
[Route("api/v{version:apiVersion}/public/commercial-catalog")]
public sealed class PublicCommercialCatalogController(ICommercialCatalogStore store) : ControllerBase
{
    [HttpGet(Name = "GetPublicCommercialCatalog")]
    [AllowAnonymous]
    [ProducesResponseType<PublicCommercialCatalog>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PublicCommercialCatalog>> Get(CancellationToken cancellationToken) =>
        Ok(await store.GetPublicAsync(cancellationToken));
}
