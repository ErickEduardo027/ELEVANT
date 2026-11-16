using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Finance reference data: billing units, the base service tariff, the charge
/// catalog and tariff, exchange rates, and the Finance approval of contracts.
/// Every command takes an Idempotency-Key, optional while older clients exist (expand):
/// with it the same key and body replay the first result and the same key with another
/// body is idempotency_conflict.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance")]
public sealed class FinanceTariffBookController(IFinanceTariffBookStore store) : ControllerBase
{
    [HttpGet("services", Name = "ListFinanceServiceOptions")]
    [ProducesResponseType<FinanceServiceOptionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Services(CancellationToken cancellationToken) =>
        ReadAsync(actor => store.ListServicesAsync(actor, cancellationToken));

    [HttpGet("billing-units", Name = "ListFinanceBillingUnits")]
    [ProducesResponseType<BillingUnitData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> BillingUnits(CancellationToken cancellationToken) =>
        ReadAsync(actor => store.ListBillingUnitsAsync(actor, cancellationToken));

    [HttpPost("billing-units", Name = "CreateFinanceBillingUnit")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> CreateBillingUnit([FromBody] SaveBillingUnitInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveBillingUnitAsync(actor, null, input, idempotencyKey, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("billing-units/{id:guid}", Name = "UpdateFinanceBillingUnit")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> UpdateBillingUnit(Guid id, [FromBody] SaveBillingUnitInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveBillingUnitAsync(actor, id, input, idempotencyKey, cancellationToken));

    [HttpGet("service-tariffs", Name = "ListFinanceServiceTariffs")]
    [ProducesResponseType<TariffVersionSummaryData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ServiceTariffs([FromQuery] string? currency, CancellationToken cancellationToken) =>
        ReadAsync(actor => store.ListServiceTariffsAsync(actor, currency, cancellationToken));

    [HttpGet("service-tariffs/{id:guid}", Name = "GetFinanceServiceTariff")]
    [ProducesResponseType<ServiceTariffVersionData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ServiceTariff(Guid id, CancellationToken cancellationToken) =>
        ReadAsync(actor => store.GetServiceTariffAsync(actor, id, cancellationToken));

    [HttpPost("service-tariffs", Name = "CreateFinanceServiceTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> CreateServiceTariff([FromBody] CreateTariffDraftInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.CreateServiceTariffDraftAsync(actor, input, idempotencyKey, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("service-tariffs/{id:guid}", Name = "SaveFinanceServiceTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(262144)]
    public Task<IActionResult> SaveServiceTariff(Guid id, [FromBody] SaveServiceTariffDraftInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveServiceTariffDraftAsync(actor, id, input, idempotencyKey, cancellationToken));

    [HttpPost("service-tariffs/{id:guid}/publish", Name = "PublishFinanceServiceTariff")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> PublishServiceTariff(Guid id, [FromBody] FinanceExpectedVersionInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.PublishServiceTariffAsync(actor, id, input.ExpectedVersion, idempotencyKey,
            cancellationToken));

    [HttpDelete("service-tariffs/{id:guid}", Name = "DeleteFinanceServiceTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> DeleteServiceTariff(Guid id, [FromQuery] string expectedVersion,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.DeleteServiceTariffDraftAsync(actor, id, expectedVersion, idempotencyKey,
            cancellationToken));

    [HttpGet("charges", Name = "ListFinanceCharges")]
    [ProducesResponseType<ChargeDefinitionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Charges(CancellationToken cancellationToken) =>
        ReadAsync(actor => store.ListChargesAsync(actor, cancellationToken));

    [HttpPost("charges", Name = "CreateFinanceCharge")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> CreateCharge([FromBody] SaveChargeDefinitionInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveChargeAsync(actor, null, input, idempotencyKey, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("charges/{id:guid}", Name = "UpdateFinanceCharge")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> UpdateCharge(Guid id, [FromBody] SaveChargeDefinitionInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveChargeAsync(actor, id, input, idempotencyKey, cancellationToken));

    [HttpGet("charge-tariffs", Name = "ListFinanceChargeTariffs")]
    [ProducesResponseType<TariffVersionSummaryData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ChargeTariffs([FromQuery] string? currency, CancellationToken cancellationToken) =>
        ReadAsync(actor => store.ListChargeTariffsAsync(actor, currency, cancellationToken));

    [HttpGet("charge-tariffs/{id:guid}", Name = "GetFinanceChargeTariff")]
    [ProducesResponseType<ChargeTariffVersionData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ChargeTariff(Guid id, CancellationToken cancellationToken) =>
        ReadAsync(actor => store.GetChargeTariffAsync(actor, id, cancellationToken));

    [HttpPost("charge-tariffs", Name = "CreateFinanceChargeTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> CreateChargeTariff([FromBody] CreateTariffDraftInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.CreateChargeTariffDraftAsync(actor, input, idempotencyKey, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("charge-tariffs/{id:guid}", Name = "SaveFinanceChargeTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(131072)]
    public Task<IActionResult> SaveChargeTariff(Guid id, [FromBody] SaveChargeTariffDraftInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveChargeTariffDraftAsync(actor, id, input, idempotencyKey, cancellationToken));

    [HttpPost("charge-tariffs/{id:guid}/publish", Name = "PublishFinanceChargeTariff")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> PublishChargeTariff(Guid id, [FromBody] FinanceExpectedVersionInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.PublishChargeTariffAsync(actor, id, input.ExpectedVersion, idempotencyKey,
            cancellationToken));

    [HttpDelete("charge-tariffs/{id:guid}", Name = "DeleteFinanceChargeTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> DeleteChargeTariff(Guid id, [FromQuery] string expectedVersion,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.DeleteChargeTariffDraftAsync(actor, id, expectedVersion, idempotencyKey,
            cancellationToken));

    [HttpGet("exchange-rates", Name = "ListFinanceExchangeRates")]
    [ProducesResponseType<ExchangeRateData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ExchangeRates([FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] bool includeHistory = false, CancellationToken cancellationToken = default) =>
        ReadAsync(actor => store.ListExchangeRatesAsync(actor, from, to, includeHistory, cancellationToken));

    [HttpPost("exchange-rates", Name = "RecordFinanceExchangeRate")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> RecordExchangeRate([FromBody] RecordExchangeRateInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.RecordExchangeRateAsync(actor, input, idempotencyKey, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPost("exchange-rates/{id:guid}/correction", Name = "CorrectFinanceExchangeRate")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> CorrectExchangeRate(Guid id, [FromBody] CorrectExchangeRateInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.CorrectExchangeRateAsync(actor, id, input, idempotencyKey, cancellationToken));

    [HttpGet("contract-approvals", Name = "ListFinanceContractApprovals")]
    [ProducesResponseType<ContractApprovalSummaryData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ContractApprovals([FromQuery] bool pendingOnly = true,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actor => store.ListContractApprovalsAsync(actor, pendingOnly, cancellationToken));

    [HttpGet("contract-approvals/{versionId:guid}", Name = "GetFinanceContractApproval")]
    [ProducesResponseType<ContractApprovalDetailData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ContractApproval(Guid versionId, CancellationToken cancellationToken) =>
        ReadAsync(actor => store.GetContractApprovalAsync(actor, versionId, cancellationToken));

    /// <summary>
    /// Finance approves the prices or returns the version to Contratos. Every failure carries a code,
    /// one per blocking cause (1-N07). The Idempotency-Key is optional while older clients exist
    /// (expand); with it the same key and body replay the first result.
    /// </summary>
    [HttpPost("contract-approvals/{versionId:guid}/decision", Name = "DecideFinanceContractApproval")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public async Task<IActionResult> DecideContractApproval(Guid versionId, [FromBody] DecideContractApprovalInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.DecideContractApprovalAsync(actorId, versionId, input, idempotencyKey, cancellationToken);
        return result.Failure switch
        {
            null => Ok(new FinanceIdResponse(result.Id!.Value)),
            FinanceCatalogFailure.Forbidden => Forbid(),
            FinanceCatalogFailure.NotFound => Coded(404, "El contrato ya no está pendiente en sus estaciones.",
                result.Code ?? "not_found"),
            FinanceCatalogFailure.Invalid => Coded(400, "La decisión no es válida.", result.Code ?? "invalid_contract_decision"),
            FinanceCatalogFailure.Conflict => Coded(409, "El contrato cambió o no se puede aprobar así.",
                result.Code ?? "version_conflict"),
            _ => throw new InvalidOperationException(),
        };
    }

    private async Task<IActionResult> ReadAsync<T>(Func<Guid, Task<T?>> query) where T : class
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await query(actorId);
        return result is null ? Forbid() : Ok(result);
    }

    /// <summary>
    /// Billing units, tariffs, charges and exchange rates answer every failure with a stable code
    /// (1-E); each kind of failure has a default code, so the code is never missing.
    /// </summary>
    private async Task<IActionResult> MutateAsync(Func<Guid, Task<FinanceCatalogResult>> command,
        int successStatus = StatusCodes.Status200OK)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await command(actorId);
        return result.Failure switch
        {
            null => StatusCode(successStatus, new FinanceIdResponse(result.Id!.Value)),
            FinanceCatalogFailure.Forbidden => Forbid(),
            FinanceCatalogFailure.NotFound => Coded(404, "El registro de Finanzas ya no existe.", result.Code ?? "not_found"),
            FinanceCatalogFailure.Invalid => Coded(400, "Los datos de Finanzas no son válidos.",
                result.Code ?? "invalid_finance_data"),
            FinanceCatalogFailure.Conflict => Coded(409, "El registro de Finanzas cambió o no admite el cambio.",
                result.Code ?? "version_conflict"),
            _ => throw new InvalidOperationException(),
        };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    // The clients explain the code, never the title.
    private ObjectResult Coded(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

public sealed record FinanceIdResponse(Guid Id);
public sealed record FinanceExpectedVersionInput(string ExpectedVersion);
