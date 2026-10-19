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
[Route("api/v{version:apiVersion}/finance")]
public sealed class FinanceTaxesController(IFinanceTaxStore store) : ControllerBase
{
    private bool Actor(out Guid id) => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ??
        User.FindFirstValue(ClaimTypes.NameIdentifier), out id);
    [HttpGet("tax-policies", Name = "ListFinanceTaxPolicies")]
    [ProducesResponseType<FinanceTaxPolicyResponse[]>(200)]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        var rows = await store.ListAsync(actor, ct);
        return rows is null ? Forbid() : Ok(rows.Select(p => new FinanceTaxPolicyResponse(p.Id, p.AirlineId, p.AirlineName,
            p.StationId, p.StationCode, p.CurrencyCode, p.ConceptKind, p.ConceptCode, p.Treatment, p.Rate, p.Basis,
            p.ValidFrom, p.ValidTo, p.Status, p.ReplacesPolicyId, p.Version)));
    }
    [HttpGet("tax-policies/context", Name = "GetFinanceTaxContext")]
    [ProducesResponseType<FinanceTaxContextResponse>(200)]
    public async Task<IActionResult> Context(CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        var data = await store.ContextAsync(actor, ct);
        return data is null ? Forbid() : Ok(new FinanceTaxContextResponse(
            data.Airlines.Select(a => new FinanceTaxOptionResponse(a.Id, a.Code, a.Name)).ToArray(),
            data.Stations.Select(s => new FinanceTaxOptionResponse(s.Id, s.Code, s.Name)).ToArray()));
    }
    [HttpPost("tax-policies", Name = "CreateFinanceTaxPolicy"), RequestSizeLimit(16384)]
    [ProducesResponseType<FinanceTaxIdResponse>(201)]
    public async Task<IActionResult> Create(FinanceTaxPolicyRequest p, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.CreateAsync(actor, new(p.RequestId, p.AirlineId, p.StationId, p.CurrencyCode,
            p.ConceptKind, p.ConceptCode, p.Treatment, p.Rate, p.Basis, p.ValidFrom, p.ValidTo, p.ReplacesPolicyId, p.ExpectedVersion), ct), 201);
    }
    [HttpPost("tax-policies/{id:guid}/publish", Name = "PublishFinanceTaxPolicy")]
    [ProducesResponseType<FinanceTaxIdResponse>(200)]
    public async Task<IActionResult> Publish(Guid id, FinanceTaxCommandRequest p, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.PublishAsync(actor, id, new(p.RequestId, p.ExpectedVersion), ct));
    }
    [HttpGet("preinvoices/{id:guid}/taxes", Name = "GetFinancePreinvoiceTaxes")]
    [ProducesResponseType<FinanceTaxDetailResponse>(200)]
    public async Task<IActionResult> Detail(Guid id, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        var d = await store.GetPreinvoiceAsync(actor, id, ct);
        return d is null ? NotFound() : Ok(new FinanceTaxDetailResponse(d.Id, d.Version, d.CurrencyCode, d.Net, d.Discount,
            d.Tax, d.Gross, d.TreatmentsConfigured, d.Lines.Select(l => new FinanceTaxLineResponse(l.Id, l.LineNumber,
                l.ConceptKind, l.ConceptCode, l.Description, l.Treatment, l.PolicyId, l.Rate, l.Basis, l.Net, l.Discount,
                l.Tax, l.Gross, l.Configured, l.Excluded)).ToArray()));
    }
    [HttpPost("preinvoices/{id:guid}/taxes", Name = "ApplyFinancePreinvoiceTaxes")]
    [ProducesResponseType<FinanceTaxIdResponse>(200)]
    public async Task<IActionResult> Apply(Guid id, FinanceTaxCommandRequest p, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.ApplyAsync(actor, id, new(p.RequestId, p.ExpectedVersion), ct));
    }
    private IActionResult Result(FinanceTaxWriteResult result, int success = 200) => result.IsSuccess
        ? StatusCode(success, new FinanceTaxIdResponse(result.Id!.Value)) : result.Code == "forbidden" ? Forbid()
        : Problem(statusCode: result.Code == "not_found" ? 404 : result.Code is "version_conflict" or "idempotency_conflict" or "ambiguous_tax_policy" ? 409 : 400,
            title: "No se pudo completar la operación de impuestos.", extensions: new Dictionary<string, object?> { ["code"] = result.Code });
}
