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
public sealed class GovernanceController(IGovernanceStore store,
    IRampMobileAccessRequestStore accessRequests) : ControllerBase
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

    /// <summary>Retired (2-N38): templates replace custom roles; answers 410 <c>legacy_governance_retired</c>.</summary>
    [HttpPost("roles", Name = "CreateGovernanceRole")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public IActionResult CreateRole() => Retired();

    /// <summary>Retired (2-N38): templates replace custom roles; answers 410 <c>legacy_governance_retired</c>.</summary>
    [HttpPut("roles/{id:guid}", Name = "UpdateGovernanceRole")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public IActionResult UpdateRole() => Retired();

    [HttpDelete("roles/{id:guid}", Name = "DeleteGovernanceRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> DeleteRole(Guid id, CancellationToken cancellationToken) =>
        await MutateAsync((actorId) => store.DeleteRoleAsync(actorId, id, cancellationToken));

    /// <summary>
    /// Retired (2-N38): accounts belong to employees; departments request them and Gestión Humana validates them.
    /// Answers 410 <c>legacy_governance_retired</c>.
    /// </summary>
    [HttpPost("users", Name = "CreateGovernanceUser")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public IActionResult CreateUser() => Retired();

    [HttpGet("ramp-mobile-access-requests", Name = "ListGovernanceRampMobileAccessRequests")]
    [ProducesResponseType<RampMobileAccessRequestData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListRampMobileAccessRequests(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var rows = await accessRequests.ListForGovernanceAsync(actorId, cancellationToken);
        return rows is null ? Forbid() : Ok(rows);
    }

    [HttpPost("ramp-mobile-access-requests/{id:guid}/reject", Name = "RejectRampMobileAccessRequest")]
    [RequestSizeLimit(16384)]
    [ProducesResponseType<RampMobileAccessRequestData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> RejectRampMobileAccessRequest(Guid id,
        [FromBody] RejectRampMobileAccessInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await accessRequests.RejectAsync(actorId, id, input.Reason,
            input.ExpectedVersion, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result.Request),
            MobileAccessRequestFailure.Forbidden => Forbid(),
            MobileAccessRequestFailure.Invalid => Problem(statusCode: 400, title: "Invalid rejection reason."),
            MobileAccessRequestFailure.NotFound => Problem(statusCode: 404, title: "Mobile access request not found."),
            MobileAccessRequestFailure.Conflict => Problem(statusCode: 409, title: "Mobile access request is no longer pending."),
            _ => throw new InvalidOperationException(),
        };
    }

    /// <summary>
    /// Retired (2-N38): access is edited from the department's users and the employee record. Answers 410
    /// <c>legacy_governance_retired</c>.
    /// </summary>
    [HttpPut("users/{id:guid}", Name = "UpdateGovernanceUser")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public IActionResult UpdateUser() => Retired();

    /// <summary>The retired routes answer the same whatever the body: they no longer read it nor reach the store.</summary>
    private IActionResult Retired() => TryActor(out _) ? GovernanceResults.LegacyRetired(this) : Unauthorized();

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

    /// <summary>The legacy commands still in use answer like every governance command: a code and a Spanish title (2-N39).</summary>
    private async Task<IActionResult> MutateAsync(
        Func<Guid, Task<GovernanceResult>> command,
        int successStatus = StatusCodes.Status200OK)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return this.ToAction(await command(actorId), successStatus);
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}

public sealed record ResetGovernancePasswordRequest(string TemporaryPassword);
public sealed record RejectRampMobileAccessInput(string Reason, string ExpectedVersion);
