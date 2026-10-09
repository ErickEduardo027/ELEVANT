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
    public Task<IActionResult> CreateBillingUnit([FromBody] SaveBillingUnitInput input, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveBillingUnitAsync(actor, null, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPut("billing-units/{id:guid}", Name = "UpdateFinanceBillingUnit")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> UpdateBillingUnit(Guid id, [FromBody] SaveBillingUnitInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveBillingUnitAsync(actor, id, input, cancellationToken));

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
    public Task<IActionResult> CreateServiceTariff([FromBody] CreateTariffDraftInput input, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.CreateServiceTariffDraftAsync(actor, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPut("service-tariffs/{id:guid}", Name = "SaveFinanceServiceTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(262144)]
    public Task<IActionResult> SaveServiceTariff(Guid id, [FromBody] SaveServiceTariffDraftInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveServiceTariffDraftAsync(actor, id, input, cancellationToken));

    [HttpPost("service-tariffs/{id:guid}/publish", Name = "PublishFinanceServiceTariff")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> PublishServiceTariff(Guid id, [FromBody] FinanceExpectedVersionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.PublishServiceTariffAsync(actor, id, input.ExpectedVersion, cancellationToken));

    [HttpDelete("service-tariffs/{id:guid}", Name = "DeleteFinanceServiceTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> DeleteServiceTariff(Guid id, [FromQuery] string expectedVersion,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.DeleteServiceTariffDraftAsync(actor, id, expectedVersion, cancellationToken));

    [HttpGet("charges", Name = "ListFinanceCharges")]
    [ProducesResponseType<ChargeDefinitionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Charges(CancellationToken cancellationToken) =>
        ReadAsync(actor => store.ListChargesAsync(actor, cancellationToken));

    [HttpPost("charges", Name = "CreateFinanceCharge")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> CreateCharge([FromBody] SaveChargeDefinitionInput input, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveChargeAsync(actor, null, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPut("charges/{id:guid}", Name = "UpdateFinanceCharge")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> UpdateCharge(Guid id, [FromBody] SaveChargeDefinitionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveChargeAsync(actor, id, input, cancellationToken));

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
    public Task<IActionResult> CreateChargeTariff([FromBody] CreateTariffDraftInput input, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.CreateChargeTariffDraftAsync(actor, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPut("charge-tariffs/{id:guid}", Name = "SaveFinanceChargeTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(131072)]
    public Task<IActionResult> SaveChargeTariff(Guid id, [FromBody] SaveChargeTariffDraftInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.SaveChargeTariffDraftAsync(actor, id, input, cancellationToken));

    [HttpPost("charge-tariffs/{id:guid}/publish", Name = "PublishFinanceChargeTariff")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> PublishChargeTariff(Guid id, [FromBody] FinanceExpectedVersionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.PublishChargeTariffAsync(actor, id, input.ExpectedVersion, cancellationToken));

    [HttpDelete("charge-tariffs/{id:guid}", Name = "DeleteFinanceChargeTariffDraft")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> DeleteChargeTariff(Guid id, [FromQuery] string expectedVersion,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.DeleteChargeTariffDraftAsync(actor, id, expectedVersion, cancellationToken));

    [HttpGet("exchange-rates", Name = "ListFinanceExchangeRates")]
    [ProducesResponseType<ExchangeRateData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ExchangeRates([FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] bool includeHistory = false, CancellationToken cancellationToken = default) =>
        ReadAsync(actor => store.ListExchangeRatesAsync(actor, from, to, includeHistory, cancellationToken));

    [HttpPost("exchange-rates", Name = "RecordFinanceExchangeRate")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> RecordExchangeRate([FromBody] RecordExchangeRateInput input, CancellationToken cancellationToken) =>
        MutateAsync(actor => store.RecordExchangeRateAsync(actor, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPost("exchange-rates/{id:guid}/correction", Name = "CorrectFinanceExchangeRate")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> CorrectExchangeRate(Guid id, [FromBody] CorrectExchangeRateInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.CorrectExchangeRateAsync(actor, id, input, cancellationToken));

    [HttpGet("contract-approvals", Name = "ListFinanceContractApprovals")]
    [ProducesResponseType<ContractApprovalSummaryData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ContractApprovals([FromQuery] bool pendingOnly = true,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actor => store.ListContractApprovalsAsync(actor, pendingOnly, cancellationToken));

    [HttpGet("contract-approvals/{versionId:guid}", Name = "GetFinanceContractApproval")]
    [ProducesResponseType<ContractApprovalDetailData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ContractApproval(Guid versionId, CancellationToken cancellationToken) =>
        ReadAsync(actor => store.GetContractApprovalAsync(actor, versionId, cancellationToken));

    [HttpPost("contract-approvals/{versionId:guid}/decision", Name = "DecideFinanceContractApproval")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> DecideContractApproval(Guid versionId, [FromBody] DecideContractApprovalInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actor => store.DecideContractApprovalAsync(actor, versionId, input, cancellationToken));

    private async Task<IActionResult> ReadAsync<T>(Func<Guid, Task<T?>> query) where T : class
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await query(actorId);
        return result is null ? Forbid() : Ok(result);
    }

    private async Task<IActionResult> MutateAsync(Func<Guid, Task<FinanceCatalogResult>> command,
        int successStatus = StatusCodes.Status200OK)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await command(actorId);
        return result.Failure switch
        {
            null => StatusCode(successStatus, new FinanceIdResponse(result.Id!.Value)),
            FinanceCatalogFailure.Forbidden => Forbid(),
            FinanceCatalogFailure.NotFound => Problem(statusCode: 404, title: "Finance record not found."),
            FinanceCatalogFailure.Invalid => Problem(statusCode: 400, title: "Invalid finance data."),
            FinanceCatalogFailure.Conflict => Problem(statusCode: 409, title: "Finance record conflicts with current state."),
            _ => throw new InvalidOperationException(),
        };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}

public sealed record FinanceIdResponse(Guid Id);
public sealed record FinanceExpectedVersionInput(string ExpectedVersion);
