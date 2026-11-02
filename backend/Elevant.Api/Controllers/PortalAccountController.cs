using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Contracts.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Email-driven portal account steps (ADR-0022): activation from the invitation link and password
/// recovery. Responses never reveal whether an email has an account.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[PrivateResponse]
[Route("api/v{version:apiVersion}/auth")]
public sealed class PortalAccountController(IAccountEmailStore accountEmails, IEmailOutboxStore outbox,
    IEmailSender sender) : ControllerBase
{
    /// <summary>Confirms the email of an invited portal account and sets its first password.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("account/activate", Name = "ActivatePortalAccount")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<IActionResult> Activate([FromBody, BindRequired] SetPasswordWithTokenRequest request,
        CancellationToken cancellationToken) =>
        Outcome(await accountEmails.ActivateAsync(request.Token, request.NewPassword, cancellationToken));

    /// <summary>Sends a reset link when a portal account uses this email. Always answers 202.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("password-reset", Name = "RequestPasswordReset")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<IActionResult> RequestReset([FromBody, BindRequired] PasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        await accountEmails.RequestPasswordResetAsync(request.Email, cancellationToken);
        return Accepted();
    }

    /// <summary>Sets a new password from a reset link; every open session ends.</summary>
    [AllowAnonymous]
    [SessionCreationRateLimit]
    [RequestSizeLimit(ApiConfiguration.SessionRequestBodyLimitBytes)]
    [HttpPost("password-reset/confirm", Name = "ConfirmPasswordReset")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<IActionResult> ConfirmReset([FromBody, BindRequired] SetPasswordWithTokenRequest request,
        CancellationToken cancellationToken) =>
        Outcome(await accountEmails.ResetPasswordAsync(request.Token, request.NewPassword, cancellationToken));

    /// <summary>Superadmin smoke test: queues an email to check the no-reply sender.</summary>
    [Authorize]
    [RequestSizeLimit(1024)]
    [HttpPost("~/api/v{version:apiVersion}/governance/email/test", Name = "SendTestEmail")]
    [ProducesResponseType<EmailDeliveryResponse>(StatusCodes.Status202Accepted, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> SendTest([FromBody, BindRequired] SendTestEmailRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Problem(statusCode: 401, title: "Authentication failed.");
        var id = await outbox.EnqueueTestAsync(actorId, request.To, cancellationToken);
        if (id is null) return Problem(statusCode: 403, title: "Only the superadministrator can send a test email, to a valid address.");
        var delivery = (await outbox.ListRecentAsync(actorId, 20, cancellationToken))!.First(item => item.Id == id);
        return Accepted(Map(delivery));
    }

    /// <summary>Latest emails with their delivery state (no bodies), for the superadmin.</summary>
    [Authorize]
    [HttpGet("~/api/v{version:apiVersion}/governance/email/deliveries", Name = "ListEmailDeliveries")]
    [ProducesResponseType<EmailDeliveriesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Deliveries(CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Problem(statusCode: 401, title: "Authentication failed.");
        var deliveries = await outbox.ListRecentAsync(actorId, 30, cancellationToken);
        return deliveries is null
            ? Problem(statusCode: 403, title: "Only the superadministrator can read email deliveries.")
            : Ok(new EmailDeliveriesResponse(sender.IsConfigured, deliveries.Select(Map).ToArray()));
    }

    private IActionResult Outcome(AccountEmailResult result) => result.Failure switch
    {
        null => NoContent(),
        AccountEmailFailure.WeakPassword => CodedProblem("password_policy",
            "The new password does not meet the password policy."),
        _ => CodedProblem("invalid_link", "The link is invalid, used or expired."),
    };

    private ObjectResult CodedProblem(string code, string title) => new(new ProblemDetails
    {
        Status = StatusCodes.Status400BadRequest, Title = title, Instance = HttpContext.Request.Path,
        Extensions = { ["code"] = code },
    }) { StatusCode = StatusCodes.Status400BadRequest };

    private static EmailDeliveryResponse Map(EmailDeliveryData item) => new(item.Id, item.Recipient, item.Purpose,
        item.Status, item.Attempts, item.CreatedAt, item.SentAt, item.LastError);

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;
}
