using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/fiscal-documents")]
public sealed class FinanceFiscalDocumentsController(IFinanceFiscalStore store, IActorContextResolver actors,
    FinanceFiscalOptions options) : ControllerBase
{
    private Guid? Account => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) ? id : null;

    [HttpGet("status")]
    public async Task<ActionResult<FinanceFiscalStatusResponse>> Status(CancellationToken cancellationToken)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        var actor = await actors.ResolveAsync(account, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.fiscal.read") || !actor.Memberships.Any(m =>
            m.OrganizationType == OrganizationType.AviamOperator && m.Kind == MembershipKind.InternalStaff))
            return Failure(403, "Fiscal access is forbidden.");
        return Ok(new FinanceFiscalStatusResponse(options.Mode.ToString(), options.Environment,
            FinanceFiscalPolicy.ExecutionFailure(options) is null && actor.HasPermission("finance.fiscal.create") &&
            actor.HasPermission("finance.fiscal.simulate"), FinanceFiscalPolicy.Disclaimer, "NotPerformed",
            "ProviderSandbox blocked pending selected provider and approved configuration"));
    }
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FinanceFiscalDocumentResponse>>> List([FromQuery] Guid? stationId,
        [FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        var result = await store.ListAsync(account, stationId, take, cancellationToken);
        return result is null ? Failure(403, "Fiscal access is forbidden.") : Ok(result.Select(Map).ToArray());
    }
    [HttpGet("{documentId:guid}")]
    public async Task<ActionResult<FinanceFiscalDocumentResponse>> Get(Guid documentId, CancellationToken cancellationToken)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        var result = await store.GetAsync(account, documentId, cancellationToken);
        return result is null ? Failure(404, "Fiscal document was not found.") : Ok(Map(result));
    }
    [HttpGet("{documentId:guid}/status")]
    public Task<ActionResult<FinanceFiscalDocumentResponse>> DocumentStatus(Guid documentId, CancellationToken cancellationToken) =>
        Get(documentId, cancellationToken);

    [HttpGet("{documentId:guid}/artifacts")]
    public async Task<ActionResult<IReadOnlyList<FinanceFiscalArtifactResponse>>> Artifacts(Guid documentId, CancellationToken cancellationToken)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        var result = await store.GetAsync(account, documentId, cancellationToken);
        return result is null ? Failure(404, "Fiscal document was not found.") : Ok(Map(result).Artifacts);
    }
    [HttpGet("{documentId:guid}/artifacts/{artifactId:guid}")]
    public async Task<IActionResult> Download(Guid documentId, Guid artifactId, CancellationToken cancellationToken)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        var result = await store.DownloadAsync(account, documentId, artifactId, cancellationToken);
        if (result is null) return Failure(404, "Fiscal artifact was not found or its archive is incomplete.");
        Response.Headers.ETag = $"\"{result.Sha256}\"";
        return File(result.Bytes, result.ContentType, result.FileName);
    }
    [HttpPost]
    [RequestSizeLimit(2048)]
    public async Task<ActionResult<FinanceFiscalMutationResponse>> Create([FromBody] FinanceFiscalCreateRequest request,
        CancellationToken cancellationToken)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        if (!Enum.TryParse<FiscalSimulationOutcome>(request.Outcome, false, out var outcome) || !Enum.IsDefined(outcome))
            return Failure(400, "Unknown local simulation outcome.");
        var result = await store.CreateAsync(account, new(request.RequestId, request.InvoiceId, outcome), cancellationToken);
        return Mutation(result, created: true);
    }
    [HttpPost("{documentId:guid}/simulate")]
    [RequestSizeLimit(2048)]
    public async Task<ActionResult<FinanceFiscalMutationResponse>> Simulate(Guid documentId,
        [FromBody] FinanceFiscalSimulateRequest request, CancellationToken cancellationToken)
    {
        if (Account is not { } account) return Failure(401, "Authentication failed.");
        return Mutation(await store.SimulateAsync(account, documentId,
            new(request.RequestId, request.ExpectedVersion), cancellationToken));
    }
    private ActionResult<FinanceFiscalMutationResponse> Mutation(FiscalResult result, bool created = false)
    {
        if (result.IsSuccess) return StatusCode(created && !result.Replayed ? 201 : 200,
            new FinanceFiscalMutationResponse(result.DocumentId, result.Version, result.Replayed, null));
        var status = result.Failure switch
        {
            FinanceFiscalFailure.Invalid => 400, FinanceFiscalFailure.Forbidden => 403, FinanceFiscalFailure.NotFound => 404,
            FinanceFiscalFailure.Conflict => 409, FinanceFiscalFailure.ArchiveUnavailable => 503, _ => 409,
        };
        var problem = new ProblemDetails { Status = status, Title = result.Failure switch
        {
            FinanceFiscalFailure.Disabled => "Fiscal simulation is Off; no job was created.",
            FinanceFiscalFailure.ProviderNotConfigured => "ProviderSandbox is blocked pending provider configuration.",
            FinanceFiscalFailure.ArchiveUnavailable => "Private artifact archive failed; dispatch is blocked.",
            _ => "Fiscal request could not be completed.",
        }, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = result.Failure!.Value.ToString();
        problem.Extensions["documentId"] = result.DocumentId; problem.Extensions["version"] = result.Version;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
    private ObjectResult Failure(int status, string title)
    {
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        return new(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
    private static FinanceFiscalDocumentResponse Map(FiscalDocumentData d) => new(d.Id, d.InvoiceId, d.StationId,
        d.Mode, d.Environment, d.State, d.ArtifactCompletion, d.SnapshotHash, d.CanonicalSnapshot, d.Total, d.CurrencyCode,
        d.ProviderDocumentId, d.DgiiResponseId, d.Encf, d.Version, d.CreatedAt,
        d.Artifacts.Select(a => new FinanceFiscalArtifactResponse(a.Id, a.Kind, a.FileName, a.ContentType, a.Sha256, a.Length)).ToArray(),
        d.History.Select(e => new FinanceFiscalEventResponse(e.Id, e.Kind, e.State, e.ProviderSequence, e.Applied, e.Detail, e.OccurredAt)).ToArray(),
        FinanceFiscalPolicy.Disclaimer, "NotPerformed", false, false);
}
