using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Human Resources records (ADR-0017): employees, the job positions of every department, personnel
/// requisitions and the people-governance audit trail. Authorization is resolved in the store.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources")]
public sealed class HumanResourcesEmployeesController(IEmployeeGovernanceStore store) : ControllerBase
{
    [HttpGet("employees", Name = "ListEmployees")]
    [ProducesResponseType<EmployeePageData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Employees([FromQuery] string? department = null, [FromQuery] string? status = null,
        [FromQuery] Guid? positionId = null, [FromQuery] bool? hasAccount = null, [FromQuery] string? search = null,
        [FromQuery] int page = 1, [FromQuery] int limit = 25, CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListEmployeesAsync(actorId, department, status, positionId, hasAccount, search, page,
            limit, cancellationToken));

    [HttpGet("employees/options", Name = "GetEmployeeOptions")]
    [ProducesResponseType<EmployeeOptionsData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Options(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetEmployeeOptionsAsync(actorId, cancellationToken));

    [HttpGet("employees/unregistered", Name = "ListUnregisteredPersons")]
    [ProducesResponseType<UnregisteredPersonData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Unregistered(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.ListUnregisteredAsync(actorId, cancellationToken));

    [HttpGet("employees/{id:guid}", Name = "GetEmployee")]
    [ProducesResponseType<EmployeeDetailData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Employee(Guid id, CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetEmployeeAsync(actorId, id, cancellationToken));

    [HttpPost("employees", Name = "CreateEmployee")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> Create([FromBody] SaveEmployeeInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateEmployeeAsync(actorId, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPut("employees/{id:guid}", Name = "UpdateEmployee")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> Update(Guid id, [FromBody] SaveEmployeeInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.UpdateEmployeeAsync(actorId, id, input, cancellationToken));

    [HttpPost("employees/{id:guid}/transfer", Name = "TransferEmployee")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> Transfer(Guid id, [FromBody] TransferEmployeeInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.TransferEmployeeAsync(actorId, id, input, cancellationToken));

    [HttpPost("employees/{id:guid}/termination", Name = "TerminateEmployee")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> Terminate(Guid id, [FromBody] TerminateEmployeeInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.TerminateEmployeeAsync(actorId, id, input, cancellationToken));

    [HttpPost("employees/registrations", Name = "RegisterEmployee")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> Register([FromBody] RegisterEmployeeInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.RegisterEmployeeAsync(actorId, input, cancellationToken), StatusCodes.Status201Created);

    [HttpGet("positions", Name = "ListJobPositions")]
    [ProducesResponseType<JobPositionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Positions([FromQuery] string? department = null, CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListPositionsAsync(actorId, department, cancellationToken));

    [HttpPost("positions", Name = "CreateJobPosition")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> CreatePosition([FromBody] SaveJobPositionInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SavePositionAsync(actorId, null, input, cancellationToken), StatusCodes.Status201Created);

    [HttpPut("positions/{id:guid}", Name = "UpdateJobPosition")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> UpdatePosition(Guid id, [FromBody] SaveJobPositionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SavePositionAsync(actorId, id, input, cancellationToken));

    [HttpGet("requisitions", Name = "ListPersonnelRequisitions")]
    [ProducesResponseType<RequisitionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Requisitions([FromQuery] string? department = null, [FromQuery] string? status = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListRequisitionsAsync(actorId, department, status, cancellationToken));

    [HttpPost("requisitions/{id:guid}/status", Name = "ChangePersonnelRequisitionStatus")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> ChangeRequisitionStatus(Guid id, [FromBody] ChangeRequisitionStatusInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ChangeRequisitionStatusAsync(actorId, id, input, cancellationToken));

    /// <summary>People-governance audit trail; <c>human_resources.audit.read</c> or the super administrator.</summary>
    [HttpGet("audit", Name = "ListHumanResourcesAudit")]
    [ProducesResponseType<ActivityPageData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Audit([FromQuery] DateTimeOffset from, [FromQuery] DateTimeOffset to,
        [FromQuery] string? department = null, [FromQuery] string? category = null, [FromQuery] Guid? accountId = null,
        [FromQuery] string? cursor = null, [FromQuery] int limit = 50, CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListActivityAsync(actorId, department, from, to, category, accountId, cursor, limit,
            cancellationToken));

    private async Task<IActionResult> ReadAsync<T>(Func<Guid, Task<T?>> query) where T : class
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await query(actorId);
        return result is null ? Forbid() : Ok(result);
    }

    private async Task<IActionResult> MutateAsync(Func<Guid, Task<GovernanceResult>> command,
        int successStatus = StatusCodes.Status200OK)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return this.ToAction(await command(actorId), successStatus);
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}
