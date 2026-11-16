using Asp.Versioning;
using Elevant.Contracts.System;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>Non-sensitive diagnostics for API consumers.</summary>
[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/system")]
public sealed class SystemController(
    IHostEnvironment hostEnvironment,
    TimeProvider timeProvider) : ControllerBase
{
    /// <summary>Confirms that the HTTP process is responding.</summary>
    [AllowAnonymous]
    [HttpGet("ping", Name = "GetSystemPing")]
    [ProducesResponseType<SystemPingResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public ActionResult<SystemPingResponse> Ping(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        return Ok(new SystemPingResponse(
            Application: "Elevant.Api",
            Status: "ok",
            Environment: hostEnvironment.EnvironmentName,
            TimestampUtc: timeProvider.GetUtcNow()));
    }
}
