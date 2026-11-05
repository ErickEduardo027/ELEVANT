using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Finance follows charter flights and confirms the carrier's prepayment (ADR-0033).</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/charters")]
public sealed class FinanceChartersController(CharterHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 2 * 1024;

    [HttpGet(Name = "GetFinanceCharters")]
    [ProducesResponseType<FinanceCharterListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<FinanceCharterListResponse>> List(CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCharterListResponse>(OccReviewFailure.Unauthorized);
        var (items, failure) = await handler.ListForFinanceAsync(accountId, cancellationToken);
        return failure is { } error
            ? Failure<FinanceCharterListResponse>(error)
            : Ok(new FinanceCharterListResponse(items!.Select(Map).ToArray()));
    }

    /// <summary>Confirms the prepayment; the same amount and reference again are a retry.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPut("{charterId:guid}/prepayment", Name = "ConfirmFinanceCharterPrepayment")]
    [Consumes("application/json")]
    [ProducesResponseType<FinanceCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<FinanceCharterResponse>> ConfirmPrepayment([FromRoute] Guid charterId,
        [FromBody] ConfirmCharterPrepaymentRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCharterResponse>(OccReviewFailure.Unauthorized);
        var (item, failure) = await handler.ConfirmPrepaymentAsync(accountId, charterId, request.Amount, request.Reference,
            HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure<FinanceCharterResponse>(error) : Ok(Map(item!));
    }

    private static FinanceCharterResponse Map(CharterPrepaymentItem item) => new(item.Id, item.OperationId,
        item.OperationCode, item.OperationDate, item.StationCode, item.AirlineName, item.CurrencyCode, item.ServicesTotal,
        item.RequestSigned, item.PrepaymentStatus, item.PrepaymentAmount, item.PrepaymentReference, item.PrepaymentConfirmedAt);

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<T> Failure<T>(OccReviewFailure failure)
    {
        if (failure == OccReviewFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            OccReviewFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            OccReviewFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to charters is forbidden."),
            OccReviewFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The prepayment is invalid."),
            OccReviewFailure.NotFound => (StatusCodes.Status404NotFound, "The charter was not found."),
            _ => (StatusCodes.Status409Conflict, "The charter already has another confirmed prepayment."),
        };
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
    }
}
