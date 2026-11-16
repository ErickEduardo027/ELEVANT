using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Department governance: the super administrator governs every department,
/// department administrators manage their own users and templates, and Human
/// Resources validates the accounts that administrators request.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/governance")]
public sealed class DepartmentGovernanceController(IDepartmentGovernanceStore store, IEmployeeGovernanceStore employees)
    : ControllerBase
{
    /// <summary>Employees of the department that can be given access (ADR-0017).</summary>
    [HttpGet("departments/{department}/access-candidates", Name = "ListDepartmentAccessCandidates")]
    [ProducesResponseType<AccessCandidateData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> AccessCandidates(string department, [FromQuery] string? search = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => employees.ListAccessCandidatesAsync(actorId, department, search, cancellationToken));

    [HttpGet("departments/{department}/positions", Name = "ListDepartmentPositions")]
    [ProducesResponseType<JobPositionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> DepartmentPositions(string department, CancellationToken cancellationToken) =>
        ReadAsync(actorId => employees.ListPositionsAsync(actorId, department, cancellationToken));

    [HttpPut("departments/{department}/positions/{id:guid}/suggested-access-profile", Name = "SetPositionSuggestedAccessProfile")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> SetSuggestedProfile(string department, Guid id, [FromBody] SetSuggestedProfileInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => employees.SetSuggestedProfileAsync(actorId, department, id, input, cancellationToken));

    [HttpGet("departments/{department}/requisitions", Name = "ListDepartmentRequisitions")]
    [ProducesResponseType<RequisitionData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> DepartmentRequisitions(string department, [FromQuery] string? status = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => employees.ListRequisitionsAsync(actorId, department, status, cancellationToken));

    [HttpPost("departments/{department}/requisitions", Name = "CreatePersonnelRequisition")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(8192)]
    public Task<IActionResult> CreateRequisition(string department, [FromBody] CreateRequisitionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => employees.CreateRequisitionAsync(actorId, department, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPost("requisitions/{id:guid}/cancel", Name = "CancelPersonnelRequisition")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> CancelRequisition(Guid id, [FromBody] CancelRequisitionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => employees.ChangeRequisitionStatusAsync(actorId, id,
            new ChangeRequisitionStatusInput("Cancelled", input.ExpectedVersion, input.Reason), cancellationToken));

    /// <summary>Audit trail of the department: sign-ins, governance and operational actions of its people.</summary>
    [HttpGet("departments/{department}/activity", Name = "ListDepartmentActivity")]
    [ProducesResponseType<ActivityPageData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Activity(string department, [FromQuery] DateTimeOffset from, [FromQuery] DateTimeOffset to,
        [FromQuery] string? category = null, [FromQuery] Guid? accountId = null, [FromQuery] string? cursor = null,
        [FromQuery] int limit = 50, CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => employees.ListActivityAsync(actorId, department, from, to, category, accountId, cursor, limit,
            cancellationToken));

    [HttpGet("me/access", Name = "GetMyDepartmentAccess")]
    [ProducesResponseType<MyDepartmentAccessData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> MyAccess(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetMyAccessAsync(actorId, cancellationToken));

    [HttpGet("catalog", Name = "GetDepartmentPermissionCatalog")]
    [ProducesResponseType<DepartmentCatalogData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Catalog(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetCatalogAsync(actorId, cancellationToken));

    [HttpGet("departments/summary", Name = "GetDepartmentsOverview")]
    [ProducesResponseType<DepartmentsOverviewData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Overview(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetOverviewAsync(actorId, cancellationToken));

    [HttpGet("departments/{department}/summary", Name = "GetDepartmentSummary")]
    [ProducesResponseType<DepartmentSummaryData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Summary(string department, CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetDepartmentSummaryAsync(actorId, department, cancellationToken));

    [HttpGet("departments/{department}/options", Name = "GetDepartmentGovernanceOptions")]
    [ProducesResponseType<DepartmentOptionsData>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Options(string department, CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.GetOptionsAsync(actorId, department, cancellationToken));

    [HttpGet("departments/{department}/users", Name = "ListDepartmentUsers")]
    [ProducesResponseType<DepartmentUserPage>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Users(string department, [FromQuery] int page = 1, [FromQuery] int limit = 25,
        [FromQuery] string? kind = null, [FromQuery] string? status = null, [FromQuery] Guid? accessProfileId = null,
        [FromQuery] Guid? stationId = null, [FromQuery] string? search = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListUsersAsync(actorId, department, page, limit, kind, status, accessProfileId,
            stationId, search, cancellationToken));

    /// <summary>
    /// Names a department administrator from an employee. The Idempotency-Key is optional while older clients exist
    /// (2-N39): a retry with the same key, body and temporary password replays the account.
    /// </summary>
    [HttpPost("departments/{department}/administrators", Name = "CreateDepartmentAdministrator")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateAdministrator(string department, [FromBody] CreateDepartmentAccountInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateAdministratorAsync(actorId, department, input, idempotencyKey,
            cancellationToken), StatusCodes.Status201Created);

    /// <summary>
    /// Super administrator only: registers the employee and creates its account (administrator or
    /// member with per-option permissions) in one step, without a Human Resources request.
    /// </summary>
    [HttpPost("departments/{department}/internal-users", Name = "CreateInternalUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateInternalUser(string department, [FromBody] CreateInternalUserInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateInternalUserAsync(actorId, department, input, idempotencyKey,
            cancellationToken), StatusCodes.Status201Created);

    /// <summary>Deprecated (ADR-0017): members are requested for an employee and validated by Human Resources.</summary>
    [Obsolete("Request access for an employee instead.")]
    [HttpPost("departments/{department}/users", Name = "CreateDepartmentUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateUser(string department, [FromBody] CreateDepartmentAccountInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateMemberAsync(actorId, department, input, cancellationToken),
            StatusCodes.Status201Created);

    /// <summary>
    /// Edits a user's access with the version on screen: an employee's stations come from the employee record
    /// (<c>stations_outside_employee</c>), a legacy CUSTOM_* member becomes a Contracts member and a transferred
    /// account is refused (<c>employee_transferred</c>). Optional Idempotency-Key (2-N39).
    /// </summary>
    [HttpPut("departments/{department}/users/{id:guid}", Name = "UpdateDepartmentUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> UpdateUser(string department, Guid id, [FromBody] UpdateDepartmentUserInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.UpdateUserAsync(actorId, department, id, input, idempotencyKey, cancellationToken));

    /// <summary>
    /// Deactivates or reactivates a user with the version on screen; only the employee's current department brings a
    /// transferred account back, through a validated request (<c>employee_transferred</c>). Optional Idempotency-Key.
    /// </summary>
    [HttpPost("departments/{department}/users/{id:guid}/status", Name = "SetDepartmentUserStatus")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> SetUserStatus(string department, Guid id, [FromBody] SetDepartmentUserStatusInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SetUserStatusAsync(actorId, department, id, input, idempotencyKey,
            cancellationToken));

    [HttpPost("departments/{department}/users/{id:guid}/password-reset", Name = "ResetDepartmentUserPassword")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> ResetUserPassword(string department, Guid id,
        [FromBody] ResetGovernancePasswordRequest input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ResetUserPasswordAsync(actorId, department, id, input.TemporaryPassword,
            cancellationToken));

    [HttpGet("departments/{department}/access-profiles", Name = "ListAccessProfiles")]
    [ProducesResponseType<AccessProfileData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Profiles(string department, CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.ListProfilesAsync(actorId, department, cancellationToken));

    [HttpPost("departments/{department}/access-profiles", Name = "CreateAccessProfile")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateProfile(string department, [FromBody] SaveAccessProfileInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SaveProfileAsync(actorId, department, null, input, idempotencyKey,
            cancellationToken), StatusCodes.Status201Created);

    [HttpPut("departments/{department}/access-profiles/{id:guid}", Name = "UpdateAccessProfile")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> UpdateProfile(string department, Guid id, [FromBody] SaveAccessProfileInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SaveProfileAsync(actorId, department, id, input, idempotencyKey, cancellationToken));

    [HttpPost("departments/{department}/access-profiles/{id:guid}/deactivate", Name = "DeactivateAccessProfile")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> DeactivateProfile(string department, Guid id, [FromBody] ExpectedVersionInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.DeactivateProfileAsync(actorId, department, id, input.ExpectedVersion,
            idempotencyKey, cancellationToken));

    [HttpPost("departments/{department}/access-requests", Name = "RequestDepartmentUserAccess")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> RequestAccess(string department, [FromBody] RequestUserAccessInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.RequestAccessAsync(actorId, department, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpGet("access-requests", Name = "ListUserAccessRequests")]
    [ProducesResponseType<AccessRequestPage>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Requests([FromQuery] string? department = null, [FromQuery] string? status = null,
        [FromQuery] int page = 1, [FromQuery] int limit = 25, CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListRequestsAsync(actorId, department, status, page, limit, cancellationToken));

    [HttpPost("access-requests/{id:guid}/cancel", Name = "CancelUserAccessRequest")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> CancelRequest(Guid id, [FromBody] ExpectedVersionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CancelRequestAsync(actorId, id, input.ExpectedVersion, cancellationToken));

    [HttpPost("access-requests/{id:guid}/validate", Name = "ValidateUserAccessRequest")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> ValidateRequest(Guid id, [FromBody] DecideUserAccessInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ValidateRequestAsync(actorId, id, input, cancellationToken));

    [HttpPost("access-requests/{id:guid}/reject", Name = "RejectUserAccessRequest")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> RejectRequest(Guid id, [FromBody] DecideUserAccessInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.RejectRequestAsync(actorId, id, input, cancellationToken));

    [HttpGet("clients", Name = "ListGovernanceClients")]
    [ProducesResponseType<ClientAirlineData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Clients(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.ListClientsAsync(actorId, cancellationToken));

    [HttpGet("clients/{organizationId:guid}/users", Name = "ListGovernanceClientUsers")]
    [ProducesResponseType<ClientUserData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ClientUsers(Guid organizationId, CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.ListClientUsersAsync(actorId, organizationId, cancellationToken));

    /// <summary>
    /// Adds a portal user to an airline (invitation by email, or a temporary password); its representatives hear of
    /// it. The Idempotency-Key is optional while older clients exist (2-N39).
    /// </summary>
    [HttpPost("clients/{organizationId:guid}/users", Name = "CreateGovernanceClientUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> CreateClientUser(Guid organizationId, [FromBody] CreateClientUserInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateClientUserAsync(actorId, organizationId, input, idempotencyKey,
            cancellationToken), StatusCodes.Status201Created);

    [HttpPost("clients/{organizationId:guid}/users/{id:guid}/status", Name = "SetGovernanceClientUserStatus")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> SetClientUserStatus(Guid organizationId, Guid id,
        [FromBody] SetDepartmentUserStatusInput input, [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SetClientUserStatusAsync(actorId, organizationId, id, input, idempotencyKey,
            cancellationToken));

    /// <summary>
    /// Designates a representative (manages the airline's portal users and signs) or a signer (signs contracts and
    /// submits the JAC permit) with the account version on screen and an Idempotency-Key (2-N20). The last active
    /// representative keeps the role (<c>last_representative</c>).
    /// </summary>
    [HttpPost("clients/{organizationId:guid}/users/{id:guid}/portal-role", Name = "SetGovernanceClientUserPortalRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> SetClientUserPortalRole(Guid organizationId, Guid id,
        [FromBody, BindRequired] SetClientUserPortalRoleInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SetClientUserPortalRoleAsync(actorId, organizationId, id, input, idempotencyKey,
            cancellationToken));

    /// <summary>
    /// Sets a temporary password the user must change at the next sign-in. On an invitation that is
    /// still pending it accepts the invitation, retires its links and discards its queued email (1-N12).
    /// The Idempotency-Key and <c>expectedVersion</c> (the account version) are optional while older
    /// clients exist (expand); a key without the version is rejected.
    /// </summary>
    [HttpPost("clients/{organizationId:guid}/users/{id:guid}/password-reset", Name = "ResetGovernanceClientUserPassword")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> ResetClientUserPassword(Guid organizationId, Guid id,
        [FromBody] ResetClientUserPasswordInput input, [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ResetClientUserPasswordAsync(actorId, organizationId, id, input, idempotencyKey,
            cancellationToken));

    [HttpGet("legacy-roles", Name = "ListLegacyRoles")]
    [ProducesResponseType<LegacyRoleData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> LegacyRoles(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.ListLegacyRolesAsync(actorId, cancellationToken));

    /// <summary>
    /// Converts a legacy CUSTOM_* role into a Contracts template; members already edited keep their permissions
    /// (2-N19). The body (<c>expectedVersion</c>) and the Idempotency-Key are optional while older clients exist; a
    /// key needs the version (2-N39).
    /// </summary>
    [HttpPost("legacy-roles/{id:guid}/convert", Name = "ConvertLegacyRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> ConvertLegacyRole(Guid id,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ConvertLegacyRoleInput? input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ConvertLegacyRoleAsync(actorId, id, input, idempotencyKey, cancellationToken));

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

public sealed record ExpectedVersionInput(string ExpectedVersion);

public sealed record CancelRequisitionInput(string ExpectedVersion, string Reason);
