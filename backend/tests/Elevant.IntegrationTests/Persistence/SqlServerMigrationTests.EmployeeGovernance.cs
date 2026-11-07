using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid OperationsAdministrator = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid HumanResourcesAccount = Guid.Parse("40000000-0000-7000-8000-000000000004");
    private static readonly Guid SuperAdministratorAccount = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid PujStation = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid PujTerminal = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly Guid SeededFinanceRequisition = Guid.Parse("47000000-0000-7000-8000-000000000001");
    private const string EmployeePassword = "Employee-Access!2026";

    private static SaveEmployeeInput NewEmployee(string firstName, string number, string identification, string department,
        Guid positionId, string? email, Guid? requisitionId = null) =>
        new(firstName, "Prueba", "CEDULA", identification, number, department, positionId, [PujStation],
            new DateOnly(2026, 9, 1), "809-555-0100", email, requisitionId);

    [Fact]
    public async Task EmployeesReceiveAccessFromHumanResourcesRecordsAndLoseItOnTransferOrTermination()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();

        // Only Human Resources reads employee records; departments see their candidates.
        Assert.Null(await hr.ListEmployeesAsync(FinanceAccount, null, null, null, null, null, 1, 25, cancellationToken));
        var seeded = (await hr.ListEmployeesAsync(HumanResourcesAccount, null, null, null, null, null, 1, 100,
            cancellationToken))!;
        Assert.True(seeded.Total >= 8);
        var positions = (await hr.ListPositionsAsync(HumanResourcesAccount, null, cancellationToken))!;
        var analyst = Assert.Single(positions, position => position.Name == "Analista de facturación");
        Assert.NotNull(analyst.SuggestedAccessProfileId);
        var commercial = Assert.Single(positions, position => position.Name == "Analista comercial");
        Assert.Equal(GovernanceFailure.Forbidden, (await hr.SavePositionAsync(FinanceAccount, null,
            new SaveJobPositionInput("finance", "Inventado", null, false), cancellationToken)).Failure);
        Assert.Equal("ramp_position_outside_operations", (await hr.SavePositionAsync(HumanResourcesAccount, null,
            new SaveJobPositionInput("finance", "Rampa en Finanzas", null, true), cancellationToken)).Code);

        // HR registers the hire against the seeded requisition; identification and numbers are unique.
        var created = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Lucía", "QA-FIN-010",
            "001-1234567-3", "finance", analyst.Id, "lucia.prueba@dev.elevant.test", SeededFinanceRequisition),
            cancellationToken);
        Assert.True(created.IsSuccess, created.Code);
        Assert.Equal("identification_in_use", (await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Otra",
            "QA-FIN-011", "00112345673", "finance", analyst.Id, null), cancellationToken)).Code);
        Assert.Equal("employee_number_in_use", (await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Otra",
            "dev-ra-001", "00299999995", "finance", analyst.Id, null), cancellationToken)).Code);
        var requisition = Assert.Single((await hr.ListRequisitionsAsync(HumanResourcesAccount, "finance", null,
            cancellationToken))!, item => item.Id == SeededFinanceRequisition);
        Assert.Equal("InProgress", requisition.Status);
        Assert.Equal(2, requisition.Filled); // the seeded candidate and this hire

        // The Finance administrator picks the employee; the position suggests the profile.
        var candidates = (await hr.ListAccessCandidatesAsync(FinanceAccount, "finance", null, cancellationToken))!;
        var candidate = Assert.Single(candidates, item => item.EmployeeId == created.Id);
        Assert.Equal(analyst.SuggestedAccessProfileId, candidate.SuggestedAccessProfileId);
        Assert.DoesNotContain(candidates, item => item.LastName == "Finance");
        Assert.Null(await hr.ListAccessCandidatesAsync(ContractsAccount, "finance", null, cancellationToken));
        var personsBefore = await context.Persons.CountAsync(cancellationToken);
        var requestId = Guid.NewGuid();
        var requested = await governance.RequestAccessAsync(FinanceAccount, "finance",
            new RequestUserAccessInput(requestId, null, null, null, null, [PujStation],
                AccessProfileId: candidate.SuggestedAccessProfileId, EmployeeId: created.Id), cancellationToken);
        Assert.True(requested.IsSuccess, requested.Code);
        Assert.Equal(requested.Id, (await governance.RequestAccessAsync(FinanceAccount, "finance",
            new RequestUserAccessInput(requestId, null, null, null, null, [PujStation],
                AccessProfileId: candidate.SuggestedAccessProfileId, EmployeeId: created.Id), cancellationToken)).Id);
        Assert.Equal("request_pending", (await governance.RequestAccessAsync(FinanceAccount, "finance",
            new RequestUserAccessInput(Guid.NewGuid(), null, null, null, null, [PujStation],
                AccessProfileId: candidate.SuggestedAccessProfileId, EmployeeId: created.Id), cancellationToken)).Code);
        var request = Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "finance", "Pending", 1, 25,
            cancellationToken))!.Requests, item => item.Id == requested.Id);
        Assert.Equal(created.Id, request.EmployeeId);
        Assert.Equal("Analista de facturación", request.Category);

        // HR validates; the account belongs to the employee's own person.
        Assert.Equal(GovernanceFailure.Forbidden, (await governance.ValidateRequestAsync(FinanceAccount, request.Id,
            new DecideUserAccessInput(request.Version, EmployeePassword), cancellationToken)).Failure);
        var validated = await governance.ValidateRequestAsync(HumanResourcesAccount, request.Id,
            new DecideUserAccessInput(request.Version, EmployeePassword), cancellationToken);
        Assert.True(validated.IsSuccess, validated.Code);
        Assert.Equal(personsBefore, await context.Persons.CountAsync(cancellationToken));
        var employeeRow = await context.Employees.AsNoTracking().SingleAsync(item => item.PublicId == created.Id,
            cancellationToken);
        var account = await context.Users.AsNoTracking().SingleAsync(item => item.PublicId == validated.Id,
            cancellationToken);
        Assert.Equal(employeeRow.PersonId, account.PersonId);
        Assert.True(account.MustChangePassword);
        Assert.Contains((await governance.ListUsersAsync(FinanceAccount, "finance", 1, 50, null, null, null, null, null,
            cancellationToken))!.Users, user => user.Id == validated.Id && user.AccessProfileId == analyst.SuggestedAccessProfileId);
        Assert.Equal("employee_record_managed_by_hr", (await governance.UpdateUserAsync(FinanceAccount, "finance",
            validated.Id!.Value, new UpdateDepartmentUserInput("Otro", "Nombre", "lucia.prueba@dev.elevant.test",
                [PujStation], Convert.ToBase64String(account.RowVersion),
                AccessProfileId: candidate.SuggestedAccessProfileId), null, cancellationToken)).Code);

        // Sign-ins are audited and attributed to the department the person works in.
        var verifier = scope.ServiceProvider.GetRequiredService<ICredentialVerifier>();
        Assert.NotNull(await verifier.VerifyAsync("lucia.prueba@dev.elevant.test", EmployeePassword, cancellationToken));
        var window = (From: DateTimeOffset.UtcNow.AddHours(-1), To: DateTimeOffset.UtcNow.AddHours(1));
        var activity = (await hr.ListActivityAsync(FinanceAccount, "finance", window.From, window.To, null, null, null, 100,
            cancellationToken))!;
        Assert.Contains(activity.Entries, entry => entry.Action == "auth.session.created" && entry.ActorId == validated.Id);
        Assert.Contains(activity.Entries, entry => entry.Action == "governance.access_request.validated");
        Assert.Contains(activity.Entries, entry => entry.Action == "hr.employee.created");
        Assert.Null(await hr.ListActivityAsync(ContractsAccount, "finance", window.From, window.To, null, null, null, 100,
            cancellationToken));
        var logins = (await hr.ListActivityAsync(FinanceAccount, "finance", window.From, window.To, "login", null, null, 100,
            cancellationToken))!;
        Assert.All(logins.Entries, entry => Assert.Equal("login", entry.Category));
        var firstPage = (await hr.ListActivityAsync(FinanceAccount, "finance", window.From, window.To, null, null, null, 1,
            cancellationToken))!;
        Assert.NotNull(firstPage.NextCursor);
        var secondPage = (await hr.ListActivityAsync(FinanceAccount, "finance", window.From, window.To, null, null,
            firstPage.NextCursor, 1, cancellationToken))!;
        Assert.NotEqual(firstPage.Entries[0].Id, secondPage.Entries[0].Id);

        // A transfer ends the access; the new department requests it and the same account comes back.
        var detail = (await hr.GetEmployeeAsync(HumanResourcesAccount, created.Id!.Value, cancellationToken))!;
        Assert.Equal(GovernanceFailure.Forbidden, (await hr.TransferEmployeeAsync(FinanceAccount, created.Id.Value,
            new TransferEmployeeInput("contracts", commercial.Id, [PujStation], "Reubicación", detail.Summary.Version),
            null, cancellationToken)).Failure);
        Assert.True((await hr.TransferEmployeeAsync(HumanResourcesAccount, created.Id.Value,
            new TransferEmployeeInput("contracts", commercial.Id, [PujStation], "Reubicación comercial", detail.Summary.Version),
            null, cancellationToken)).IsSuccess);
        Assert.Equal(AccountLifecycleStatus.Disabled, (await context.Users.AsNoTracking()
            .SingleAsync(item => item.Id == account.Id, cancellationToken)).Status);
        Assert.Null(await verifier.VerifyAsync("lucia.prueba@dev.elevant.test", EmployeePassword, cancellationToken));
        var probe = await context.Employees.AsNoTracking().SingleAsync(item => item.PublicId == created.Id, cancellationToken);
        Assert.Equal(Department.Contracts, probe.Department);
        Assert.Equal(EmployeeStatus.Active, probe.Status);
        Assert.Equal(0, await context.UserAccessRequests.CountAsync(item => item.EmployeeId == probe.Id &&
            item.Status == UserAccessRequestStatus.Pending, cancellationToken));
        var moved = Assert.Single((await hr.ListAccessCandidatesAsync(ContractsAccount, "contracts", "Lucía",
            cancellationToken))!);
        Assert.Equal("Disabled", moved.AccountStatus);
        var transferred = await governance.RequestAccessAsync(ContractsAccount, "contracts",
            new RequestUserAccessInput(Guid.NewGuid(), null, null, null, null, [PujStation],
                PermissionCodes: ["contracts.home.read"], EmployeeId: created.Id), cancellationToken);
        Assert.True(transferred.IsSuccess, transferred.Code);
        var pendingTransfer = Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "contracts", "Pending",
            1, 25, cancellationToken))!.Requests, item => item.Id == transferred.Id);
        var revalidated = await governance.ValidateRequestAsync(HumanResourcesAccount, pendingTransfer.Id,
            new DecideUserAccessInput(pendingTransfer.Version, EmployeePassword + "x"), cancellationToken);
        Assert.Equal(validated.Id, revalidated.Id);
        var reactivated = await context.Users.AsNoTracking().SingleAsync(item => item.Id == account.Id, cancellationToken);
        Assert.Equal(AccountLifecycleStatus.Active, reactivated.Status);
        Assert.Equal(Department.Contracts, (await context.DepartmentAssignments.AsNoTracking()
            .SingleAsync(item => item.AccountId == account.Id, cancellationToken)).Department);
        var roles = await (from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
                           join role in context.Roles.AsNoTracking() on link.RoleId equals role.Id
                           where link.UserId == account.Id
                           select role.NormalizedName).ToArrayAsync(cancellationToken);
        Assert.Equal(["CONTRATOS"], roles);
        Assert.Equal(2, (await hr.GetEmployeeAsync(HumanResourcesAccount, created.Id.Value, cancellationToken))!
            .Assignments.Count);

        // Termination ends everything and nothing can bring the account back.
        var current = (await hr.GetEmployeeAsync(HumanResourcesAccount, created.Id.Value, cancellationToken))!;
        Assert.Equal("termination_before_hire", (await hr.TerminateEmployeeAsync(HumanResourcesAccount, created.Id.Value,
            new TerminateEmployeeInput(new DateOnly(2026, 8, 1), "Renuncia", current.Summary.Version), null, cancellationToken)).Code);
        Assert.True((await hr.TerminateEmployeeAsync(HumanResourcesAccount, created.Id.Value,
            new TerminateEmployeeInput(Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow), "Renuncia voluntaria", current.Summary.Version),
            null, cancellationToken)).IsSuccess);
        var terminatedAccount = await context.Users.AsNoTracking().SingleAsync(item => item.Id == account.Id, cancellationToken);
        Assert.Equal(AccountLifecycleStatus.Disabled, terminatedAccount.Status);
        Assert.False(await context.AccountStationScopes.AnyAsync(scope => scope.AccountId == account.Id && scope.RevokedAt == null,
            cancellationToken));
        Assert.Equal("employee_terminated", (await governance.SetUserStatusAsync(SuperAdministratorAccount, "contracts",
            account.PublicId, new SetDepartmentUserStatusInput(true, Convert.ToBase64String(terminatedAccount.RowVersion)),
            null, cancellationToken)).Code);
        Assert.DoesNotContain((await hr.ListAccessCandidatesAsync(ContractsAccount, "contracts", null, cancellationToken))!,
            item => item.EmployeeId == created.Id);
        Assert.Equal(GovernanceFailure.Protected, (await hr.TerminateEmployeeAsync(HumanResourcesAccount,
            (await context.Employees.AsNoTracking().Where(item => item.EmployeeNumber == "DEV-EMP-HR-001")
                .Select(item => item.PublicId).SingleAsync(cancellationToken)),
            new TerminateEmployeeInput(Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow), "Autobaja",
                (await hr.ListEmployeesAsync(HumanResourcesAccount, null, null, null, null, "DEV-EMP-HR-001", 1, 5,
                    cancellationToken))!.Employees[0].Version), null, cancellationToken)).Failure);
    }

    [Fact]
    public async Task RampAdministratorRegistrationAndRequisitionFlowsFollowEmployeeRecords()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var positions = (await hr.ListPositionsAsync(HumanResourcesAccount, null, cancellationToken))!;
        var ramp = Assert.Single(positions, position => position.IsRampPosition);
        var commercial = Assert.Single(positions, position => position.Name == "Analista comercial");

        // A ramp hire gets its ramp-agent record at once; Operations then asks for app access.
        var agentEmployee = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Andrés", "QA-RA-050",
            "40212345678", "operations", ramp.Id, "andres.rampa@dev.elevant.test"), cancellationToken);
        Assert.True(agentEmployee.IsSuccess, agentEmployee.Code);
        var person = await context.Employees.AsNoTracking().Where(item => item.PublicId == agentEmployee.Id)
            .Select(item => item.PersonId).SingleAsync(cancellationToken);
        var agent = await context.RampAgents.AsNoTracking().SingleAsync(item => item.PersonId == person, cancellationToken);
        Assert.Equal(("QA-RA-050", "Agente de rampa", true), (agent.EmployeeNumber, agent.Category, agent.IsActive));
        Assert.Equal("ramp_agents_have_no_profile", (await governance.RequestAccessAsync(OperationsAdministrator, "operations",
            new RequestUserAccessInput(Guid.NewGuid(), null, null, null, null, [PujStation],
                PermissionCodes: ["operations.dashboard.read"], EmployeeId: agentEmployee.Id), cancellationToken)).Code);
        var rampRequest = await governance.RequestAccessAsync(OperationsAdministrator, "operations",
            new RequestUserAccessInput(Guid.NewGuid(), null, null, null, null, [PujStation], TerminalIds: [PujTerminal],
                EmployeeId: agentEmployee.Id), cancellationToken);
        Assert.True(rampRequest.IsSuccess, rampRequest.Code);
        var pending = Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "operations", "Pending", 1, 25,
            cancellationToken))!.Requests, item => item.Id == rampRequest.Id);
        Assert.Equal("RampAgent", pending.Kind);
        var rampAccount = await governance.ValidateRequestAsync(HumanResourcesAccount, pending.Id,
            new DecideUserAccessInput(pending.Version, EmployeePassword), cancellationToken);
        Assert.True(rampAccount.IsSuccess, rampAccount.Code);
        var accountId = await context.Users.AsNoTracking().Where(item => item.PublicId == rampAccount.Id)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        Assert.Equal(["RAMP_AGENT"], await (from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
                                           join role in context.Roles.AsNoTracking() on link.RoleId equals role.Id
                                           where link.UserId == accountId
                                           select role.NormalizedName).ToArrayAsync(cancellationToken));
        Assert.True(await context.Set<Elevant.Domain.Entities.Workforce.RampAgentTerminalScope>().AnyAsync(scope =>
            scope.RampAgentId == agent.Id && scope.ValidTo == null, cancellationToken));
        Assert.Equal(1, await context.RampAgents.CountAsync(item => item.PersonId == person, cancellationToken));

        // The super administrator names administrators from employees only; members are requested.
        var lead = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Paula", "QA-CON-020", "40299887766",
            "contracts", commercial.Id, "paula.lider@dev.elevant.test"), cancellationToken);
        Assert.True(lead.IsSuccess, lead.Code);
        Assert.Equal("members_are_requested", (await governance.CreateMemberAsync(SuperAdministratorAccount, "contracts",
            new CreateDepartmentAccountInput(null, null, null, EmployeePassword, [PujStation], EmployeeId: lead.Id),
            cancellationToken)).Code);
        Assert.Equal(GovernanceFailure.Forbidden, (await governance.CreateAdministratorAsync(HumanResourcesAccount,
            "contracts", new CreateDepartmentAccountInput(null, null, null, EmployeePassword, [PujStation],
                EmployeeId: lead.Id), null, cancellationToken)).Failure);
        var administrator = await governance.CreateAdministratorAsync(SuperAdministratorAccount, "contracts",
            new CreateDepartmentAccountInput(null, null, null, EmployeePassword, [PujStation], EmployeeId: lead.Id),
            null, cancellationToken);
        Assert.True(administrator.IsSuccess, administrator.Code);
        Assert.Equal(DepartmentAssignmentKind.Administrator, await (from user in context.Users.AsNoTracking()
                                                                   join assignment in context.DepartmentAssignments.AsNoTracking()
                                                                       on user.Id equals assignment.AccountId
                                                                   where user.PublicId == administrator.Id
                                                                   select assignment.Kind).SingleAsync(cancellationToken));

        // Expand phase: a request typed by name still works and leaves an account awaiting its HR record.
        var legacy = await governance.RequestAccessAsync(FinanceAccount, "finance",
            new RequestUserAccessInput(Guid.NewGuid(), "BackOfficeUser", "Legado", "Escrito", "legado@dev.elevant.test",
                [PujStation], PermissionCodes: ["finance.home.read"]), cancellationToken);
        Assert.True(legacy.IsSuccess, legacy.Code);
        var legacyRequest = Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "finance", "Pending", 1,
            25, cancellationToken))!.Requests, item => item.Id == legacy.Id);
        var legacyAccount = await governance.ValidateRequestAsync(HumanResourcesAccount, legacyRequest.Id,
            new DecideUserAccessInput(legacyRequest.Version, EmployeePassword), cancellationToken);
        Assert.True(legacyAccount.IsSuccess);
        var unregistered = Assert.Single((await hr.ListUnregisteredAsync(HumanResourcesAccount, cancellationToken))!,
            item => item.AccountId == legacyAccount.Id);
        Assert.Equal("finance", unregistered.Department);
        var analyst = Assert.Single(positions, position => position.Name == "Analista de facturación");
        var registered = await hr.RegisterEmployeeAsync(HumanResourcesAccount,
            new RegisterEmployeeInput("CEDULA", "403-0000001-1", "QA-FIN-099", analyst.Id, new DateOnly(2026, 2, 1),
                [PujStation], AccountId: legacyAccount.Id), cancellationToken);
        Assert.True(registered.IsSuccess, registered.Code);
        var legacyPerson = await (from user in context.Users.AsNoTracking()
                                  join item in context.Persons.AsNoTracking() on user.PersonId equals item.Id
                                  where user.PublicId == legacyAccount.Id
                                  select item).SingleAsync(cancellationToken);
        Assert.Equal(("CEDULA", "40300000011"), (legacyPerson.IdentificationType, legacyPerson.IdentificationNumber));
        Assert.DoesNotContain((await hr.ListUnregisteredAsync(HumanResourcesAccount, cancellationToken))!,
            item => item.AccountId == legacyAccount.Id);

        // Requisitions move forward only; Human Resources attends, the department cancels.
        var requisition = await hr.CreateRequisitionAsync(FinanceAccount, "finance",
            new CreateRequisitionInput(Guid.NewGuid(), analyst.Id, 2, "Temporada alta de facturación"), cancellationToken);
        Assert.True(requisition.IsSuccess, requisition.Code);
        Assert.Equal(GovernanceFailure.Forbidden, (await hr.CreateRequisitionAsync(ContractsAccount, "finance",
            new CreateRequisitionInput(Guid.NewGuid(), analyst.Id, 1, "Ajena"), cancellationToken)).Failure);
        async Task<RequisitionData> ReadAsync() =>
            (await hr.ListRequisitionsAsync(HumanResourcesAccount, "finance", null, cancellationToken))!
                .Single(item => item.Id == requisition.Id);
        Assert.Equal(GovernanceFailure.Forbidden, (await hr.ChangeRequisitionStatusAsync(FinanceAccount, requisition.Id!.Value,
            new ChangeRequisitionStatusInput("InProgress", (await ReadAsync()).Version), cancellationToken)).Failure);
        Assert.True((await hr.ChangeRequisitionStatusAsync(HumanResourcesAccount, requisition.Id.Value,
            new ChangeRequisitionStatusInput("InProgress", (await ReadAsync()).Version), cancellationToken)).IsSuccess);
        Assert.Equal("reason_required", (await hr.ChangeRequisitionStatusAsync(HumanResourcesAccount, requisition.Id.Value,
            new ChangeRequisitionStatusInput("Rejected", (await ReadAsync()).Version), cancellationToken)).Code);
        Assert.True((await hr.ChangeRequisitionStatusAsync(HumanResourcesAccount, requisition.Id.Value,
            new ChangeRequisitionStatusInput("Fulfilled", (await ReadAsync()).Version), cancellationToken)).IsSuccess);
        Assert.Equal(GovernanceFailure.Conflict, (await hr.ChangeRequisitionStatusAsync(FinanceAccount, requisition.Id.Value,
            new ChangeRequisitionStatusInput("Cancelled", (await ReadAsync()).Version, "Ya no hace falta"), cancellationToken)).Failure);
        Assert.Equal("Fulfilled", (await ReadAsync()).Status);
    }
}
