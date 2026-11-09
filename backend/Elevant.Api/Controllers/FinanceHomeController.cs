using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// «Inicio» of Finance (phase 4, block B, 4-A and 4-N02): the indicators of one station, computed by the server and
/// governed by the module each one opens, so a template with only «Inicio» and «Facturación» sees its summary.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/home")]
public sealed class FinanceHomeController(IFinanceHomeStore store) : ControllerBase
{
    /// <summary>
    /// Requires «Inicio» (finance.home.read), AVIAM staff and a live grant on <c>stationId</c>: otherwise 403
    /// <c>forbidden</c>. A missing or malformed station is 400 <c>invalid_finance_home_query</c>. Each section is null
    /// without the permission of its module.
    /// </summary>
    [HttpGet(Name = "GetFinanceHome")]
    [FinanceQueryProblem(FinanceResults.InvalidHomeQueryCode)]
    [ProducesResponseType<FinanceHomeResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<ActionResult<FinanceHomeResponse>> Get([FromQuery] Guid? stationId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) || accountId == Guid.Empty)
            return FinanceResults.Unauthorized(this);
        if (stationId is not { } station || station == Guid.Empty)
            return FinanceResults.Coded(this, StatusCodes.Status400BadRequest, "The home query is invalid.",
                FinanceResults.InvalidHomeQueryCode);
        var data = await store.GetAsync(accountId, station, cancellationToken);
        if (data is null) return FinanceResults.Forbidden(this, "The Finance home is forbidden in this station.");
        return Ok(new FinanceHomeResponse(data.StationId, data.BusinessDate,
            data.ToInvoice is { } pending
                ? new FinanceHomeToInvoiceResponse(pending.Operations, pending.Airlines, pending.OldestOperationDate)
                : null,
            data.InvoicedThisMonth?.Select(Map).ToArray(),
            data.Receivables?.Select(item => new FinanceHomeReceivableResponse(item.CurrencyCode, item.OpenInvoices,
                item.Open, item.OverdueInvoices, item.Overdue)).ToArray(),
            data.CardCollectionsThisMonth?.Select(Map).ToArray(),
            data.PendingContractApprovals, data.ChartersAwaitingPrepayment));
    }

    private static FinanceHomeAmountResponse Map(FinanceHomeAmountData item) =>
        new(item.CurrencyCode, item.Count, item.Amount);
}
