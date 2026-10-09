using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Finance edits of draft preinvoice lines before they are sent to the airline.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/preinvoices/{preinvoiceId:guid}")]
public sealed class FinancePreinvoiceLinesController(IPreinvoiceLineEditStore store) : ControllerBase
{
    [HttpPut("lines/{lineId:guid}", Name = "EditFinancePreinvoiceLine")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> EditLine(Guid preinvoiceId, Guid lineId, [FromBody] EditPreinvoiceLineInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.EditLineAsync(actor, preinvoiceId, lineId, input, cancellationToken));

    [HttpPost("adjustments", Name = "AddFinancePreinvoiceAdjustment")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> AddAdjustment(Guid preinvoiceId, [FromBody] AddPreinvoiceAdjustmentInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.AddAdjustmentAsync(actor, preinvoiceId, input, cancellationToken));

    private async Task<IActionResult> MutateAsync(Func<Guid, Task<FinanceCatalogResult>> command)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) || actorId == Guid.Empty)
            return Unauthorized();
        var result = await command(actorId);
        return result.Failure switch
        {
            null => Ok(new FinanceIdResponse(result.Id!.Value)),
            FinanceCatalogFailure.Forbidden => Forbid(),
            FinanceCatalogFailure.NotFound => Problem(statusCode: 404, title: "Preinvoice or line not found."),
            FinanceCatalogFailure.Invalid => Problem(statusCode: 400, title: "Invalid preinvoice edit."),
            _ => Problem(statusCode: 409, title: "The preinvoice changed or is no longer a draft."),
        };
    }
}
