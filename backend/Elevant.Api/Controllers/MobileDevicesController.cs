using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Integration.RegisterMobileDevice;
using Elevant.Contracts.Integration;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Registers authenticated ramp-agent mobile installations.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/mobile/device")]
public sealed class MobileDevicesController(RegisterMobileDeviceHandler handler) : ControllerBase
{
    /// <summary>Creates or refreshes the current account's fail-closed device binding.</summary>
    [RequestSizeLimit(ApiConfiguration.MobileDeviceRequestBodyLimitBytes)]
    [HttpPut(Name = "RegisterMobileDevice")]
    [Consumes("application/json")]
    [ProducesResponseType<RegisterMobileDeviceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<RegisterMobileDeviceResponse>> Register(
        [FromBody, BindRequired] RegisterMobileDeviceRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return UnauthorizedResult<RegisterMobileDeviceResponse>();
        }

        if (!Enum.TryParse<MobilePlatform>(request.Platform, ignoreCase: false, out var platform))
        {
            return ProblemResult<RegisterMobileDeviceResponse>(
                StatusCodes.Status400BadRequest,
                "The mobile device registration is invalid.");
        }

        var result = await handler.HandleAsync(
            new RegisterMobileDeviceCommand(
                accountId,
                request.InstallationId,
                platform,
                request.AppVersion,
                request.DeviceName,
                request.OperatingSystemVersion),
            cancellationToken);

        if (!result.IsSuccess)
        {
            return FailureResult<RegisterMobileDeviceResponse>(result.Failure!.Value);
        }

        var device = result.Device!;
        return Ok(new RegisterMobileDeviceResponse(
            device.InstallationId,
            device.Platform,
            device.AppVersion,
            device.LastSeenAt));
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(RegisterMobileDeviceFailure failure) => failure switch
    {
        RegisterMobileDeviceFailure.Unauthorized => UnauthorizedResult<T>(),
        RegisterMobileDeviceFailure.Forbidden => ProblemResult<T>(
            StatusCodes.Status403Forbidden,
            "Mobile device registration is forbidden."),
        RegisterMobileDeviceFailure.InvalidRequest => ProblemResult<T>(
            StatusCodes.Status400BadRequest,
            "The mobile device registration is invalid."),
        RegisterMobileDeviceFailure.Conflict => ProblemResult<T>(
            StatusCodes.Status409Conflict,
            "The mobile device registration conflicts with an existing binding."),
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Unsupported failure."),
    };

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(StatusCodes.Status401Unauthorized, "Authentication failed.");
    }

    private ActionResult<T> ProblemResult<T>(int statusCode, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        })
        {
            StatusCode = statusCode,
        };
}
