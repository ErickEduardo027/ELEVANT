using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}")]
public sealed class ContractSigningController(IContractSigningStore store) : ControllerBase
{
    [HttpGet("contracts/signing/aviam-signers", Name = "ListAviamContractSigners")]
    [ProducesResponseType<ContractSignerOptionResponse[]>(200, "application/json")]
    public async Task<IActionResult> AviamSigners(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ListAviamSignersAsync(actorId, cancellationToken);
        return result.IsSuccess ? Ok(result.Value!.Select(item =>
            new ContractSignerOptionResponse(item.AccountId, item.Name, item.Email)).ToArray())
            : Fail(result.Failure!.Value);
    }

    [HttpGet("contracts/signing", Name = "ListManagedContractSigning")]
    [ProducesResponseType<ContractSigningResponse[]>(200, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ListManagedAsync(actorId, cancellationToken);
        return result.IsSuccess ? Ok(result.Value!.Select(Map).ToArray()) : Fail(result.Failure!.Value);
    }

    [HttpGet("contracts/signing/{versionId:guid}", Name = "GetManagedContractSigning")]
    [ProducesResponseType<ContractSigningResponse>(200, "application/json")]
    public async Task<IActionResult> GetManaged(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetManagedAsync(actorId, versionId, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpPut("contracts/signing/{versionId:guid}/signers", Name = "SetContractSigners")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<ContractSigningResponse>(200, "application/json")]
    public async Task<IActionResult> SetSigners(Guid versionId,
        [FromBody] SetContractSignersRequest request, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SetSignersAsync(actorId, versionId,
            request.AviamSignerAccountId, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpPost("contracts/signing/{versionId:guid}/preview", Name = "PreviewContractSigningPdf")]
    [ProducesResponseType<byte[]>(200, "application/pdf")]
    public async Task<IActionResult> Preview(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.PreviewAsync(actorId, versionId, cancellationToken);
        return result.IsSuccess ? File(result.Value!, "application/pdf") : Fail(result.Failure!.Value);
    }

    [HttpGet("contracts/signing/{versionId:guid}/draft-document", Name = "GetManagedContractDraftPdf")]
    [ProducesResponseType<byte[]>(200, "application/pdf")]
    public async Task<IActionResult> ManagedDraft(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetManagedDraftAsync(actorId, versionId, cancellationToken);
        if (!result.IsSuccess) return Fail(result.Failure!.Value);
        Response.Headers.ContentDisposition = "inline; filename=contract-draft.pdf";
        return File(result.Value!, "application/pdf");
    }

    [HttpPost("contracts/signing/{versionId:guid}/issue", Name = "IssueContractSigning")]
    [ProducesResponseType<ContractSigningResponse>(200, "application/json")]
    public async Task<IActionResult> Issue(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.IssueAsync(actorId, versionId, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpPost("contracts/signing/{versionId:guid}/accept-aviam", Name = "AcceptAviamContract")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<ContractSigningResponse>(200, "application/json")]
    public async Task<IActionResult> AcceptAviam(Guid versionId,
        [FromBody] AcceptContractRequest request, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.AcceptAviamAsync(actorId, versionId, request.RequestId,
            request.ExpectedDraftSha256, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpGet("airline/portal/contracts/{contractId:guid}/signing", Name = "GetAirlineContractSigning")]
    [ProducesResponseType<ContractSigningResponse>(200, "application/json")]
    public async Task<IActionResult> GetAirline(Guid contractId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetAirlineAsync(actorId, contractId, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpGet("airline/portal/contracts/{contractId:guid}/signing-link", Name = "GetAirlineContractSigningLink")]
    [ProducesResponseType<ContractSigningLinkResponse>(200, "application/json")]
    public async Task<IActionResult> SigningLink(Guid contractId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetAirlineSigningUrlAsync(actorId, contractId, cancellationToken);
        return result.IsSuccess ? Ok(new ContractSigningLinkResponse(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpGet("airline/portal/contracts/{contractId:guid}/draft-document", Name = "GetAirlineContractDraftPdf")]
    [ProducesResponseType<byte[]>(200, "application/pdf")]
    public async Task<IActionResult> AirlineDraft(Guid contractId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetAirlineDraftAsync(actorId, contractId, cancellationToken);
        if (!result.IsSuccess) return Fail(result.Failure!.Value);
        Response.Headers.ContentDisposition = "inline; filename=contract-draft.pdf";
        return File(result.Value!, "application/pdf");
    }

    [HttpPost("airline/portal/contracts/{contractId:guid}/accept", Name = "AcceptAirlineContract")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<ContractSigningResponse>(200, "application/json")]
    public async Task<IActionResult> AcceptAirline(Guid contractId,
        [FromBody] AcceptContractRequest request, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.AcceptAirlineAsync(actorId, contractId, request.RequestId,
            request.ExpectedDraftSha256, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : Fail(result.Failure!.Value);
    }

    [HttpGet("airline/portal/contracts/{contractId:guid}/document", Name = "GetAirlineSignedContractPdf")]
    [ProducesResponseType<byte[]>(200, "application/pdf")]
    public async Task<IActionResult> Document(Guid contractId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetFinalPdfAsync(actorId, contractId, cancellationToken);
        if (!result.IsSuccess) return Fail(result.Failure!.Value);
        Response.Headers.ContentDisposition = "inline; filename=contract.pdf";
        return File(result.Value!, "application/pdf");
    }

    [HttpGet("contracts/signing/{versionId:guid}/document", Name = "GetManagedSignedContractPdf")]
    [ProducesResponseType<byte[]>(200, "application/pdf")]
    public Task<IActionResult> ManagedDocument(Guid versionId, CancellationToken cancellationToken) =>
        ManagedEvidence(versionId, false, cancellationToken);

    [HttpGet("contracts/signing/{versionId:guid}/audit", Name = "GetManagedContractAuditPdf")]
    [ProducesResponseType<byte[]>(200, "application/pdf")]
    public Task<IActionResult> ManagedAudit(Guid versionId, CancellationToken cancellationToken) =>
        ManagedEvidence(versionId, true, cancellationToken);

    private async Task<IActionResult> ManagedEvidence(Guid versionId, bool audit,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetManagedEvidenceAsync(actorId, versionId, audit,
            cancellationToken);
        if (!result.IsSuccess) return Fail(result.Failure!.Value);
        Response.Headers.ContentDisposition = audit
            ? "inline; filename=contract-audit.pdf" : "inline; filename=contract.pdf";
        return File(result.Value!, "application/pdf");
    }

    private bool TryActor(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) &&
        actorId != Guid.Empty;

    private IActionResult Fail(ContractSigningFailure failure) => failure switch
    {
        ContractSigningFailure.Forbidden => Forbid(),
        ContractSigningFailure.NotFound => Problem(statusCode: 404, title: "Contract not found."),
        ContractSigningFailure.Conflict => Problem(statusCode: 409, title: "Contract signing state conflict."),
        ContractSigningFailure.Invalid => Problem(statusCode: 400, title: "Invalid signer selection."),
        ContractSigningFailure.Unavailable => Problem(statusCode: 503, title: "Contract issuance is disabled."),
        ContractSigningFailure.Corrupt => Problem(statusCode: 503, title: "Contract evidence unavailable."),
        _ => throw new InvalidOperationException(),
    };

    private static ContractSigningResponse Map(ContractSigningSummary item) => new(
        item.ContractId, item.VersionId, item.ContractCode, item.AirlineName,
        item.VersionStatus, item.SigningStatus, item.RequiresElectronicSigning,
        item.AviamSignerAccountId, item.AviamSignerEmail,
        item.AirlineSignerAccountId, item.AirlineSignerEmail,
        item.IssuedAt, item.FormalizedAt, item.DraftSha256,
        item.SignedSha256, item.AuditSha256,
        item.LastCheckedAt, item.NextCheckAt, item.SigningMethod,
        item.AviamAcceptedAt, item.AirlineAcceptedAt);
}
