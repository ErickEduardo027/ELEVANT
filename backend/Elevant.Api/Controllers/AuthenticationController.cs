using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Identity;
using Elevant.Application.Identity.CreateSession;
using Elevant.Application.Identity.GetCurrentSession;
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
    GetCurrentSessionHandler getCurrentSessionHandler) : ControllerBase
{
    /// <summary>Exchanges valid Development credentials for a short-lived bearer token.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost(Name = "CreateSession")]
    [ProducesResponseType<SessionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
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

        if (!result.IsSuccess)
        {
            return result.Failure == CreateSessionFailure.TokenUnavailable
                ? Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Authentication is temporarily unavailable.")
                : UnauthorizedProblem(includeBearerChallenge: false);
        }

        var session = result.Session!;
        return Ok(new SessionResponse(
            AccessToken: session.AccessToken.Value,
            TokenType: "Bearer",
            ExpiresAt: session.AccessToken.ExpiresAt,
            Actor: MapActor(session.Actor)));
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
