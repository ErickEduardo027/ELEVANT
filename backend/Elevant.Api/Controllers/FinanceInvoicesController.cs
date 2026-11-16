using Asp.Versioning;
using Elevant.Api.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// 4-N12: the legacy issuance from an accepted preinvoice was retired with the preinvoice (ADR-0035, block 3). Every
/// invoice is issued from approved operations in «Por facturar» (POST finance/invoices/from-operations), with ITBIS,
/// e-NCF, email and prepayment; an old client gets 410 with its code and nothing is written.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/invoices")]
public sealed class FinanceInvoicesController : ControllerBase
{
    [HttpPost(Name = "IssueFinanceInvoice")]
    [RequestSizeLimit(1024)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    public IActionResult Issue() =>
        FinanceResults.LegacyRetired(this, "Esta vía se retiró: emita las facturas desde «Por facturar».");
}
