using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
public sealed class DepartmentGovernanceController(IDepartmentGovernanceStore store) : ControllerBase
{
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

    [HttpGet("departments/{department}/users", Name = "ListDepartmentUsers")]
    [ProducesResponseType<DepartmentUserPage>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> Users(string department, [FromQuery] int page = 1, [FromQuery] int limit = 25,
        [FromQuery] string? kind = null, [FromQuery] string? status = null, [FromQuery] Guid? accessProfileId = null,
        [FromQuery] Guid? stationId = null, [FromQuery] string? search = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync(actorId => store.ListUsersAsync(actorId, department, page, limit, kind, status, accessProfileId,
            stationId, search, cancellationToken));

    [HttpPost("departments/{department}/administrators", Name = "CreateDepartmentAdministrator")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateAdministrator(string department, [FromBody] CreateDepartmentAccountInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateAdministratorAsync(actorId, department, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPost("departments/{department}/users", Name = "CreateDepartmentUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateUser(string department, [FromBody] CreateDepartmentAccountInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateMemberAsync(actorId, department, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("departments/{department}/users/{id:guid}", Name = "UpdateDepartmentUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> UpdateUser(string department, Guid id, [FromBody] UpdateDepartmentUserInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.UpdateUserAsync(actorId, department, id, input, cancellationToken));

    [HttpPost("departments/{department}/users/{id:guid}/status", Name = "SetDepartmentUserStatus")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> SetUserStatus(string department, Guid id, [FromBody] SetDepartmentUserStatusInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SetUserStatusAsync(actorId, department, id, input, cancellationToken));

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
    [RequestSizeLimit(32768)]
    public Task<IActionResult> CreateProfile(string department, [FromBody] SaveAccessProfileInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SaveProfileAsync(actorId, department, null, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPut("departments/{department}/access-profiles/{id:guid}", Name = "UpdateAccessProfile")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(32768)]
    public Task<IActionResult> UpdateProfile(string department, Guid id, [FromBody] SaveAccessProfileInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SaveProfileAsync(actorId, department, id, input, cancellationToken));

    [HttpPost("departments/{department}/access-profiles/{id:guid}/deactivate", Name = "DeactivateAccessProfile")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> DeactivateProfile(string department, Guid id, [FromBody] ExpectedVersionInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.DeactivateProfileAsync(actorId, department, id, input.ExpectedVersion,
            cancellationToken));

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

    [HttpPost("clients/{organizationId:guid}/users", Name = "CreateGovernanceClientUser")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> CreateClientUser(Guid organizationId, [FromBody] CreateClientUserInput input,
        CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.CreateClientUserAsync(actorId, organizationId, input, cancellationToken),
            StatusCodes.Status201Created);

    [HttpPost("clients/{organizationId:guid}/users/{id:guid}/status", Name = "SetGovernanceClientUserStatus")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> SetClientUserStatus(Guid organizationId, Guid id,
        [FromBody] SetDepartmentUserStatusInput input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.SetClientUserStatusAsync(actorId, organizationId, id, input, cancellationToken));

    [HttpPost("clients/{organizationId:guid}/users/{id:guid}/password-reset", Name = "ResetGovernanceClientUserPassword")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> ResetClientUserPassword(Guid organizationId, Guid id,
        [FromBody] ResetGovernancePasswordRequest input, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ResetClientUserPasswordAsync(actorId, organizationId, id,
            input.TemporaryPassword, cancellationToken));

    [HttpGet("legacy-roles", Name = "ListLegacyRoles")]
    [ProducesResponseType<LegacyRoleData[]>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> LegacyRoles(CancellationToken cancellationToken) =>
        ReadAsync(actorId => store.ListLegacyRolesAsync(actorId, cancellationToken));

    [HttpPost("legacy-roles/{id:guid}/convert", Name = "ConvertLegacyRole")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    public Task<IActionResult> ConvertLegacyRole(Guid id, CancellationToken cancellationToken) =>
        MutateAsync(actorId => store.ConvertLegacyRoleAsync(actorId, id, cancellationToken));

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

public sealed record ExpectedVersionInput(string ExpectedVersion);
