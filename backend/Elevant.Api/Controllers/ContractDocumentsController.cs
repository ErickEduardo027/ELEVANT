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
/// detail, PDF and each party's signature. The store decides which party the caller signs for.
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
        return result.Failure is { } failure ? Failure<ContractDocumentResponse>(failure) : Ok(Map(result.Document!));
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
        if (result.Failure is { } failure) return Failure<object>(failure).Result!;
        var document = result.Document!;
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(renderer.Render(document), "application/pdf",
            $"contrato-{document.ContractCode}-v{document.VersionNumber}.pdf");
    }

    [HttpPost("signatures", Name = "SignContractVersion")]
    [RequestSizeLimit(2048)]
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
            request.SignerName, request.SignerTitle, request.DocumentSha256, request.Accepted), cancellationToken);
        return result.Failure is { } failure ? Failure<ContractDocumentResponse>(failure) : Ok(Map(result.Document!));
    }

    private static ContractDocumentResponse Map(ContractDocumentData item) => new(item.ContractId, item.VersionId,
        item.ContractCode, item.ContractStatus, item.AirlineName, item.AirlineCode, item.AirlineLegalName,
        item.VersionNumber, item.VersionStatus, item.ValidFrom, item.ValidTo, item.CurrencyCode, item.Stations,
        item.Rates.Select(rate => new ContractDocumentRateResponse(rate.ServiceCode, rate.ServiceName, rate.BillingUnit,
            rate.UnitPrice, rate.MinimumQuantity)).ToArray(),
        item.Terms, item.SignedOn,
        item.Signatures.Select(signature => new ContractDocumentSignatureResponse(signature.Party, signature.SignerName,
            signature.SignerTitle, signature.SignedAt, signature.DocumentSha256)).ToArray(),
        item.ContentSha256, item.SignableBy);

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return Problem<T>(401, "Authentication failed.");
    }

    private ActionResult<T> Failure<T>(ContractDocumentFailure failure) => failure switch
    {
        ContractDocumentFailure.Forbidden => Problem<T>(403, "Contract document access is forbidden."),
        ContractDocumentFailure.NotFound => Problem<T>(404, "The contract version has no document."),
        ContractDocumentFailure.Invalid => Problem<T>(400, "The signature request is invalid."),
        ContractDocumentFailure.AlreadySigned => Problem<T>(409, "This party already signed the version.", "already_signed"),
        _ => Problem<T>(409, "The contract changed; read it again before signing.", "content_changed"),
    };

    private ActionResult<T> Problem<T>(int status, string title, string? code = null)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
