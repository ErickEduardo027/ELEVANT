using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/governance")]
public sealed class GovernanceController(IGovernanceStore store) : ControllerBase
{
    [HttpGet("me/permissions", Name = "GetCurrentGovernancePermissions")]
    [ProducesResponseType<string[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> MyPermissions(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var permissions = await store.GetMyPermissionsAsync(actorId, cancellationToken);
        return permissions is null ? Forbid() : Ok(permissions);
    }

    [HttpGet(Name = "GetGovernanceSnapshot")]
    [ProducesResponseType<GovernanceSnapshot>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var snapshot = await store.GetAsync(actorId, cancellationToken);
        return snapshot is null ? Forbid() : Ok(snapshot);
    }

    [HttpGet("audit", Name = "GetGovernanceAudit")]
    [ProducesResponseType<GovernanceAuditPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Audit([FromQuery] int page = 1,
        [FromQuery] int limit = 25, CancellationToken cancellationToken = default)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var audit = await store.GetAuditAsync(actorId, page, limit, cancellationToken);
        return audit is null ? Forbid() : Ok(audit);
    }

    [HttpPost("roles", Name = "CreateGovernanceRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> CreateRole([FromBody] SaveGovernanceRoleInput input,
        CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.CreateRoleAsync(actorId, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("roles/{id:guid}", Name = "UpdateGovernanceRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> UpdateRole(Guid id, [FromBody] SaveGovernanceRoleInput input,
        CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.UpdateRoleAsync(actorId, id, input, cancellationToken));

    [HttpDelete("roles/{id:guid}", Name = "DeleteGovernanceRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> DeleteRole(Guid id, CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.DeleteRoleAsync(actorId, id, cancellationToken));

    [HttpPost("users", Name = "CreateGovernanceUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> CreateUser([FromBody] CreateGovernanceUserInput input,
        CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.CreateUserAsync(actorId, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("users/{id:guid}", Name = "UpdateGovernanceUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> UpdateUser(Guid id, [FromBody] UpdateGovernanceUserInput input,
        CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.UpdateUserAsync(actorId, id, input, cancellationToken));

    [HttpDelete("users/{id:guid}", Name = "DeleteGovernanceUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> DeleteUser(Guid id, CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.DeleteUserAsync(actorId, id, cancellationToken));

    [HttpPost("users/{id:guid}/password-reset", Name = "ResetGovernanceUserPassword")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> ResetPassword(Guid id,
        [FromBody] ResetGovernancePasswordRequest input,
        CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.ResetPasswordAsync(actorId, id,
            input.TemporaryPassword, cancellationToken));

    private async Task<IActionResult> MutateAsync(
        Func<Guid, Task<GovernanceResult>> command,
        int successStatus = StatusCodes.Status200OK)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await command(actorId);
        return result.Failure switch
        {
            null => StatusCode(successStatus, new CommercialIdResponse(result.Id!.Value)),
            GovernanceFailure.Forbidden => Forbid(),
            GovernanceFailure.NotFound => Problem(statusCode: 404, title: "Governance record not found."),
            GovernanceFailure.Invalid => Problem(statusCode: 400, title: "Invalid governance data."),
            GovernanceFailure.Conflict => Problem(statusCode: 409, title: "Governance record conflicts with current state."),
            GovernanceFailure.Protected => Problem(statusCode: 409, title: "This protected user or role cannot be changed."),
            _ => throw new InvalidOperationException(),
        };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}

public sealed record ResetGovernancePasswordRequest(string TemporaryPassword);
