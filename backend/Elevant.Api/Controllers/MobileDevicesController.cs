using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Integration;
using Elevant.Application.Integration.RegisterMobileDevice;
using Elevant.Contracts.Integration;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Registers authenticated ramp-agent mobile installations. A shared tablet passes to the agent who signs in on it
/// unless the agent holding it has an operation in progress, and signing out releases it (2-N02). Failures carry a
/// stable Problem Details <c>code</c>; the success body never changes, because the deployed APK validates it.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/mobile/device")]
public sealed class MobileDevicesController(RegisterMobileDeviceHandler handler, IMobileDeviceCommandStore store)
    : ControllerBase
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
                "El registro de la tablet no es válido.",
                "invalid_mobile_device");
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
            return FailureResult<RegisterMobileDeviceResponse>(result.Failure!.Value, result.Code);
        }

        var device = result.Device!;
        return Ok(new RegisterMobileDeviceResponse(
            device.InstallationId,
            device.Platform,
            device.AppVersion,
            device.LastSeenAt));
    }

    /// <summary>
    /// The agent signs out and frees the tablet it holds (2-N02). The Idempotency-Key is scoped to the installation:
    /// a retry with the same key and body answers the first result. Only the account holding the tablet releases
    /// it (<c>device_not_bound</c> otherwise).
    /// </summary>
    [RequestSizeLimit(ApiConfiguration.MobileDeviceRequestBodyLimitBytes)]
    [HttpPost("release", Name = "ReleaseMobileDevice")]
    [Consumes("application/json")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Release(
        [FromBody, BindRequired] ReleaseMobileDeviceRequest request,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return Coded(StatusCodes.Status401Unauthorized, "La sesión no es válida.", null);
        }

        if (idempotencyKey == Guid.Empty)
        {
            return Coded(StatusCodes.Status400BadRequest,
                "Falta la clave de idempotencia del envío.", "idempotency_key_required");
        }

        if (request.InstallationId == Guid.Empty)
        {
            return Coded(StatusCodes.Status400BadRequest,
                "El registro de la tablet no es válido.", "invalid_mobile_device");
        }

        var result = await store.ReleaseAsync(
            new MobileDeviceReleaseWriteRequest(accountId, request.InstallationId, idempotencyKey),
            cancellationToken);
        return result.Failure switch
        {
            null => NoContent(),
            MobileDeviceReleaseWriteFailure.Forbidden => Coded(StatusCodes.Status403Forbidden,
                "La tablet no puede liberarse con esta cuenta.", result.Code ?? "forbidden"),
            MobileDeviceReleaseWriteFailure.NotFound => Coded(StatusCodes.Status404NotFound,
                "La tablet no está registrada.", result.Code ?? "not_found"),
            MobileDeviceReleaseWriteFailure.IdempotencyKeyConflict => Coded(
                StatusCodes.Status409Conflict, "Esa clave ya se usó con otro envío.", "idempotency_conflict"),
            _ => Coded(StatusCodes.Status409Conflict,
                "La tablet no está vinculada a esta cuenta.", result.Code ?? MobileDeviceCodes.NotBound),
        };
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(RegisterMobileDeviceFailure failure, string? code) => failure switch
    {
        RegisterMobileDeviceFailure.Unauthorized => UnauthorizedResult<T>(),
        RegisterMobileDeviceFailure.Forbidden => code == MobileDeviceCodes.Revoked
            ? ProblemResult<T>(StatusCodes.Status403Forbidden, "OCC revocó esta tablet.", code)
            : ProblemResult<T>(StatusCodes.Status403Forbidden,
                "Esta cuenta no puede registrar la tablet.", code ?? "forbidden"),
        RegisterMobileDeviceFailure.InvalidRequest => ProblemResult<T>(
            StatusCodes.Status400BadRequest,
            "El registro de la tablet no es válido.",
            "invalid_mobile_device"),
        RegisterMobileDeviceFailure.Conflict => code == MobileDeviceCodes.InUseByActiveAgent
            ? ProblemResult<T>(StatusCodes.Status409Conflict,
                "Otro agente usa la tablet en una operación en curso.", code)
            : ProblemResult<T>(StatusCodes.Status409Conflict,
                "El registro de la tablet entró en conflicto con su vínculo actual.", code ?? "device_conflict"),
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Unsupported failure."),
    };

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(StatusCodes.Status401Unauthorized, "La sesión no es válida.", null);
    }

    private ActionResult<T> ProblemResult<T>(int statusCode, string title, string? code) => Coded(statusCode, title, code);

    private ObjectResult Coded(int statusCode, string title, string? code)
    {
        var problem = new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        };
        if (code is not null)
        {
            problem.Extensions["code"] = code;
        }

        return new ObjectResult(problem)
        {
            StatusCode = statusCode,
        };
    }
}
