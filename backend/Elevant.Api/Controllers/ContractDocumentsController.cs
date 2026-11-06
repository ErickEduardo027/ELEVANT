using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Formal document of an approved contract version for AVIAM staff and the contract's airline:
/// detail, PDF, surcharges and packages, each party's signature and the withdrawal of a version both
/// parties have not signed. The store decides which party the caller signs for. Every failure is a
/// Problem Details with a stable code and a Spanish title.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/contract-versions/{versionId:guid}")]
public sealed class ContractDocumentsController(IContractDocumentStore store, IContractPdfRenderer renderer)
    : ControllerBase
{
    [HttpGet("document", Name = "GetContractDocument")]
    [ProducesResponseType<ContractDocumentResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<ContractDocumentResponse>> Get([FromRoute] Guid versionId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ContractDocumentResponse>();
        var result = await store.ReadAsync(actorId, versionId, cancellationToken);
        return result.Failure is { } failure ? Failure<ContractDocumentResponse>(failure, result.Code) : Ok(Map(result.Document!));
    }

    /// <summary>
    /// Surcharges and packages that apply to the version (2-N04), for the same readers as the document:
    /// whether they are part of its signed content and whether both parties signed it.
    /// </summary>
    [HttpGet("pricing-terms", Name = "GetContractPricingTerms")]
    [ProducesResponseType<ContractPricingTermsResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<ContractPricingTermsResponse>> PricingTerms([FromRoute] Guid versionId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ContractPricingTermsResponse>();
        var result = await store.ReadPricingTermsAsync(actorId, versionId, cancellationToken);
        if (result.Failure is { } failure) return Failure<ContractPricingTermsResponse>(failure);
        var terms = result.Terms!;
        return Ok(new ContractPricingTermsResponse(terms.VersionId, terms.CurrencyCode, terms.InDocument, terms.Signed,
            terms.Charges.Select(charge => new ContractPricingChargeResponse(charge.ChargeCode, charge.ChargeName,
                charge.Method, charge.BillingUnit, charge.QuantityRule, charge.GraceMinutes, charge.RoundingIncrement,
                charge.IsExcluded, charge.Value, charge.MinimumAmount)).ToArray(),
            terms.Packages.Select(package => new ContractPricingPackageResponse(package.Code, package.Name,
                package.VersionNumber, package.Scope, package.FlightDirection, package.PeriodDays, package.BasePrice,
                package.CurrencyCode, package.Components.Select(component => new ContractPricingPackageComponentResponse(
                    component.ServiceCode, component.ServiceName, component.BillingUnit, component.IncludedQuantity,
                    component.ExcessBlockSize, component.ExcessBlockPrice)).ToArray())).ToArray()));
    }

    /// <summary>
    /// Contratos withdraws, with a reason, an approved version both parties have not signed (2-N10): it
    /// becomes Rejected and keeps its approval; a one-party signature is voided in the audit trail.
    /// </summary>
    [HttpPost("withdrawal", Name = "WithdrawContractVersion")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<ContractWithdrawalResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<ContractWithdrawalResponse>> Withdraw([FromRoute] Guid versionId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] WithdrawContractVersionRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ContractWithdrawalResponse>();
        var result = await store.WithdrawAsync(actorId, versionId,
            new WithdrawContractVersionInput(request.Reason, request.ExpectedDocumentSha256), idempotencyKey,
            cancellationToken);
        if (result.Failure is { } failure) return Failure<ContractWithdrawalResponse>(failure, result.Code);
        var withdrawal = result.Withdrawal!;
        return Ok(new ContractWithdrawalResponse(withdrawal.VersionId, withdrawal.VersionStatus, withdrawal.ContractStatus,
            withdrawal.DraftVersionId));
    }

    [HttpGet("document/pdf", Name = "DownloadContractDocument")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<IActionResult> Pdf([FromRoute] Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<object>().Result!;
        var result = await store.ReadAsync(actorId, versionId, cancellationToken);
        if (result.Failure is { } failure) return Failure<object>(failure, result.Code).Result!;
        var document = result.Document!;
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(renderer.Render(document), "application/pdf",
            $"contrato-{document.ContractCode}-v{document.VersionNumber}.pdf");
    }

    /// <summary>Review PDF of a draft version, watermarked «BORRADOR» and never signable.</summary>
    [HttpGet("draft/pdf", Name = "DownloadContractDraftPdf")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<IActionResult> DraftPdf([FromRoute] Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<object>().Result!;
        var result = await store.ReadDraftAsync(actorId, versionId, cancellationToken);
        if (result.Failure is { } failure) return Failure<object>(failure, result.Code).Result!;
        var document = result.Document!;
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(renderer.Render(document), "application/pdf",
            $"borrador-{document.ContractCode}-v{document.VersionNumber}.pdf");
    }

    [HttpPost("signatures", Name = "SignContractVersion")]
    // Room for the drawn PNG (256 KB, base64) plus the rest of the body.
    [RequestSizeLimit(400_000)]
    [Consumes("application/json")]
    [ProducesResponseType<ContractDocumentResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<ContractDocumentResponse>> Sign([FromRoute] Guid versionId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] SignContractRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ContractDocumentResponse>();
        var result = await store.SignAsync(actorId, versionId, new SignContractInput(idempotencyKey,
            request.SignerName, request.SignerTitle, request.DocumentSha256, request.Accepted, request.SignatureImagePng),
            cancellationToken);
        return result.Failure is { } failure
            ? Failure<ContractDocumentResponse>(failure, result.Code) : Ok(Map(result.Document!));
    }

    /// <summary>
    /// Contratos confirms validity, renewal and termination of an approved version before anyone
    /// signs it, and the contract gets its final code (ADR-0025). The Idempotency-Key is optional while
    /// older clients exist (expand); with it a retry replays the first result.
    /// </summary>
    [HttpPut("validity", Name = "SetContractValidity")]
    [RequestSizeLimit(16_384)]
    [Consumes("application/json")]
    [ProducesResponseType<ContractDocumentResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<ContractDocumentResponse>> SetValidity([FromRoute] Guid versionId,
        [FromBody, BindRequired] SetContractValidityRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ContractDocumentResponse>();
        var result = await store.SetValidityAsync(actorId, versionId, new ContractValidityInput(request.ValidFrom,
            request.ValidTo, request.RenewalMode, request.RenewalTermMonths, request.RenewalNoticeDays,
            request.TerminationNoticeDays, request.TerminationTerms, request.ExpectedDocumentSha256), idempotencyKey,
            cancellationToken);
        return result.Failure is { } failure
            ? Failure<ContractDocumentResponse>(failure, result.Code) : Ok(Map(result.Document!));
    }

    private static ContractDocumentResponse Map(ContractDocumentData item) => new(item.ContractId, item.VersionId,
        item.ContractCode, item.ContractStatus, item.AirlineName, item.AirlineCode, item.AirlineLegalName,
        item.VersionNumber, item.VersionStatus, item.ValidFrom, item.ValidTo, item.CurrencyCode, item.Stations,
        item.Rates.Select(rate => new ContractDocumentRateResponse(rate.ServiceCode, rate.ServiceName, rate.BillingUnit,
            rate.UnitPrice, rate.MinimumQuantity)).ToArray(),
        item.Terms, item.SignedOn,
        item.Signatures.Select(signature => new ContractDocumentSignatureResponse(signature.Party, signature.SignerName,
            signature.SignerTitle, signature.SignedAt, signature.DocumentSha256, signature.Image is { Length: > 0 })).ToArray(),
        item.ContentSha256, item.SignableBy,
        item.Validity is { } validity
            ? new ContractValidityResponse(validity.RenewalMode, validity.RenewalTermMonths, validity.RenewalNoticeDays,
                validity.TerminationNoticeDays, validity.TerminationTerms, validity.ConfirmedAt)
            : null);

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return Problem<T>(401, "La sesión no es válida.");
    }

    private ActionResult<T> Failure<T>(ContractDocumentFailure failure, string? code = null) => failure switch
    {
        ContractDocumentFailure.Forbidden => Problem<T>(403, "No tiene acceso a este contrato.", "forbidden"),
        ContractDocumentFailure.NotFound => Problem<T>(404, "La versión del contrato no tiene documento.", "not_found"),
        ContractDocumentFailure.Invalid => Problem<T>(400, "Revise los datos del contrato.", code ?? "invalid_contract_document"),
        ContractDocumentFailure.AirlineSignaturePending =>
            Problem<T>(409, "AVIAM contrafirma después de la aerolínea.", "airline_signature_pending"),
        ContractDocumentFailure.ValidityPending =>
            Problem<T>(409, "Contratos todavía no fijó la vigencia y la renovación.", "validity_pending"),
        ContractDocumentFailure.Conflict when code is not null =>
            Problem<T>(409, "El contrato cambió; vuelva a leerlo.", code),
        ContractDocumentFailure.AlreadySigned => Problem<T>(409, "Esta parte ya firmó la versión.", "already_signed"),
        _ => Problem<T>(409, "El contrato cambió; vuelva a leerlo antes de firmar.", "content_changed"),
    };

    private ActionResult<T> Problem<T>(int status, string title, string? code = null)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
