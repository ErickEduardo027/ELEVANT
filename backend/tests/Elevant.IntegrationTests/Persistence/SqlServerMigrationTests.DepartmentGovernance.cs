using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid GovernanceOccAdmin = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid GovernanceHumanResources = Guid.Parse("40000000-0000-7000-8000-000000000004");
    private static readonly Guid GovernanceContracts = Guid.Parse("40000000-0000-7000-8000-000000000005");
    private static readonly Guid GovernanceSuperAdmin = Guid.Parse("40000000-0000-7000-8000-000000000007");

    [Fact]
    public async Task DepartmentGovernanceKeepsTwoLevelsAndHumanResourcesValidation()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededGovernanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var legacy = scope.ServiceProvider.GetRequiredService<IGovernanceStore>();
        var actors = scope.ServiceProvider.GetRequiredService<IActorContextResolver>();
        var puj = await context.Stations.SingleAsync(item => item.Code == "PUJ", cancellationToken);
        var mia = new Station
        {
            PublicId = Guid.CreateVersion7(), AirportId = (await context.Airports.SingleAsync(item =>
                item.IataCode == "MIA", cancellationToken)).Id,
            Code = "MIA", Name = "AVIAM MIA Test", IanaTimeZone = "America/New_York", IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        context.Stations.Add(mia);
        await context.SaveChangesAsync(cancellationToken);

        // Only the super administrator sees the global overview with every department.
        var overview = Assert.IsType<DepartmentsOverviewData>(await store.GetOverviewAsync(GovernanceSuperAdmin,
            cancellationToken));
        Assert.Equal(["human-resources", "contracts", "operations", "finance"],
            overview.Departments.Select(item => item.Department));
        Assert.Equal(1, Assert.Single(overview.Departments, item => item.Department == "operations").RampAgents);
        Assert.Null(await store.GetOverviewAsync(GovernanceContracts, cancellationToken));
        Assert.NotNull(await store.GetDepartmentSummaryAsync(GovernanceContracts, "contracts", cancellationToken));
        Assert.Null(await store.GetDepartmentSummaryAsync(GovernanceContracts, "finance", cancellationToken));

        // The super administrator is unique and is never granted through user management.
        var superRole = Assert.Single((await legacy.GetAsync(GovernanceSuperAdmin, cancellationToken))!.Roles,
            item => item.Code == "SUPERADMIN");
        Assert.Equal(GovernanceFailure.Protected, (await legacy.CreateUserAsync(GovernanceSuperAdmin,
            new CreateGovernanceUserInput("Otro", "Super", "otro-super@example.test", superRole.Id,
                "Synthetic-Super!5678"), cancellationToken)).Failure);

        // Only the super administrator creates administrators; they are active at once.
        var adminInput = new CreateDepartmentAccountInput("Carla", "Contratos", "carla-admin@example.test",
            "Synthetic-Admin!5678", [puj.PublicId]);
        Assert.Equal(GovernanceFailure.Forbidden, (await store.CreateAdministratorAsync(GovernanceContracts,
            "contracts", adminInput, cancellationToken)).Failure);
        var carla = await store.CreateAdministratorAsync(GovernanceSuperAdmin, "contracts", adminInput, cancellationToken);
        Assert.True(carla.IsSuccess);
        var carlaId = carla.Id!.Value;
        Assert.True((await actors.ResolveAsync(carlaId, cancellationToken))!.EffectiveAccess!.Administers(
            Department.Contracts));
        Assert.Equal(GovernanceFailure.Forbidden, (await store.CreateMemberAsync(carlaId, "contracts",
            adminInput with { Email = "directo@example.test" }, cancellationToken)).Failure);

        // Templates only hold permissions of their own department.
        Assert.Equal(GovernanceFailure.Invalid, (await store.SaveProfileAsync(carlaId, "contracts", null,
            new SaveAccessProfileInput("Mixta", null, ["finance.preinvoices.read"]), cancellationToken)).Failure);
        var template = await store.SaveProfileAsync(carlaId, "contracts", null,
            new SaveAccessProfileInput("Supervisor de solicitudes", "Revisa solicitudes",
                ["contracts.requests.verify"]), cancellationToken);
        Assert.True(template.IsSuccess);
        var savedTemplate = Assert.Single((await store.ListProfilesAsync(carlaId, "contracts", cancellationToken))!);
        Assert.Equal(["contracts.requests.read", "contracts.requests.verify"], savedTemplate.Permissions);

        // Administrators only grant stations they hold; the request id makes the request idempotent.
        var requestId = Guid.CreateVersion7();
        var request = new RequestUserAccessInput(requestId, "BackOfficeUser", "Rosa", "Solicitudes",
            "rosa@example.test", [puj.PublicId], AccessProfileId: template.Id);
        Assert.Equal(GovernanceFailure.Invalid, (await store.RequestAccessAsync(carlaId, "contracts",
            request with { RequestId = Guid.CreateVersion7(), StationIds = [mia.PublicId] }, cancellationToken)).Failure);
        Assert.Equal(GovernanceFailure.Forbidden, (await store.RequestAccessAsync(carlaId, "finance", request,
            cancellationToken)).Failure);
        Assert.Equal(requestId, (await store.RequestAccessAsync(carlaId, "contracts", request, cancellationToken)).Id);
        Assert.Equal(requestId, (await store.RequestAccessAsync(carlaId, "contracts", request, cancellationToken)).Id);
        Assert.Equal(GovernanceFailure.Conflict, (await store.RequestAccessAsync(carlaId, "contracts",
            request with { RequestId = Guid.CreateVersion7() }, cancellationToken)).Failure);
        Assert.Equal(1, (await store.GetDepartmentSummaryAsync(carlaId, "contracts", cancellationToken))!.PendingRequests);

        // Human Resources validates with the temporary password; requesters cannot validate.
        var pending = Assert.Single((await store.ListRequestsAsync(GovernanceHumanResources, null, "Pending", 1, 25,
            cancellationToken))!.Requests);
        Assert.Equal("Supervisor de solicitudes", pending.AccessProfileName);
        Assert.Null(await store.ListRequestsAsync(carlaId, "finance", null, 1, 25, cancellationToken));
        Assert.Equal(GovernanceFailure.Forbidden, (await store.ValidateRequestAsync(carlaId, requestId,
            new DecideUserAccessInput(pending.Version, "Synthetic-Member!5678"), cancellationToken)).Failure);
        Assert.Equal(GovernanceFailure.Conflict, (await store.ValidateRequestAsync(GovernanceHumanResources, requestId,
            new DecideUserAccessInput("c3RhbGU=", "Synthetic-Member!5678"), cancellationToken)).Failure);
        var validated = await store.ValidateRequestAsync(GovernanceHumanResources, requestId,
            new DecideUserAccessInput(pending.Version, "Synthetic-Member!5678"), cancellationToken);
        Assert.True(validated.IsSuccess);
        Assert.Equal(validated.Id, (await store.ValidateRequestAsync(GovernanceHumanResources, requestId,
            new DecideUserAccessInput(pending.Version, "Synthetic-Member!5678"), cancellationToken)).Id);
        var member = (await actors.ResolveAsync(validated.Id!.Value, cancellationToken))!;
        Assert.True(member.HasPermission("contracts.requests.verify"));
        Assert.False(member.HasPermission("contracts.requests.approve"));
        Assert.True((await context.Users.SingleAsync(item => item.PublicId == validated.Id, cancellationToken))
            .MustChangePassword);

        // Administrators manage their members without revalidation, but never other administrators.
        var users = (await store.ListUsersAsync(carlaId, "contracts", 1, 25, null, null, null, null, null,
            cancellationToken))!;
        var rosa = Assert.Single(users.Users, item => item.Id == validated.Id);
        Assert.Equal("Member", rosa.Kind);
        var seededAdmin = Assert.Single(users.Users, item => item.Id == GovernanceContracts);
        Assert.Equal(GovernanceFailure.Forbidden, (await store.SetUserStatusAsync(carlaId, "contracts", seededAdmin.Id,
            new SetDepartmentUserStatusInput(false, seededAdmin.Version), cancellationToken)).Failure);
        Assert.True((await store.UpdateUserAsync(carlaId, "contracts", rosa.Id, new UpdateDepartmentUserInput(
            "Rosa", "Solicitudes", "rosa@example.test", [puj.PublicId], rosa.Version,
            PermissionCodes: ["contracts.requests.approve"]), cancellationToken)).IsSuccess);
        var updated = (await actors.ResolveAsync(rosa.Id, cancellationToken))!;
        Assert.True(updated.HasPermission("contracts.requests.approve"));
        Assert.True(updated.HasPermission("contracts.requests.read"));
        Assert.False(updated.HasPermission("contracts.requests.verify"));
        var reread = Assert.Single((await store.ListUsersAsync(carlaId, "contracts", 1, 25, null, null, null, null,
            "rosa", cancellationToken))!.Users);
        Assert.True((await store.SetUserStatusAsync(carlaId, "contracts", rosa.Id,
            new SetDepartmentUserStatusInput(false, reread.Version), cancellationToken)).IsSuccess);
        Assert.Equal(1, (await store.GetDepartmentSummaryAsync(carlaId, "contracts", cancellationToken))!.Inactive);

        // Rejections need a reason.
        var rejectedId = Guid.CreateVersion7();
        Assert.True((await store.RequestAccessAsync(carlaId, "contracts", request with
        {
            RequestId = rejectedId, Email = "rechazo@example.test",
        }, cancellationToken)).IsSuccess);
        var toReject = Assert.Single((await store.ListRequestsAsync(GovernanceSuperAdmin, "contracts", "Pending", 1, 25,
            cancellationToken))!.Requests);
        Assert.Equal(GovernanceFailure.Invalid, (await store.RejectRequestAsync(GovernanceHumanResources, rejectedId,
            new DecideUserAccessInput(toReject.Version), cancellationToken)).Failure);
        Assert.True((await store.RejectRequestAsync(GovernanceHumanResources, rejectedId,
            new DecideUserAccessInput(toReject.Version, Reason: "Correo no corporativo"), cancellationToken)).IsSuccess);
        Assert.Contains((await store.ListRequestsAsync(carlaId, null, "Rejected", 1, 25, cancellationToken))!.Requests,
            item => item.Id == rejectedId && item.DecisionReason == "Correo no corporativo");
    }

    [Fact]
    public async Task OperationsAdministratorRequestsRampAgentsThatHumanResourcesValidates()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededGovernanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var puj = await context.Stations.SingleAsync(item => item.Code == "PUJ", cancellationToken);
        var terminal = await context.Terminals.FirstAsync(item => item.StationId == puj.Id && item.IsActive,
            cancellationToken);
        var requestId = Guid.CreateVersion7();
        var request = new RequestUserAccessInput(requestId, "RampAgent", "Pedro", "Rampa", "pedro-rampa@example.test",
            [puj.PublicId], TerminalIds: [terminal.PublicId], EmployeeNumber: "SYNTHETIC-GOV-RAMP",
            Category: "Agente de rampa", HireDate: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-10)));

        Assert.Equal(GovernanceFailure.Forbidden, (await store.RequestAccessAsync(GovernanceContracts, "operations",
            request, cancellationToken)).Failure);
        Assert.Equal(GovernanceFailure.Invalid, (await store.RequestAccessAsync(GovernanceOccAdmin, "operations",
            request with { EmployeeNumber = null }, cancellationToken)).Failure);
        Assert.True((await store.RequestAccessAsync(GovernanceOccAdmin, "operations", request, cancellationToken))
            .IsSuccess);
        var pending = Assert.Single((await store.ListRequestsAsync(GovernanceHumanResources, "operations", "Pending",
            1, 25, cancellationToken))!.Requests);
        Assert.Equal("RampAgent", pending.Kind);
        Assert.Equal(terminal.PublicId, Assert.Single(pending.Terminals).Id);

        var validated = await store.ValidateRequestAsync(GovernanceHumanResources, requestId,
            new DecideUserAccessInput(pending.Version, "Synthetic-Ramp!5678"), cancellationToken);
        Assert.True(validated.IsSuccess);
        var account = await context.Users.AsNoTracking().SingleAsync(item => item.PublicId == validated.Id,
            cancellationToken);
        var agent = await context.RampAgents.AsNoTracking().SingleAsync(item => item.PersonId == account.PersonId,
            cancellationToken);
        Assert.Equal("SYNTHETIC-GOV-RAMP", agent.EmployeeNumber);
        Assert.True(await context.Set<RampAgentStationScope>().AnyAsync(item => item.RampAgentId == agent.Id &&
            item.StationId == puj.Id, cancellationToken));
        Assert.True(await context.Set<RampAgentTerminalScope>().AnyAsync(item => item.RampAgentId == agent.Id &&
            item.TerminalId == terminal.Id, cancellationToken));
        Assert.True(await (from link in context.Set<IdentityUserRole<long>>()
                           join role in context.Roles on link.RoleId equals role.Id
                           where link.UserId == account.Id && role.NormalizedName == "RAMP_AGENT"
                           select link).AnyAsync(cancellationToken));
        var summary = (await store.GetDepartmentSummaryAsync(GovernanceOccAdmin, "operations", cancellationToken))!;
        Assert.Equal(2, summary.RampAgents);
        Assert.Equal(1, summary.PendingFirstLogin);
        Assert.Contains((await store.ListUsersAsync(GovernanceOccAdmin, "operations", 1, 25, "RampAgent", null, null,
            null, null, cancellationToken))!.Users, item => item.Id == validated.Id);
    }

    private static async Task<ServiceProvider> SeededGovernanceProviderAsync(TemporaryDatabase database,
        CancellationToken cancellationToken)
    {
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(seederConnection))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!789"), cancellationToken);
        return new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString,
                }).Build()).BuildServiceProvider();
    }
}
