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
[Route("api/v{version:apiVersion}")]
public sealed class FinancePackagesController(IFinancePackageStore store) : ControllerBase
{
    [HttpGet("finance/packages", Name = "ListFinancePackages")]
    [ProducesResponseType<FinancePackageResponse[]>(200)]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        if (!Actor(out var id)) return Unauthorized();
        var result = await store.ListAsync(id, ct);
        return result is null ? Forbid() : Ok(result.Select(Map));
    }
    [HttpGet("contracts/drafts/{versionId:guid}/packages", Name = "ListContractPackages")]
    [ProducesResponseType<FinancePackageResponse[]>(200)]
    public async Task<IActionResult> ContractPackages(Guid versionId, CancellationToken ct)
    {
        if (!Actor(out var id)) return Unauthorized();
        var result = await store.ListForContractAsync(id, versionId, ct);
        return result is null ? Forbid() : Ok(result.Select(Map));
    }
    [HttpPost("finance/packages", Name = "CreateFinancePackage"), RequestSizeLimit(131072)]
    [ProducesResponseType<FinancePackageIdResponse>(201)]
    public Task<IActionResult> Create(SaveFinancePackageRequest input, CancellationToken ct) => Save(null, input, ct);
    [HttpPut("finance/packages/{id:guid}", Name = "UpdateFinancePackage"), RequestSizeLimit(131072)]
    [ProducesResponseType<FinancePackageIdResponse>(200)]
    public Task<IActionResult> Update(Guid id, SaveFinancePackageRequest input, CancellationToken ct) => Save(id, input, ct);
    private async Task<IActionResult> Save(Guid? id, SaveFinancePackageRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.SaveAsync(actor, id, new(input.RequestId, input.Code, input.Name, input.CurrencyCode, input.BasePrice, input.Scope, input.FlightDirection, input.PeriodDays, input.ValidFrom, input.ValidTo, input.Components?.Select(x => new PackageComponentInput(x.ServiceId, x.BillingUnit, x.IncludedQuantity, x.ExcessBlockSize, x.ExcessBlockPrice)).ToArray()!, input.ExpectedVersion), ct), id is null ? 201 : 200);
    }
    [HttpPost("finance/packages/{id:guid}/publish", Name = "PublishFinancePackage")]
    [ProducesResponseType<FinancePackageIdResponse>(200)]
    public async Task<IActionResult> Publish(Guid id, FinancePackageCommandRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.PublishAsync(actor, id, new(input.RequestId, input.ExpectedVersion), ct));
    }
    [HttpPut("contracts/drafts/{versionId:guid}/packages", Name = "SetContractPackages")]
    [ProducesResponseType<FinancePackageIdResponse>(200)]
    public async Task<IActionResult> SetContractPackages(Guid versionId, SetContractPackagesRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.SetContractPackagesAsync(actor, versionId, new(input.RequestId, input.ExpectedVersion, input.PackageVersionIds), ct));
    }
    [HttpPost("contracts/versions/{versionId:guid}/amendments", Name = "CreateContractAmendment")]
    [ProducesResponseType<FinancePackageIdResponse>(201)]
    public async Task<IActionResult> Amendment(Guid versionId, FinancePackageCommandRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.CreateAmendmentAsync(actor, versionId, new(input.RequestId, input.ExpectedVersion), ct), 201);
    }
    private IActionResult Result(PackageWriteResult result, int success = 200)
    {
        if (result.IsSuccess) return StatusCode(success, new FinancePackageIdResponse(result.Id!.Value));
        if (result.Code == "forbidden") return Forbid();
        return Problem(statusCode: result.Code == "not_found" ? 404 : result.Code is "version_conflict" or "idempotency_conflict" ? 409 : 400, title: "La operación de paquetes no pudo completarse.", extensions: new Dictionary<string, object?> { ["code"] = result.Code });
    }
    private bool Actor(out Guid id) => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out id);
    private static FinancePackageResponse Map(PackageData x) => new(x.Id, x.Code, x.Name, x.VersionNumber, x.Status, x.CurrencyCode, x.BasePrice, x.Scope, x.FlightDirection, x.PeriodDays, x.ValidFrom, x.ValidTo, x.Version, x.Components.Select(c => new FinancePackageComponentResponse(c.ServiceId, c.ServiceCode, c.ServiceName, c.BillingUnit, c.IncludedQuantity, c.ExcessBlockSize, c.ExcessBlockPrice)).ToArray());
}
