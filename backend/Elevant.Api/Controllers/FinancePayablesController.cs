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
[Route("api/v{version:apiVersion}/finance/payables")]
public sealed class FinancePayablesController(IFinancePayablesStore store) : FinancePayablesControllerBase
{
    [HttpGet(Name = "ListFinancePayables")]
    [ProducesResponseType<IReadOnlyList<FinancePayablesViewDto>>(200)]
    public async Task<IActionResult> List([FromQuery] FinancePayablesFilterDto filter, CancellationToken ct) => Respond(await store.ListInvoicesAsync(ActorId, ToData(filter), ct), x => x.Select(ToDto).ToArray());
    [HttpGet("{id:guid}", Name = "GetFinancePayable")]
    [ProducesResponseType<FinancePayablesViewDto>(200)]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct) => Respond(await store.GetInvoiceAsync(ActorId, id, ct), ToDto);
    [HttpPost(Name = "CreateFinancePayable"), RequestSizeLimit(131072)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Create([FromBody] FinancePayablesSaveDto input, CancellationToken ct) => Respond(await store.SaveInvoiceAsync(ActorId, null, ToData(input), ct), ToDto);
    [HttpPut("{id:guid}", Name = "UpdateFinancePayableDraft"), RequestSizeLimit(131072)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Update(Guid id, [FromBody] FinancePayablesSaveDto input, CancellationToken ct) => Respond(await store.SaveInvoiceAsync(ActorId, id, ToData(input), ct), ToDto);
    [HttpPost("{id:guid}/decisions", Name = "DecideFinancePayable"), RequestSizeLimit(8192)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public async Task<IActionResult> Decide(Guid id, [FromBody] FinancePayablesDecisionDto input, CancellationToken ct) => Respond(await store.DecideInvoiceAsync(ActorId, id, ToData(input), ct), ToDto);
    [HttpGet("options", Name = "GetFinancePayablesOptions")]
    [ProducesResponseType<FinancePayablesOptionsDto>(200)]
    public async Task<IActionResult> Options([FromQuery] Guid? scopeStationId, CancellationToken ct) => Respond(await store.OptionsAsync(ActorId, scopeStationId, ct), ToDto);
    [HttpPost("{id:guid}/attachments", Name = "UploadFinancePayableAttachment"), Consumes("multipart/form-data"), RequestSizeLimit(9 * 1024 * 1024)]
    [ProducesResponseType<FinancePayablesMutationDto>(200)]
    public Task<IActionResult> Upload(Guid id, [FromForm] Guid requestId, [FromForm] string expectedVersion, IFormFile file, CancellationToken ct) =>
        UploadAsync(store, id, false, requestId, expectedVersion, file, ct);
    [HttpGet("{id:guid}/attachments/{attachmentId:guid}", Name = "DownloadFinancePayableAttachment")]
    [ProducesResponseType<FileContentResult>(200)]
    public Task<IActionResult> Download(Guid id, Guid attachmentId, CancellationToken ct) => DownloadAsync(store, id, false, attachmentId, ct);
}
