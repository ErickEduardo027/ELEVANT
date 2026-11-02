using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Identity;
using Elevant.Application.Identity.CreateSession;
using Elevant.Application.Identity.ChangePassword;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Application.Identity.RefreshSession;
using Elevant.Contracts.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Creates a session and resolves its current server-authoritative actor context.</summary>
[ApiController]
[ApiVersion("1.0")]
[PrivateResponse]
[Route("api/v{version:apiVersion}/auth/session")]
public sealed class AuthenticationController(
    CreateSessionHandler createSessionHandler,
    GetCurrentSessionHandler getCurrentSessionHandler,
    ChangePasswordHandler changePasswordHandler,
    RefreshSessionHandler refreshSessionHandler,
    IAccountEmailStore accountEmails) : ControllerBase
{
    /// <summary>Exchanges valid Development credentials for a short-lived bearer token.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost(Name = "CreateSession")]
    [ProducesResponseType<SessionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<LoginChallengeResponse>(StatusCodes.Status202Accepted, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<SessionResponse>> Create(
        [FromBody, BindRequired] CreateSessionRequest request,
        CancellationToken cancellationToken)
    {
        var result = await createSessionHandler.HandleAsync(
            new CreateSessionCommand(request.Email, request.Password),
            cancellationToken);

        // Portal accounts continue with the code sent by email (ADR-0022).
        if (result.Challenge is { } challenge)
            return Accepted(new LoginChallengeResponse(challenge.ChallengeId, challenge.EmailHint, challenge.ExpiresAt));

        if (!result.IsSuccess)
        {
            return result.Failure switch
            {
                CreateSessionFailure.TokenUnavailable => Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Authentication is temporarily unavailable."),
                CreateSessionFailure.PasswordChangeRequired => Conflict(new ProblemDetails
                {
                    Status = StatusCodes.Status409Conflict,
                    Title = "Password change required.",
                    Type = "https://www.rfc-editor.org/rfc/rfc9110.html#name-409-conflict",
                    Instance = HttpContext.Request.Path,
                    Extensions = { ["code"] = "password_change_required" },
                }),
                _ => UnauthorizedProblem(includeBearerChallenge: false),
            };
        }

        return Ok(MapSession(result.Session!));
    }

    /// <summary>Completes a portal login with the 6-digit code sent by email.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("verify-code", Name = "VerifyLoginCode")]
    [ProducesResponseType<SessionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<ActionResult<SessionResponse>> VerifyCode(
        [FromBody, BindRequired] VerifyLoginCodeRequest request,
        CancellationToken cancellationToken)
    {
        var result = await createSessionHandler.VerifyCodeAsync(request.ChallengeId, request.Code, cancellationToken);
        if (result.IsSuccess) return Ok(MapSession(result.Session!));
        return result.Failure == CreateSessionFailure.TokenUnavailable
            ? Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Authentication is temporarily unavailable.")
            : UnauthorizedProblem(includeBearerChallenge: false);
    }

    /// <summary>Sends a new code for a pending portal login; the earlier code stops working.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("resend-code", Name = "ResendLoginCode")]
    [ProducesResponseType<LoginChallengeResponse>(StatusCodes.Status202Accepted, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<LoginChallengeResponse>> ResendCode(
        [FromBody, BindRequired] ResendLoginCodeRequest request,
        CancellationToken cancellationToken)
    {
        var challenge = request.ChallengeId == Guid.Empty ? null
            : await accountEmails.ResendLoginCodeAsync(request.ChallengeId, cancellationToken);
        return challenge is null
            ? UnauthorizedProblem(includeBearerChallenge: false)
            : Accepted(new LoginChallengeResponse(challenge.ChallengeId, challenge.EmailHint, challenge.ExpiresAt));
    }

    /// <summary>
    /// Renews the session with a refresh token, which is replaced in the same call (ADR-0021).
    /// 409 <c>refresh_rotated</c> means another tab renewed it a moment ago: re-read the stored token.
    /// </summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("refresh", Name = "RefreshSession")]
    [ProducesResponseType<SessionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<ActionResult<SessionResponse>> Refresh(
        [FromBody, BindRequired] RefreshSessionRequest request,
        CancellationToken cancellationToken)
    {
        var result = await refreshSessionHandler.HandleAsync(request.RefreshToken, cancellationToken);
        if (result.IsSuccess) return Ok(MapSession(result.Session!));
        return result.Failure switch
        {
            RefreshSessionFailure.AlreadyRotated => Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "The refresh token was already renewed.",
                Instance = HttpContext.Request.Path,
                Extensions = { ["code"] = "refresh_rotated" },
            }),
            RefreshSessionFailure.TokenUnavailable => Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Authentication is temporarily unavailable."),
            _ => UnauthorizedProblem(includeBearerChallenge: false),
        };
    }

    /// <summary>Ends the session: every refresh token of its family stops working.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("logout", Name = "EndSession")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<IActionResult> Logout(
        [FromBody, BindRequired] RefreshSessionRequest request,
        CancellationToken cancellationToken)
    {
        await refreshSessionHandler.LogoutAsync(request.RefreshToken, cancellationToken);
        return NoContent();
    }

    private static SessionResponse MapSession(SessionDetails session) => new(
        AccessToken: session.AccessToken.Value,
        TokenType: "Bearer",
        ExpiresAt: session.AccessToken.ExpiresAt,
        Actor: MapActor(session.Actor))
    {
        RefreshToken = session.RefreshToken?.Value,
        RefreshExpiresAt = session.RefreshToken?.IdleExpiresAt,
    };

    /// <summary>Changes a verified password, then requires a fresh login.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("~/api/v{version:apiVersion}/auth/password-change", Name = "ChangePassword")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<IActionResult> ChangePassword(
        [FromBody, BindRequired] ChangePasswordRequest request,
        CancellationToken cancellationToken)
    {
        var outcome = await changePasswordHandler.HandleAsync(
            new ChangePasswordCommand(request.Email, request.CurrentPassword, request.NewPassword),
            cancellationToken);
        return outcome switch
        {
            PasswordChangeOutcome.Succeeded => NoContent(),
            PasswordChangeOutcome.RejectedNewPassword => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "New password does not meet the password policy."),
            _ => UnauthorizedProblem(includeBearerChallenge: false),
        };
    }

    /// <summary>Returns the current actor after revalidating its effective scope in SQL.</summary>
    [Authorize]
    [HttpGet(Name = "GetCurrentSession")]
    [ProducesResponseType<CurrentSessionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<CurrentSessionResponse>> Get(
        CancellationToken cancellationToken)
    {
        var subject = User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        if (!Guid.TryParse(subject, out var accountId) || accountId == Guid.Empty)
        {
            return UnauthorizedProblem(includeBearerChallenge: true);
        }

        var result = await getCurrentSessionHandler.HandleAsync(
            new GetCurrentSessionQuery(accountId),
            cancellationToken);

        return result.IsSuccess
            ? Ok(new CurrentSessionResponse(MapActor(result.Actor!)))
            : UnauthorizedProblem(includeBearerChallenge: true);
    }

    private UnauthorizedObjectResult UnauthorizedProblem(bool includeBearerChallenge)
    {
        if (includeBearerChallenge)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
        }

        return Unauthorized(new ProblemDetails
        {
            Status = StatusCodes.Status401Unauthorized,
            Title = "Authentication failed.",
            Type = "https://www.rfc-editor.org/rfc/rfc9110.html#name-401-unauthorized",
            Instance = HttpContext.Request.Path,
        });
    }

    private static SessionActorResponse MapActor(ActorContext actor) => new(
        AccountId: actor.AccountId,
        Email: actor.Email,
        DisplayName: actor.DisplayName,
        Roles: actor.Roles
            .Select(role => new SessionRoleResponse(
                RoleId: role.RoleId,
                Code: role.Code,
                Name: role.Name,
                Portal: MapPortal(role.Portal),
                UserType: role.UserType))
            .ToArray(),
        Memberships: actor.Memberships
            .Select(membership => new SessionMembershipResponse(
                MembershipId: membership.MembershipId,
                OrganizationId: membership.OrganizationId,
                OrganizationCode: membership.OrganizationCode,
                OrganizationName: membership.OrganizationName,
                OrganizationType: MapOrganizationType(membership.OrganizationType),
                Kind: MapMembershipKind(membership.Kind)))
            .ToArray(),
        StationScopes: actor.StationScopes
            .Select(scope => new SessionStationScopeResponse(
                StationId: scope.StationId,
                StationCode: scope.StationCode))
            .ToArray());

    private static SessionPortal MapPortal(PortalKind portal) => portal switch
    {
        PortalKind.BackOffice => SessionPortal.BackOffice,
        PortalKind.RampMobileApp => SessionPortal.RampMobileApp,
        PortalKind.AirlinePortal => SessionPortal.AirlinePortal,
        _ => throw new ArgumentOutOfRangeException(nameof(portal), portal, "Unsupported portal."),
    };

    private static SessionOrganizationType MapOrganizationType(OrganizationType type) => type switch
    {
        OrganizationType.AviamOperator => SessionOrganizationType.AviamOperator,
        OrganizationType.AirlineCustomer => SessionOrganizationType.AirlineCustomer,
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unsupported organization type."),
    };

    private static SessionMembershipKind MapMembershipKind(MembershipKind kind) => kind switch
    {
        MembershipKind.InternalStaff => SessionMembershipKind.InternalStaff,
        MembershipKind.AirlineClient => SessionMembershipKind.AirlineClient,
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unsupported membership kind."),
    };
}
