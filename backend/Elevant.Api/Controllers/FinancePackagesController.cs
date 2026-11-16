using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController, ApiVersion("1.0"), Authorize, PrivateResponse]
[Route("api/v{version:apiVersion}")]
public sealed class FinancePackagesController(IFinancePackageStore store) : ControllerBase
{
    private const string PackageTitle = "La operación de paquetes no pudo completarse.";
    private const string AmendmentTitle = "La enmienda no pudo crearse.";

    /// <summary>Codes of a state, version or idempotency conflict: the client re-reads before a new attempt.</summary>
    private static readonly HashSet<string> ConflictCodes = new(StringComparer.Ordinal)
    {
        "version_conflict", "idempotency_conflict", "package_not_draft", "package_not_published", "package_retired",
        "draft_in_progress", "contract_not_amendable", "no_approved_version", "valid_from_not_after_current",
        "valid_from_after_current_end",
    };

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

    /// <summary>
    /// Finance discards a package draft with a reason (1-N27, <c>finance.packages.delete</c>); the draft is
    /// kept as Discarded. Idempotency-Key and the expected version are required.
    /// </summary>
    [HttpPost("finance/packages/{id:guid}/discard", Name = "DiscardFinancePackage"), RequestSizeLimit(8192)]
    [Consumes("application/json")]
    [ProducesResponseType<FinancePackageIdResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> Discard(Guid id, [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] FinancePackageLifecycleRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.DiscardAsync(actor, id, idempotencyKey, new(input.ExpectedVersion, input.Reason), ct));
    }

    /// <summary>
    /// Finance retires a published package with a reason (1-N27, <c>finance.packages.retire</c>): Contratos can
    /// no longer link it and Finance does not approve drafts that still do; approved contracts keep it.
    /// </summary>
    [HttpPost("finance/packages/{id:guid}/retire", Name = "RetireFinancePackage"), RequestSizeLimit(8192)]
    [Consumes("application/json")]
    [ProducesResponseType<FinancePackageIdResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> Retire(Guid id, [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] FinancePackageLifecycleRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.RetireAsync(actor, id, idempotencyKey, new(input.ExpectedVersion, input.Reason), ct));
    }

    [HttpPut("contracts/drafts/{versionId:guid}/packages", Name = "SetContractPackages")]
    [ProducesResponseType<FinancePackageIdResponse>(200)]
    public async Task<IActionResult> SetContractPackages(Guid versionId, SetContractPackagesRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.SetContractPackagesAsync(actor, versionId, new(input.RequestId, input.ExpectedVersion, input.PackageVersionIds), ct));
    }

    /// <summary>
    /// Contratos amends an active or suspended contract from any of its versions (1-C): a new draft from
    /// the latest approved version, starting on <c>validFrom</c> and ending when that version ends, with
    /// its rates unconfirmed. The token is the contract status the user saw. No client used the earlier
    /// shape, so the Idempotency-Key is required without an expand phase. Answers the new draft version.
    /// </summary>
    [HttpPost("contracts/versions/{versionId:guid}/amendments", Name = "CreateContractAmendment"), RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<FinancePackageIdResponse>(201, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> Amendment(Guid versionId, [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] CreateContractAmendmentRequest input, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthorized();
        return Result(await store.CreateAmendmentAsync(actor, versionId, idempotencyKey,
            new(input.ExpectedStatus, input.ValidFrom), ct), 201, AmendmentTitle);
    }

    private IActionResult Result(PackageWriteResult result, int success = 200, string title = PackageTitle)
    {
        if (result.IsSuccess) return StatusCode(success, new FinancePackageIdResponse(result.Id!.Value));
        if (result.Code == "forbidden") return Forbid();
        var code = result.Code ?? "invalid_package";
        var status = code == "not_found" ? 404 : ConflictCodes.Contains(code) ? 409 : 400;
        // The clients explain the code, never the title.
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
    private bool Actor(out Guid id) => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out id);
    private static FinancePackageResponse Map(PackageData x) => new(x.Id, x.Code, x.Name, x.VersionNumber, x.Status, x.CurrencyCode, x.BasePrice, x.Scope, x.FlightDirection, x.PeriodDays, x.ValidFrom, x.ValidTo, x.Version, x.Components.Select(c => new FinancePackageComponentResponse(c.ServiceId, c.ServiceCode, c.ServiceName, c.BillingUnit, c.IncludedQuantity, c.ExcessBlockSize, c.ExcessBlockPrice)).ToArray());
}
