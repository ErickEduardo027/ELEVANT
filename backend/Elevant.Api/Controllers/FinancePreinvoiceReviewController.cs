using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController, ApiVersion("1.0"), Authorize, PrivateResponse]
[Route("api/v{version:apiVersion}/finance/preinvoices/{id:guid}")]
public sealed class FinancePreinvoiceReviewController(IFinancePreinvoiceReviewStore store) : ControllerBase
{
    [HttpGet("calculations", Name = "GetFinancePreinvoiceCalculations")]
    [ProducesResponseType<FinanceLineCalculationResponse[]>(200)]
    public async Task<IActionResult> Calculations(Guid id, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        var result = await store.CalculationsAsync(actor, id, ct);
        return result is null ? NotFound() : Ok(result.Select(x => new FinanceLineCalculationResponse(x.LineId, x.Kind, x.Description, x.OperationServiceId, x.SubmissionId, x.Steps.Select(s => new FinanceCalculationStepResponse(s.Label, s.Value, s.Unit, s.Currency)).ToArray())));
    }
    [HttpPost("cancel", Name = "CancelFinancePreinvoiceDraft")]
    [ProducesResponseType<FinancePackageIdResponse>(200)]
    public Task<IActionResult> Cancel(Guid id, FinancePreinvoiceReviewRequest input, CancellationToken ct) => Mutate(id, input, true, ct);
    [HttpPost("restore-calculation", Name = "RestoreFinancePreinvoiceCalculation")]
    [ProducesResponseType<FinancePackageIdResponse>(200)]
    public Task<IActionResult> Restore(Guid id, FinancePreinvoiceReviewRequest input, CancellationToken ct) => Mutate(id, input, false, ct);
    private async Task<IActionResult> Mutate(Guid id, FinancePreinvoiceReviewRequest input, bool cancel, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        var request = new PreinvoiceReviewInput(input.RequestId, input.ExpectedVersion, input.Reason);
        var result = cancel ? await store.CancelAsync(actor, id, request, ct) : await store.RestoreCalculationAsync(actor, id, request, ct);
        if (result.IsSuccess) return Ok(new FinancePackageIdResponse(result.Id!.Value));
        if (result.Code == "forbidden") return Forbid();
        return Problem(statusCode: result.Code == "not_found" ? 404 : result.Code is "version_conflict" or "idempotency_conflict" ? 409 : 400, title: "No se pudo revisar la prefactura.", extensions: new Dictionary<string, object?> { ["code"] = result.Code });
    }
    private bool Actor(out Guid id) => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out id);
}
