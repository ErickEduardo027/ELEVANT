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
[Route("api/v{version:apiVersion}/finance/payable-payments")]
public sealed class FinancePayablesPaymentsController(IFinancePayablesStore store) : FinancePayablesControllerBase
{
    [HttpGet(Name = "ListFinancePayablePayments")]
    [ProducesResponseType<IReadOnlyList<FinancePayablesPaymentViewDto>>(200)]
    public async Task<IActionResult> List([FromQuery] FinancePayablesFilterDto filter, CancellationToken ct) => Respond(await store.ListPaymentsAsync(ActorId, ToData(filter), ct), x => x.Select(ToDto).ToArray());
    [HttpGet("{id:guid}", Name = "GetFinancePayablePayment")]
    [ProducesResponseType<FinancePayablesPaymentViewDto>(200)]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Respond(await store.GetPaymentAsync(ActorId, id, ct), ToDto);
    [HttpPost(Name = "RecordFinancePayablePayment"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Create([FromBody] FinancePayablesPaymentSaveDto input, CancellationToken ct) => Respond(await store.RecordPaymentAsync(ActorId, ToData(input), ct), ToDto);
    [HttpPost("{id:guid}/applications", Name = "ApplyFinancePayablePayment"), RequestSizeLimit(65536)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Apply(Guid id, [FromBody] FinancePayablesApplyDto input, CancellationToken ct) => Respond(await store.ApplyPaymentAsync(ActorId, id, ToData(input), ct), ToDto);
    /// <summary>
    /// 4-N04: reverses one application of the payment (<c>applicationId</c>) or voids the whole payment once nothing of it is
    /// applied, as a linked and immutable row with its reason; it needs <c>finance.payables.reverse</c>.
    /// </summary>
    [HttpPost("{id:guid}/reversals", Name = "ReverseFinancePayablePayment"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Reverse(Guid id, [FromBody] FinancePayablesReversalDto input, CancellationToken ct) => Respond(await store.ReversePaymentAsync(ActorId, id, ToData(input), ct), ToDto);
}
