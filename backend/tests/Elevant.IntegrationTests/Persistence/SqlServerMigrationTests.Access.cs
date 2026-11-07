using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Common;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 2, block E: shared tablets (2-N02), transferred employees and their requests (2-N07, 2-N33, 2-N17, 2-N18),
/// legacy custom members and employee stations (2-N19, 2-N21), the governance commands with an Idempotency-Key
/// (2-N39) and the airline's representatives and signers (2-N20).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid AccessPortalAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
    private static readonly Guid AccessContractVersion = Guid.Parse("60000000-0000-7000-8000-000000000003");

    /// <summary>A new ramp employee with its validated app account; answers (employee, account, ramp agent key).</summary>
    private static async Task<(Guid Employee, Guid Account, long Agent)> RampAccountAsync(ServiceProvider provider,
        string firstName, string number, string identification, string email, CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var ramp = Assert.Single((await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!,
            position => position.IsRampPosition);
        var employee = await hr.CreateEmployeeAsync(HumanResourcesAccount,
            NewEmployee(firstName, number, identification, "operations", ramp.Id, email), ct);
        Assert.True(employee.IsSuccess, employee.Code);
        var requested = await governance.RequestAccessAsync(OperationsAdministrator, "operations",
            new RequestUserAccessInput(Guid.NewGuid(), null, null, null, null, [PujStation], TerminalIds: [PujTerminal],
                EmployeeId: employee.Id), ct);
        Assert.True(requested.IsSuccess, requested.Code);
        var pending = Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "operations", "Pending", 1,
            25, ct))!.Requests, item => item.Id == requested.Id);
        var account = await governance.ValidateRequestAsync(HumanResourcesAccount, pending.Id,
            new DecideUserAccessInput(pending.Version, EmployeePassword), ct);
        Assert.True(account.IsSuccess, account.Code);
        var person = await context.Employees.AsNoTracking().Where(item => item.PublicId == employee.Id)
            .Select(item => item.PersonId).SingleAsync(ct);
        var agent = await context.RampAgents.AsNoTracking().Where(item => item.PersonId == person).Select(item => item.Id)
            .SingleAsync(ct);
        return (employee.Id!.Value, account.Id!.Value, agent);
    }

    [Fact]
    public async Task SharedTabletsPassBetweenAgentsAndOccFreesOrRevokesThem()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var tablet = Guid.Parse("81000000-0000-7000-8000-0000000000e1");
        var (andresEmployee, andres, andresAgent) = await RampAccountAsync(provider, "Andrés", "QA-RA-077", "40212345678",
            "andres.tablet@dev.elevant.test", ct);

        async Task<MobileDeviceRegistrationWriteResult> RegisterAsync(Guid account, Guid installation)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
                new MobileDeviceRegistrationWriteRequest(account, installation, MobilePlatform.Android, "1.2.3",
                    "Tablet T-07", "Android 16"), ct);
        }
        async Task<MobileDeviceReleaseWriteResult> ReleaseAsync(Guid account, Guid installation, Guid key)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IMobileDeviceCommandStore>().ReleaseAsync(
                new MobileDeviceReleaseWriteRequest(account, installation, key), ct);
        }
        async Task<OccMobileDeviceData?> OccDeviceAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            var listed = await scope.ServiceProvider.GetRequiredService<IMobileDeviceAdministrationStore>()
                .ListAsync(OperationsAdministrator, PujStation, ct);
            Assert.Null(listed.Failure);
            return listed.Value!.Devices.SingleOrDefault(item => item.DeviceName == "Tablet T-07");
        }
        async Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> OccAsync(string command, Guid deviceId,
            string version, Guid key, string? reason = null)
        {
            await using var scope = provider.CreateAsyncScope();
            var store = scope.ServiceProvider.GetRequiredService<IMobileDeviceAdministrationStore>();
            return command == "unbind"
                ? await store.UnbindAsync(OperationsAdministrator, deviceId, new UnbindMobileDeviceInput(version, reason), key, ct)
                : await store.RevokeAsync(OperationsAdministrator, deviceId, new RevokeMobileDeviceInput(version, reason), key, ct);
        }

        // Riley holds the tablet while working an operation: Andrés cannot take it (2-N02).
        Assert.True((await RegisterAsync(SeededRampAgentAccount, tablet)).IsSuccess);
        long inProgress;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var fixture = await ReleaseFixtureAsync(setup, ct);
            inProgress = await AddAgentOperationAsync(setup, fixture, "TABLET-IN-PROGRESS", BusinessCalendar.Today(
                DateTimeOffset.UtcNow), fixture.AgentKey, GroundOperationStatus.InProgress, ct);
        }
        var busy = await RegisterAsync(andres, tablet);
        Assert.Equal((MobileDeviceRegistrationWriteFailure.Conflict, MobileDeviceCodes.InUseByActiveAgent),
            (busy.Failure, busy.Code));
        var held = (await OccDeviceAsync())!;
        Assert.Equal(("Bound", true), (held.Status, held.AgentHasOperationInProgress));

        // Without operations in progress the next agent takes it, and the previous binding closes with an audit.
        await using (var release = CreateContext(database.ConnectionString))
            await release.OperationAgentAssignments.Where(item => item.GroundOperationId == inProgress)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ReleasedAt, DateTimeOffset.UtcNow), ct);
        Assert.True((await RegisterAsync(andres, tablet)).IsSuccess);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var device = await check.MobileDevices.AsNoTracking().SingleAsync(item => item.InstallationId == tablet, ct);
            var bindings = await check.Set<MobileDeviceAccountBinding>().AsNoTracking()
                .Where(item => item.MobileDeviceId == device.Id).OrderBy(item => item.BoundAt).ToArrayAsync(ct);
            Assert.Equal(2, bindings.Length);
            Assert.NotNull(bindings[0].UnboundAt);
            Assert.Null(bindings[1].UnboundAt);
            Assert.Equal(1, await check.AuditEntries.CountAsync(item => item.EntityPublicId == device.PublicId &&
                item.Action == "mobile_device.binding_taken_over", ct));
            // OCC hears it on its tablet screen.
            Assert.Contains((await check.OutboxMessages.AsNoTracking().Where(item => item.EventType == "account.changed.v1")
                    .ToArrayAsync(ct)).Select(Elevant.Persistence.Realtime.AccountChangeOutboxWriter.Decode),
                item => item.Resource == "mobile_devices" && item.ResourceId == device.PublicId);
        }

        // Signing out frees it; a replay answers the same and another key finds nothing to release.
        var releaseKey = Guid.NewGuid();
        Assert.True((await ReleaseAsync(andres, tablet, releaseKey)).IsSuccess);
        Assert.True((await ReleaseAsync(andres, tablet, releaseKey)).IsSuccess);
        var again = await ReleaseAsync(andres, tablet, Guid.NewGuid());
        Assert.Equal((MobileDeviceReleaseWriteFailure.Conflict, MobileDeviceCodes.NotBound), (again.Failure, again.Code));
        var free = (await OccDeviceAsync())!;
        Assert.Equal("Unbound", free.Status);
        Assert.Equal(andres, free.Agent!.AccountId);

        // OCC frees a tablet with the binding token it saw; a stale token is refused and a replay never repeats it.
        Assert.True((await RegisterAsync(andres, tablet)).IsSuccess);
        var bound = (await OccDeviceAsync())!;
        Assert.Equal("version_conflict", (await OccAsync("unbind", bound.Id, free.Version, Guid.NewGuid())).Code);
        var unbindKey = Guid.NewGuid();
        var unbound = await OccAsync("unbind", bound.Id, bound.Version, unbindKey, "Fin del turno de Andrés");
        Assert.Equal("Unbound", unbound.Value!.Status);
        var replay = await OccAsync("unbind", bound.Id, bound.Version, unbindKey, "Fin del turno de Andrés");
        Assert.True(replay.Replayed);
        Assert.Equal(MobileDeviceCodes.NotBound, (await OccAsync("unbind", bound.Id, unbound.Value.Version,
            Guid.NewGuid())).Code);
        await using (var audit = CreateContext(database.ConnectionString))
            Assert.Equal(1, await audit.AuditEntries.CountAsync(item => item.EntityPublicId == bound.Id &&
                item.Action == "mobile_device.binding_closed" && item.Reason == "Fin del turno de Andrés", ct));

        // A lost tablet is revoked with a reason: its installation never registers again and the holder's sessions end.
        Assert.True((await RegisterAsync(SeededRampAgentAccount, tablet)).IsSuccess);
        string stampBefore;
        await using (var stamps = CreateContext(database.ConnectionString))
            stampBefore = (await stamps.Users.AsNoTracking().SingleAsync(item => item.PublicId == SeededRampAgentAccount, ct))
                .SecurityStamp!;
        var lost = (await OccDeviceAsync())!;
        Assert.Equal("reason_required", (await OccAsync("revoke", lost.Id, lost.Version, Guid.NewGuid())).Code);
        var revoked = await OccAsync("revoke", lost.Id, lost.Version, Guid.NewGuid(), "Tablet extraviada en la rampa");
        Assert.Equal("Revoked", revoked.Value!.Status);
        Assert.NotNull(revoked.Value.RevokedAt);
        var refused = await RegisterAsync(SeededRampAgentAccount, tablet);
        Assert.Equal((MobileDeviceRegistrationWriteFailure.Forbidden, MobileDeviceCodes.Revoked), (refused.Failure, refused.Code));
        await using (var stamps = CreateContext(database.ConnectionString))
            Assert.NotEqual(stampBefore, (await stamps.Users.AsNoTracking()
                .SingleAsync(item => item.PublicId == SeededRampAgentAccount, ct)).SecurityStamp);

        // The termination of the agent frees the tablets it holds inside the release path of its ramp duty (2-N06).
        var second = Guid.Parse("81000000-0000-7000-8000-0000000000e2");
        Assert.True((await RegisterAsync(andres, second)).IsSuccess);
        await using (var scope = provider.CreateAsyncScope())
        {
            var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
            var detail = (await hr.GetEmployeeAsync(HumanResourcesAccount, andresEmployee, ct))!;
            var terminated = await hr.TerminateEmployeeAsync(HumanResourcesAccount, andresEmployee,
                new TerminateEmployeeInput(BusinessCalendar.Today(DateTimeOffset.UtcNow), "Renuncia voluntaria",
                    detail.Summary.Version), Guid.NewGuid(), ct);
            Assert.True(terminated.IsSuccess, terminated.Code);
        }
        await using (var check = CreateContext(database.ConnectionString))
        {
            var device = await check.MobileDevices.AsNoTracking().SingleAsync(item => item.InstallationId == second, ct);
            Assert.False(await check.Set<MobileDeviceAccountBinding>().AnyAsync(item =>
                item.MobileDeviceId == device.Id && item.UnboundAt == null, ct));
            var closed = Assert.Single(await check.AuditEntries.AsNoTracking().Where(item =>
                item.EntityPublicId == device.PublicId && item.Action == "mobile_device.binding_closed").ToArrayAsync(ct));
            Assert.Equal("empleado dado de baja", closed.Reason);
            Assert.False((await check.RampAgents.AsNoTracking().SingleAsync(item => item.Id == andresAgent, ct)).IsActive);
        }
    }

    [Fact]
    public async Task TransfersRetireTheRolesOfTheDepartmentLeftAndItsAdministratorsRequestsEnd()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var positions = (await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!;
        var analyst = Assert.Single(positions, position => position.Name == "Analista de facturación");
        var commercial = Assert.Single(positions, position => position.Name == "Analista comercial");
        var accountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
        var humanResources = await context.Users.AsNoTracking().Where(item => item.PublicId == HumanResourcesAccount)
            .Select(item => item.Id).SingleAsync(ct);

        // Two avatars uploaded for the requests: one survives, the other one the cleanup already removed.
        var finance = await context.Users.AsNoTracking().Where(item => item.PublicId == accountId).Select(item => item.Id)
            .SingleAsync(ct);
        MediaAsset Avatar() => new()
        {
            PublicId = Guid.CreateVersion7(), Purpose = "avatar", ObjectKey = $"avatar/{Guid.NewGuid():N}",
            ContentType = "image/png", Length = 68, Sha256 = new string('a', 64), UploadedByAccountId = finance,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var kept = Avatar();
        var lost = Avatar();
        context.MediaAssets.AddRange(kept, lost);
        await context.SaveChangesAsync(ct);

        async Task<Guid> EmployeeAsync(string name, string number, string identification, string email)
        {
            var created = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee(name, number, identification,
                "finance", analyst.Id, email), ct);
            Assert.True(created.IsSuccess, created.Code);
            return created.Id!.Value;
        }
        async Task<AccessRequestData> RequestAsync(Guid requester, Guid employee, string? avatar)
        {
            var requested = await governance.RequestAccessAsync(requester, "finance",
                new RequestUserAccessInput(Guid.NewGuid(), null, null, null, null, [PujStation], AvatarMediaUrl: avatar,
                    PermissionCodes: ["finance.home.read"], EmployeeId: employee), ct);
            Assert.True(requested.IsSuccess, requested.Code);
            return Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "finance", "Pending", 1, 50,
                ct))!.Requests, item => item.Id == requested.Id);
        }

        // 2-N18: a request for an employee reaches Gestión Humana's bell.
        var lucia = await EmployeeAsync("Lucía", "QA-FIN-031", "00112345673", "lucia.traslado@dev.elevant.test");
        var request = await RequestAsync(accountId, lucia, $"/api/v1/media/{kept.PublicId}");
        Assert.True(await context.DepartmentNotifications.AsNoTracking().AnyAsync(item =>
            item.RecipientAccountId == humanResources && item.Kind == "access_request" && item.SourceId == request.Id, ct));
        // 2-N17: while the request waits, its validator and its requester read the photo; other departments do not.
        var mediaStore = scope.ServiceProvider.GetRequiredService<ICommercialMediaStore>();
        Assert.NotNull(await mediaStore.GetReadableAsync(kept.PublicId, HumanResourcesAccount, ct));
        Assert.NotNull(await mediaStore.GetReadableAsync(kept.PublicId, accountId, ct));
        Assert.Null(await mediaStore.GetReadableAsync(kept.PublicId, ContractsAccount, ct));
        var validated = await governance.ValidateRequestAsync(HumanResourcesAccount, request.Id,
            new DecideUserAccessInput(request.Version, EmployeePassword), ct);
        Assert.True(validated.IsSuccess, validated.Code);
        var account = await context.Users.AsNoTracking().SingleAsync(item => item.PublicId == validated.Id, ct);
        Assert.Equal($"/api/v1/media/{kept.PublicId}", (await context.Persons.AsNoTracking()
            .SingleAsync(item => item.Id == account.PersonId, ct)).AvatarMediaUrl);

        // A photo the cleanup removed before the approval is left out; the account is still issued.
        var mario = await EmployeeAsync("Mario", "QA-FIN-032", "00299999995", "mario.traslado@dev.elevant.test");
        var withoutPhoto = await RequestAsync(accountId, mario, $"/api/v1/media/{lost.PublicId}");
        await context.MediaAssets.Where(item => item.Id == lost.Id).ExecuteDeleteAsync(ct);
        var issued = await governance.ValidateRequestAsync(HumanResourcesAccount, withoutPhoto.Id,
            new DecideUserAccessInput(withoutPhoto.Version, EmployeePassword), ct);
        Assert.True(issued.IsSuccess, issued.Code);
        Assert.Null((await (from user in context.Users.AsNoTracking()
                            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                            where user.PublicId == issued.Id
                            select person).SingleAsync(ct)).AvatarMediaUrl);

        // 2-N07: the transfer retires the roles of Finance; Finance no longer lists the account, the assignment stays.
        var detail = (await hr.GetEmployeeAsync(HumanResourcesAccount, lucia, ct))!;
        Assert.True((await hr.TransferEmployeeAsync(HumanResourcesAccount, lucia, new TransferEmployeeInput("contracts",
            commercial.Id, [PujStation], "Reubicación comercial", detail.Summary.Version), Guid.NewGuid(), ct)).IsSuccess);
        Assert.Empty(await context.Set<IdentityUserRole<long>>().AsNoTracking().Where(link => link.UserId == account.Id)
            .ToArrayAsync(ct));
        Assert.Equal(Department.Finance, (await context.DepartmentAssignments.AsNoTracking()
            .SingleAsync(item => item.AccountId == account.Id, ct)).Department);
        Assert.DoesNotContain((await governance.ListUsersAsync(accountId, "finance", 1, 100, null, null, null, null, null,
            ct))!.Users, user => user.Id == validated.Id);
        Assert.Contains(await context.AuditEntries.AsNoTracking().Where(item => item.EntityPublicId == validated.Id)
            .Select(item => item.Action).ToArrayAsync(ct), action => action == "governance.department_user.access_retired");
        // An account transferred before this rule still holds the old role: Finance cannot bring it back.
        var financeRole = await context.Roles.AsNoTracking().SingleAsync(item => item.NormalizedName == "FINANZAS", ct);
        context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long> { UserId = account.Id, RoleId = financeRole.Id });
        await context.SaveChangesAsync(ct);
        var legacy = Assert.Single((await governance.ListUsersAsync(SuperAdministratorAccount, "finance", 1, 100, null, null,
            null, null, null, ct))!.Users, user => user.Id == validated.Id);
        Assert.Equal("employee_transferred", (await governance.SetUserStatusAsync(SuperAdministratorAccount, "finance",
            legacy.Id, new SetDepartmentUserStatusInput(true, legacy.Version), null, ct)).Code);
        Assert.Equal("employee_transferred", (await governance.UpdateUserAsync(SuperAdministratorAccount, "finance",
            legacy.Id, new UpdateDepartmentUserInput(legacy.FirstName, legacy.LastName, legacy.Email, [PujStation],
                legacy.Version, PermissionCodes: ["finance.home.read"]), null, ct)).Code);

        // 2-N33: the pending requests of an administrator that leaves the department are cancelled with it, and one
        // that stops administering it cannot see its requests validated.
        var lead = await EmployeeAsync("Paula", "QA-FIN-033", "40299887766", "paula.lider@dev.elevant.test");
        var leadAccount = await governance.CreateAdministratorAsync(SuperAdministratorAccount, "finance",
            new CreateDepartmentAccountInput(null, null, null, EmployeePassword, [PujStation], EmployeeId: lead), null, ct);
        Assert.True(leadAccount.IsSuccess, leadAccount.Code);
        var nora = await EmployeeAsync("Nora", "QA-FIN-034", "40212345678", "nora.pendiente@dev.elevant.test");
        var orphan = await RequestAsync(leadAccount.Id!.Value, nora, null);
        var leadDetail = (await hr.GetEmployeeAsync(HumanResourcesAccount, lead, ct))!;
        Assert.True((await hr.TransferEmployeeAsync(HumanResourcesAccount, lead, new TransferEmployeeInput("contracts",
            commercial.Id, [PujStation], "Promoción", leadDetail.Summary.Version), Guid.NewGuid(), ct)).IsSuccess);
        var cancelled = await context.UserAccessRequests.AsNoTracking().SingleAsync(item => item.PublicId == orphan.Id, ct);
        Assert.Equal(UserAccessRequestStatus.Cancelled, cancelled.Status);
        Assert.Equal("Quien la solicitó ya no administra el departamento", cancelled.DecisionReason);

        var otto = await EmployeeAsync("Otto", "QA-FIN-035", "00100000017", "otto.pendiente@dev.elevant.test");
        var stale = await RequestAsync(accountId, otto, null);
        var financeAdministrator = Assert.Single((await governance.ListUsersAsync(SuperAdministratorAccount, "finance", 1,
            100, null, null, null, null, null, ct))!.Users, user => user.Id == accountId);
        Assert.True((await governance.SetUserStatusAsync(SuperAdministratorAccount, "finance", accountId,
            new SetDepartmentUserStatusInput(false, financeAdministrator.Version), null, ct)).IsSuccess);
        Assert.Equal("requester_no_longer_administrator", (await governance.ValidateRequestAsync(HumanResourcesAccount,
            stale.Id, new DecideUserAccessInput(stale.Version, EmployeePassword), ct)).Code);
    }

    [Fact]
    public async Task LegacyCustomMembersKeepTheirAccessAndEmployeeAccountsTheirStations()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var legacy = scope.ServiceProvider.GetRequiredService<IGovernanceStore>();
        var actors = scope.ServiceProvider.GetRequiredService<IActorContextResolver>();
        var hr = scope.ServiceProvider.GetRequiredService<IEmployeeGovernanceStore>();

        // Accounts the retired role editor left behind (2-N38 keeps them working).
        var role = await legacy.CreateRoleAsync(SuperAdministratorAccount,
            new SaveGovernanceRoleInput("Ventas heredadas", null, ["commercial.requests.read"], true), ct);
        Assert.True(role.IsSuccess, role.Code);
        async Task<Guid> LegacyMemberAsync(string name, string email)
        {
            var created = await legacy.CreateUserAsync(SuperAdministratorAccount,
                new CreateGovernanceUserInput(name, "Heredado", email, role.Id!.Value, "Synthetic-Legacy!2026"), ct);
            Assert.True(created.IsSuccess, created.Code);
            return created.Id!.Value;
        }
        var edited = await LegacyMemberAsync("Elena", "elena.ventas@dev.elevant.test");
        var broken = await LegacyMemberAsync("Bruno", "bruno.ventas@dev.elevant.test");
        var untouched = await LegacyMemberAsync("Tomás", "tomas.ventas@dev.elevant.test");
        var stations = await context.Stations.AsNoTracking().Where(item => item.PublicId == PujStation).Select(item => item.Id)
            .ToArrayAsync(ct);
        foreach (var member in new[] { edited, broken, untouched })
        {
            var id = await context.Users.AsNoTracking().Where(item => item.PublicId == member).Select(item => item.Id)
                .SingleAsync(ct);
            if (!await context.AccountStationScopes.AnyAsync(item => item.AccountId == id && item.RevokedAt == null, ct))
                context.AccountStationScopes.Add(new AccountStationScope { AccountId = id, StationId = stations[0],
                    GrantedAt = DateTimeOffset.UtcNow });
        }
        await context.SaveChangesAsync(ct);

        // 2-N19: editing a CUSTOM_* member makes it a Contracts member with the chosen permissions, in one step.
        var row = Assert.Single((await governance.ListUsersAsync(ContractsAccount, "contracts", 1, 100, null, null, null,
            null, "elena", ct))!.Users);
        Assert.True((await governance.UpdateUserAsync(ContractsAccount, "contracts", row.Id, new UpdateDepartmentUserInput(
            row.FirstName, row.LastName, row.Email, [PujStation], row.Version, PermissionCodes: ["contracts.catalog.read"]),
            null, ct)).IsSuccess);
        var elena = (await actors.ResolveAsync(edited, ct))!;
        Assert.True(elena.HasPermission("contracts.catalog.read"));
        Assert.False(elena.HasPermission("contracts.requests.read"));
        var elenaId = await context.Users.AsNoTracking().Where(item => item.PublicId == edited).Select(item => item.Id)
            .SingleAsync(ct);
        Assert.Equal(["CONTRATOS"], await (from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
                                          join item in context.Roles.AsNoTracking() on link.RoleId equals item.Id
                                          where link.UserId == elenaId
                                          select item.NormalizedName).ToArrayAsync(ct));
        Assert.Single((await governance.ListUsersAsync(ContractsAccount, "contracts", 1, 100, null, null, null, null, "elena",
            ct))!.Users);

        // A member edited the old way (assignment without CONTRATOS) works again, and the conversion keeps its grants.
        var brunoId = await context.Users.AsNoTracking().Where(item => item.PublicId == broken).Select(item => item.Id)
            .SingleAsync(ct);
        context.DepartmentAssignments.Add(new DepartmentAssignment
        {
            PublicId = Guid.CreateVersion7(), AccountId = brunoId, Kind = DepartmentAssignmentKind.Member,
            Department = Department.Contracts, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        context.AccountPermissionGrants.Add(new AccountPermissionGrant { AccountId = brunoId, PermissionCode = "contracts.reports.read" });
        await context.SaveChangesAsync(ct);
        Assert.True((await actors.ResolveAsync(broken, ct))!.HasPermission("contracts.reports.read"));
        var legacyRole = Assert.Single((await governance.ListLegacyRolesAsync(SuperAdministratorAccount, ct))!);
        Assert.Equal("expected_version_required", (await governance.ConvertLegacyRoleAsync(SuperAdministratorAccount,
            legacyRole.Id, null, Guid.NewGuid(), ct)).Code);
        var key = Guid.NewGuid();
        var converted = await governance.ConvertLegacyRoleAsync(SuperAdministratorAccount, legacyRole.Id,
            new ConvertLegacyRoleInput(legacyRole.Version), key, ct);
        Assert.True(converted.IsSuccess, converted.Code);
        Assert.Equal(converted.Id, (await governance.ConvertLegacyRoleAsync(SuperAdministratorAccount, legacyRole.Id,
            new ConvertLegacyRoleInput(legacyRole.Version), key, ct)).Id);
        var bruno = (await actors.ResolveAsync(broken, ct))!;
        Assert.True(bruno.HasPermission("contracts.reports.read"));
        Assert.False(bruno.HasPermission("contracts.requests.read"));
        Assert.Null((await context.DepartmentAssignments.AsNoTracking().SingleAsync(item => item.AccountId == brunoId, ct))
            .AccessProfileId);
        Assert.True((await actors.ResolveAsync(untouched, ct))!.HasPermission("contracts.requests.read"));

        // 2-N21: the stations of an employee's account come from the employee record, even for the super administrator.
        var mia = await context.Stations.SingleOrDefaultAsync(item => item.Code == "MIA", ct);
        if (mia is null)
        {
            mia = new Elevant.Domain.Entities.Reference.Station
            {
                PublicId = Guid.CreateVersion7(), AirportId = (await context.Airports.SingleAsync(item => item.IataCode == "MIA",
                    ct)).Id, Code = "MIA", Name = "AVIAM MIA Test", IanaTimeZone = "America/New_York", IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            };
            context.Stations.Add(mia);
            await context.SaveChangesAsync(ct);
        }
        var analyst = Assert.Single((await hr.ListPositionsAsync(HumanResourcesAccount, null, ct))!,
            position => position.Name == "Analista de facturación");
        var employee = await hr.CreateEmployeeAsync(HumanResourcesAccount, NewEmployee("Lía", "QA-FIN-041", "00112345673",
            "finance", analyst.Id, "lia.estaciones@dev.elevant.test"), ct);
        var requested = await governance.RequestAccessAsync(FinanceAccount, "finance", new RequestUserAccessInput(
            Guid.NewGuid(), null, null, null, null, [PujStation], PermissionCodes: ["finance.home.read"],
            EmployeeId: employee.Id), ct);
        var pending = Assert.Single((await governance.ListRequestsAsync(HumanResourcesAccount, "finance", "Pending", 1, 50,
            ct))!.Requests, item => item.Id == requested.Id);
        var account = await governance.ValidateRequestAsync(HumanResourcesAccount, pending.Id,
            new DecideUserAccessInput(pending.Version, EmployeePassword), ct);
        var user = Assert.Single((await governance.ListUsersAsync(SuperAdministratorAccount, "finance", 1, 100, null, null,
            null, null, null, ct))!.Users, item => item.Id == account.Id);
        Assert.Equal([PujStation], user.EmployeeStations!.Select(item => item.Id));
        Assert.Equal("stations_outside_employee", (await governance.UpdateUserAsync(SuperAdministratorAccount, "finance",
            user.Id, new UpdateDepartmentUserInput(user.FirstName, user.LastName, user.Email, [PujStation, mia.PublicId],
                user.Version, PermissionCodes: ["finance.home.read"]), null, ct)).Code);

        // 2-N39: a status change with its key replays without a second audit; the key with another body conflicts.
        var statusKey = Guid.NewGuid();
        var off = new SetDepartmentUserStatusInput(false, user.Version);
        Assert.True((await governance.SetUserStatusAsync(SuperAdministratorAccount, "finance", user.Id, off, statusKey, ct))
            .IsSuccess);
        Assert.True((await governance.SetUserStatusAsync(SuperAdministratorAccount, "finance", user.Id, off, statusKey, ct))
            .IsSuccess);
        Assert.Equal("idempotency_conflict", (await governance.SetUserStatusAsync(SuperAdministratorAccount, "finance",
            user.Id, off with { IsActive = true }, statusKey, ct)).Code);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item => item.EntityPublicId == user.Id &&
            item.Action == "governance.department_user.deactivated", ct));
    }

    [Fact]
    public async Task PortalRepresentativesManageTheirUsersAndOnlySignersSign()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await PortalAccountsProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var portal = scope.ServiceProvider.GetRequiredService<IAirlinePortalUserStore>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var permits = scope.ServiceProvider.GetRequiredService<IAirlinePermitStore>();
        var organization = await (from membership in context.OrganizationMemberships.AsNoTracking()
                                  join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                                  join item in context.Organizations.AsNoTracking() on membership.OrganizationId equals item.Id
                                  where user.PublicId == AccessPortalAccount && membership.Kind == MembershipKind.AirlineClient
                                  select item).SingleAsync(ct);

        // The account provisioned for the airline represents it until AVIAM designates others.
        var mine = (await portal.ListAsync(AccessPortalAccount, ct))!;
        Assert.True(mine.Me.Representative && mine.Me.CanManageUsers && mine.Me.CanSign);

        // AVIAM adds a user with a temporary password: it reads contracts but neither signs nor submits the permit.
        var created = await governance.CreateClientUserAsync(SuperAdministratorAccount, organization.PublicId,
            new CreateClientUserInput("Luis", "Linares", "luis.firmas@demo-air.example.com", "Synthetic-Portal-Signer!2026"),
            Guid.NewGuid(), ct);
        Assert.True(created.IsSuccess, created.Code);
        var luis = created.Id!.Value;
        Assert.True(await context.EmailOutbox.AsNoTracking().AnyAsync(item => item.Purpose == EmailPurpose.PortalUserChanged &&
            item.Recipient == PortalEmailAddress, ct));
        var signature = new SignContractInput(Guid.NewGuid(), "Luis Linares", "Coordinador", new string('a', 64), true,
            SignaturePng);
        var unsigned = await documents.SignAsync(luis, AccessContractVersion, signature, ct);
        Assert.Equal((ContractDocumentFailure.Forbidden, "signer_required"), (unsigned.Failure, unsigned.Code));
        var permit = new SubmitAirlinePermitInput(nameof(AirlinePermitKind.OperatingPermit), "JAC-2026-E01", "JAC",
            BusinessCalendar.Today(DateTimeOffset.UtcNow).AddDays(-10), BusinessCalendar.Today(DateTimeOffset.UtcNow).AddYears(1),
            null);
        Assert.Equal("signer_required", (await permits.SubmitAsync(luis, permit, Guid.NewGuid(), ct)).Code);
        var luisView = (await portal.ListAsync(luis, ct))!;
        Assert.False(luisView.Me.CanSign || luisView.Me.CanManageUsers);
        Assert.Equal("representative_required", (await portal.InviteAsync(luis,
            new InviteAirlinePortalUserInput("Otro", "Usuario", "otro@demo-air.example.com"), Guid.NewGuid(), ct)).Code);

        // The representative marks the signer with the version on screen; a replay answers the same user.
        var row = Assert.Single(luisView.Users, item => item.Id == luis);
        var signerKey = Guid.NewGuid();
        var marked = await portal.SetSignerAsync(AccessPortalAccount, luis, new SetAirlinePortalUserSignerInput(true, row.Version),
            signerKey, ct);
        Assert.True(marked.User!.Signer, marked.Code);
        Assert.True((await portal.SetSignerAsync(AccessPortalAccount, luis,
            new SetAirlinePortalUserSignerInput(true, row.Version), signerKey, ct)).Replayed);
        Assert.Equal("version_conflict", (await portal.SetSignerAsync(AccessPortalAccount, luis,
            new SetAirlinePortalUserSignerInput(false, row.Version), Guid.NewGuid(), ct)).Code);
        Assert.True((await permits.SubmitAsync(luis, permit, Guid.NewGuid(), ct)).Failure is null);

        // Representatives never change themselves; AVIAM designates others and the last active one keeps the role.
        var representative = Assert.Single(mine.Users, item => item.Id == AccessPortalAccount);
        Assert.Equal("portal_user_protected", (await portal.SetStatusAsync(AccessPortalAccount, AccessPortalAccount,
            new SetAirlinePortalUserStatusInput(false, representative.Version), Guid.NewGuid(), ct)).Code);
        var invited = await portal.InviteAsync(AccessPortalAccount,
            new InviteAirlinePortalUserInput("Marta", "Gómez", "marta.portal@demo-air.example.com", Signer: true),
            Guid.NewGuid(), ct);
        Assert.True(invited.User is { InvitationPending: true, Signer: true }, invited.Code);
        Assert.True(await context.EmailOutbox.AsNoTracking().AnyAsync(item => item.Purpose == EmailPurpose.Activation &&
            item.Recipient == "marta.portal@demo-air.example.com", ct));
        var listed = (await governance.ListClientUsersAsync(SuperAdministratorAccount, organization.PublicId, ct))!;
        var luisRow = Assert.Single(listed, item => item.Id == luis);
        var promoted = await governance.SetClientUserPortalRoleAsync(SuperAdministratorAccount, organization.PublicId, luis,
            new SetClientUserPortalRoleInput(true, true, luisRow.Version), Guid.NewGuid(), ct);
        Assert.True(promoted.IsSuccess, promoted.Code);
        var flags = (await governance.ListClientUsersAsync(SuperAdministratorAccount, organization.PublicId, ct))!;
        Assert.True(Assert.Single(flags, item => item.Id == luis).Representative);
        Assert.True(Assert.Single(flags, item => item.Id == AccessPortalAccount).Representative);
        Assert.Equal("portal_user_protected", (await portal.SetStatusAsync(AccessPortalAccount, luis,
            new SetAirlinePortalUserStatusInput(false, Assert.Single(flags, item => item.Id == luis).Version), Guid.NewGuid(),
            ct)).Code);
        var demoted = Assert.Single(flags, item => item.Id == AccessPortalAccount);
        Assert.True((await governance.SetClientUserPortalRoleAsync(SuperAdministratorAccount, organization.PublicId,
            AccessPortalAccount, new SetClientUserPortalRoleInput(false, false, demoted.Version), Guid.NewGuid(), ct)).IsSuccess);
        var last = Assert.Single((await governance.ListClientUsersAsync(SuperAdministratorAccount, organization.PublicId,
            ct))!, item => item.Id == luis);
        Assert.Equal("last_representative", (await governance.SetClientUserPortalRoleAsync(SuperAdministratorAccount,
            organization.PublicId, luis, new SetClientUserPortalRoleInput(false, true, last.Version), Guid.NewGuid(), ct)).Code);
        Assert.False((await portal.ListAsync(AccessPortalAccount, ct))!.Me.CanSign);
        Assert.True(await context.EmailOutbox.AsNoTracking().CountAsync(item => item.Purpose == EmailPurpose.PortalUserChanged,
            ct) >= 3);

        // With its designated representative deactivated the airline never falls back to the provisioned account AVIAM
        // took the role from: nobody signs until AVIAM reactivates or designates a representative.
        var only = Assert.Single((await governance.ListClientUsersAsync(SuperAdministratorAccount, organization.PublicId,
            ct))!, item => item.Id == luis);
        Assert.True((await governance.SetClientUserStatusAsync(SuperAdministratorAccount, organization.PublicId, luis,
            new SetDepartmentUserStatusInput(false, only.Version), Guid.NewGuid(), ct)).IsSuccess);
        var orphan = (await portal.ListAsync(AccessPortalAccount, ct))!;
        Assert.False(orphan.Me.Representative || orphan.Me.CanSign || orphan.Me.CanManageUsers);
        Assert.False(Assert.Single(orphan.Users, item => item.Id == AccessPortalAccount).Representative);
        Assert.Equal("signer_required", (await permits.SubmitAsync(AccessPortalAccount, permit with { Number = "JAC-2026-E02" },
            Guid.NewGuid(), ct)).Code);
    }
}
