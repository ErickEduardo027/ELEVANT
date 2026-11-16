using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;
using static Elevant.Api.Controllers.FinancePayablesContractMapper;
namespace Elevant.Api.Controllers;

[ApiController, ApiVersion("1.0"), Authorize, PrivateResponse]
[Route("api/v{version:apiVersion}/finance/suppliers")]
public sealed class SuppliersController(IFinancePayablesStore store) : FinancePayablesControllerBase
{
    [HttpGet(Name = "ListFinanceSuppliers")]
    [ProducesResponseType<IReadOnlyList<SupplierViewDto>>(200)]
    public async Task<IActionResult> List([FromQuery] FinancePayablesFilterDto filter, CancellationToken ct) =>
        Respond(await store.ListSuppliersAsync(ActorId, ToData(filter), ct), x => x.Select(ToDto).ToArray());
    [HttpGet("{id:guid}", Name = "GetFinanceSupplier")]
    [ProducesResponseType<SupplierViewDto>(200)]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Respond(await store.GetSupplierAsync(ActorId, id, ct), ToDto);
    [HttpPost(Name = "CreateFinanceSupplier"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Create([FromBody] SupplierSaveDto input, CancellationToken ct) => Respond(await store.SaveSupplierAsync(ActorId, null, ToData(input), ct), ToDto);
    [HttpPut("{id:guid}", Name = "UpdateFinanceSupplier"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Update(Guid id, [FromBody] SupplierSaveDto input, CancellationToken ct) => Respond(await store.SaveSupplierAsync(ActorId, id, ToData(input), ct), ToDto);
    /// <summary>Retires a supplier while preserving its invoices and payment history.</summary>
    [HttpDelete("{id:guid}", Name = "RetireFinanceSupplier"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Delete(Guid id, [FromBody] FinancePayablesDecisionDto input, CancellationToken ct) => Respond(await store.DeleteSupplierAsync(ActorId, id, ToData(input), ct), ToDto);
    [HttpGet("options", Name = "GetFinanceSupplierOptions")]
    [ProducesResponseType<FinancePayablesOptionsDto>(200)]
    public async Task<IActionResult> Options([FromQuery] Guid? scopeStationId, CancellationToken ct) => Respond(await store.OptionsAsync(ActorId, scopeStationId, ct), ToDto);
}
