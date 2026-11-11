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
[Route("api/v{version:apiVersion}/finance/expenses")]
public sealed class EmployeeExpensesController(IFinancePayablesStore store) : FinancePayablesControllerBase
{
    [HttpGet(Name = "ListEmployeeExpenses")]
    [ProducesResponseType<IReadOnlyList<EmployeeExpenseViewDto>>(200)]
    public async Task<IActionResult> List([FromQuery] FinancePayablesFilterDto filter, CancellationToken ct) => Respond(await store.ListExpensesAsync(ActorId, ToData(filter), ct), x => x.Select(ToDto).ToArray());
    [HttpGet("{id:guid}", Name = "GetEmployeeExpense")]
    [ProducesResponseType<EmployeeExpenseViewDto>(200)]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Respond(await store.GetExpenseAsync(ActorId, id, ct), ToDto);
    [HttpPost(Name = "CreateEmployeeExpense"), RequestSizeLimit(131072)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Create([FromBody] EmployeeExpenseSaveDto input, CancellationToken ct) => Respond(await store.SaveExpenseAsync(ActorId, null, ToData(input), ct), ToDto);
    [HttpPut("{id:guid}", Name = "UpdateEmployeeExpenseDraft"), RequestSizeLimit(131072)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Update(Guid id, [FromBody] EmployeeExpenseSaveDto input, CancellationToken ct) => Respond(await store.SaveExpenseAsync(ActorId, id, ToData(input), ct), ToDto);
    [HttpPost("{id:guid}/decisions", Name = "DecideEmployeeExpense"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Decide(Guid id, [FromBody] FinancePayablesDecisionDto input, CancellationToken ct) => Respond(await store.DecideExpenseAsync(ActorId, id, ToData(input), ct), ToDto);
    [HttpPost("{id:guid}/reimbursements", Name = "ReimburseEmployeeExpense"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Reimburse(Guid id, [FromBody] EmployeeExpensePaymentSaveDto input, CancellationToken ct) => Respond(await store.ReimburseExpenseAsync(ActorId, id, ToData(input), ct), ToDto);
    [HttpGet("options", Name = "GetEmployeeExpenseOptions")]
    [ProducesResponseType<FinancePayablesOptionsDto>(200)]
    public async Task<IActionResult> Options([FromQuery] Guid? scopeStationId, CancellationToken ct) => Respond(await store.OptionsAsync(ActorId, scopeStationId, ct), ToDto);
    [HttpPost("{id:guid}/attachments", Name = "UploadEmployeeExpenseReceipt"), Consumes("multipart/form-data"), RequestSizeLimit(9 * 1024 * 1024)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public Task<IActionResult> Upload(Guid id, [FromForm] Guid requestId, [FromForm] string expectedVersion, IFormFile file, CancellationToken ct) =>
        UploadAsync(store, id, true, requestId, expectedVersion, file, ct);
    [HttpGet("{id:guid}/attachments/{attachmentId:guid}", Name = "DownloadEmployeeExpenseReceipt")]
    [ProducesResponseType<FileContentResult>(200)]
    public Task<IActionResult> Download(Guid id, Guid attachmentId, CancellationToken ct) => DownloadAsync(store, id, true, attachmentId, ct);
    /// <summary>
    /// 4-N13: the requester removes a receipt from its draft expense. It is no longer shown, downloaded nor counted; its
    /// bytes are erased only when no submission ever included it.
    /// </summary>
    [HttpPost("{id:guid}/attachments/{attachmentId:guid}/removals", Name = "RemoveEmployeeExpenseReceipt"), RequestSizeLimit(4096)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> RemoveReceipt(Guid id, Guid attachmentId, [FromBody] FinancePayablesAttachmentRemovalDto input, CancellationToken ct) =>
        Respond(await store.RemoveAttachmentAsync(ActorId, id, true, attachmentId, ToData(input), ct), ToDto);
}
