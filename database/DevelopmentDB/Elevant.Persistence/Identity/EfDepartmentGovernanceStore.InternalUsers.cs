using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Persistence.Identity;

internal sealed partial class EfDepartmentGovernanceStore
{
    /// <summary>
    /// The super administrator registers the employee and its account together: same validation as
    /// a Human Resources registration and an access validation, one transaction, no request. Ramp
    /// agents keep the request flow because they also need a supervisor and terminals.
    /// </summary>
    public async Task<GovernanceResult> CreateInternalUserAsync(Guid actorId, string department,
        CreateInternalUserInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        // 2-N39: a retry after an uncertain answer replays the account; the temporary password is checked apart.
        var receipt = ReceiptOf(actor, idempotencyKey, "governance.internal_user.create", new
        {
            department = KeyOf(parsed), input?.Kind, input?.Employee?.FirstName, input?.Employee?.LastName,
            input?.Employee?.IdentificationType, input?.Employee?.IdentificationNumber, input?.Employee?.EmployeeNumber,
            input?.Employee?.Department, input?.Employee?.PositionId,
            employeeStations = input?.Employee?.StationIds?.Order().ToArray(), input?.Employee?.HireDate,
            input?.Employee?.PhoneNumber, email = input?.Employee?.CorporateEmail?.Trim().ToUpperInvariant(),
            input?.Employee?.RequisitionId, stations = input?.StationIds?.Order().ToArray(), input?.AccessProfileId,
            codes = input?.PermissionCodes?.Order(StringComparer.Ordinal).ToArray(),
        });
        if (await ReplayAsync(receipt, cancellationToken,
                id => PasswordMatchesAsync(id, input?.TemporaryPassword, cancellationToken)) is { } replay)
            return replay;
        var kind = input?.Kind switch
        {
            "administrator" => DepartmentAssignmentKind.Administrator,
            "member" => DepartmentAssignmentKind.Member,
            _ => (DepartmentAssignmentKind?)null,
        };
        if (input?.Employee is null || kind is null || string.IsNullOrWhiteSpace(input.TemporaryPassword) ||
            input.StationIds is not { Count: > 0 and <= 20 })
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "invalid_internal_user");
        if (!TryParse(input.Employee.Department, out var employeeDepartment) || employeeDepartment != parsed)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "department_mismatch");
        if (string.IsNullOrWhiteSpace(input.Employee.CorporateEmail))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "employee_without_email");
        var (shape, failure) = await ShapeAsync(actor, input.Employee, cancellationToken);
        if (failure is not null) return failure;
        if (shape!.Position.IsRampPosition)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "ramp_agents_use_requests");
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null || stations.Except(shape.Stations).Any())
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_outside_employee");
        var grants = kind == DepartmentAssignmentKind.Member
            ? await ResolveGrantsAsync(parsed, input.AccessProfileId, input.PermissionCodes, cancellationToken)
            : new GrantSelection(null, []);
        if (grants is null || kind == DepartmentAssignmentKind.Member && grants.ProfileId is null && grants.Codes.Count == 0)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "permissions_required");

        return await InSerializableTransactionAsync(async () =>
        {
            if (await UniquenessAsync(shape, null, cancellationToken) is { } conflict) return conflict;
            var now = timeProvider.GetUtcNow();
            var employee = await AddEmployeeAsync(actor, shape, now, cancellationToken);
            var candidate = await CandidateAsync(employee.Id, null, tracked: true, cancellationToken);
            if (candidate is null) return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_changed");
            var (account, provisioning) = await ProvisionEmployeeAccountAsync(candidate, input.TemporaryPassword, parsed,
                kind.Value, stations, grants, now, cancellationToken);
            if (account is null)
                return GovernanceResult.Failed(provisioning == "password_policy"
                    ? GovernanceFailure.Invalid : GovernanceFailure.Conflict, provisioning);
            var scope = stations.Select(station => (long?)station).ToArray();
            GovernanceSupport.AddAudit(context, actor.Id, "hr.employee.created", "hr.employees", employee.PublicId, null,
                shape.Stations.Select(station => (long?)station).ToArray(), now, parsed,
                new AuditFieldChangeData("employee.number", null, employee.EmployeeNumber),
                new AuditFieldChangeData("employee.position", null, shape.Position.Name),
                new AuditFieldChangeData("origin", null, "superadmin"));
            GovernanceSupport.AddAudit(context, actor.Id, "governance.internal_user.created", "iam.accounts",
                account.PublicId, null, scope, now, parsed,
                new AuditFieldChangeData("department", null, KeyOf(parsed)),
                new AuditFieldChangeData("kind", null, kind.Value.ToString()),
                new AuditFieldChangeData("employee", null, employee.EmployeeNumber),
                new AuditFieldChangeData("user.permissions", null,
                    grants.ProfileId is null ? string.Join(',', grants.Codes) : "template"));
            await NotifyEmployeesAsync(parsed, employee.PublicId, now, cancellationToken);
            await NotifyDepartmentAsync(parsed, "department_users", account.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(account.PublicId);
        }, cancellationToken, receipt);
    }
}
