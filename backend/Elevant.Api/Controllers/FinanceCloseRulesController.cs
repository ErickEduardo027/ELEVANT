using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Finance's rules for closing operations (ADR-0034): the ground time allowed per aircraft category
/// before the «package exceeded» surcharge, and the holidays of the Sunday-and-holiday surcharge.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/close-rules")]
public sealed class FinanceCloseRulesController(FinanceCloseRulesHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 2 * 1024;

    [HttpGet(Name = "GetFinanceCloseRules")]
    [ProducesResponseType<FinanceCloseRulesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<ActionResult<FinanceCloseRulesResponse>> Get(CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCloseRulesResponse>(FinanceCloseRulesFailure.Unauthorized);
        var (data, failure) = await handler.ReadAsync(accountId, cancellationToken);
        return failure is { } error ? Failure<FinanceCloseRulesResponse>(error)
            : Ok(new FinanceCloseRulesResponse(data!.Allowances.Select(Map).ToArray(),
                data.Holidays.Select(Map).ToArray()));
    }

    /// <summary>Sets the ground time of Narrowbody or Widebody; send the version you read.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPut("ground-time/{category}", Name = "SetGroundTimeAllowance")]
    [Consumes("application/json")]
    [ProducesResponseType<GroundTimeAllowanceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<GroundTimeAllowanceResponse>> SetGroundTime([FromRoute] string category,
        [FromBody] SetGroundTimeAllowanceRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<GroundTimeAllowanceResponse>(FinanceCloseRulesFailure.Unauthorized);
        var (data, failure) = await handler.SetAllowanceAsync(accountId, category, request.AllowedMinutes, request.Version,
            HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure<GroundTimeAllowanceResponse>(error) : Ok(Map(data!));
    }

    /// <summary>Adds a holiday; the same date and name again is a retry.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("holidays", Name = "AddFinanceHoliday")]
    [Consumes("application/json")]
    [ProducesResponseType<FinanceHolidayResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<FinanceHolidayResponse>> AddHoliday([FromBody] AddFinanceHolidayRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceHolidayResponse>(FinanceCloseRulesFailure.Unauthorized);
        var (data, failure) = await handler.AddHolidayAsync(accountId, request.Date, request.Name,
            HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure<FinanceHolidayResponse>(error) : Ok(Map(data!));
    }

    [HttpDelete("holidays/{holidayId:guid}", Name = "RemoveFinanceHoliday")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> RemoveHoliday([FromRoute] Guid holidayId, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Problem(FinanceCloseRulesFailure.Unauthorized);
        var failure = await handler.RemoveHolidayAsync(accountId, holidayId, HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Problem(error) : NoContent();
    }

    private static GroundTimeAllowanceResponse Map(GroundTimeAllowanceData item) =>
        new(item.Category, item.AllowedMinutes, item.UpdatedAt, item.Version);

    private static FinanceHolidayResponse Map(FinanceHolidayData item) => new(item.Id, item.Date, item.Name);

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<T> Failure<T>(FinanceCloseRulesFailure failure) => Problem(failure);

    private ObjectResult Problem(FinanceCloseRulesFailure failure)
    {
        var (status, title) = failure switch
        {
            FinanceCloseRulesFailure.Unauthorized => (401, "Authentication failed."),
            FinanceCloseRulesFailure.Forbidden => (403, "The close rules are forbidden."),
            FinanceCloseRulesFailure.InvalidRequest => (400, "The close rules request is invalid."),
            FinanceCloseRulesFailure.NotFound => (404, "The close rule was not found."),
            _ => (409, "The close rules changed."),
        };
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
        {
            StatusCode = status,
        };
    }
}
