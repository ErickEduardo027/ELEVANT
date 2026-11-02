using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid CommercialAnalystPosition = Guid.Parse("45000000-0000-7000-8000-000000000004");

    [Fact]
    public async Task SuperAdministratorCreatesAContractsUserWhoOnlySeesTheServiceCatalog()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var governance = scope.ServiceProvider.GetRequiredService<IDepartmentGovernanceStore>();
        var actors = scope.ServiceProvider.GetRequiredService<IActorContextResolver>();
        var catalog = scope.ServiceProvider.GetRequiredService<ICommercialCatalogManagementStore>();
        var closures = scope.ServiceProvider.GetRequiredService<IServiceClosureStore>();

        var employee = new SaveEmployeeInput("Sofía", "Catálogo", "CEDULA", "40212345678", "QA-CON-020", "contracts",
            CommercialAnalystPosition, [PujStation], new DateOnly(2026, 10, 1), "809-555-0110",
            "sofia.catalogo@dev.elevant.test");
        var input = new CreateInternalUserInput(employee, "member", "Synthetic-Catalog!2026", [PujStation],
            PermissionCodes: ["contracts.catalog.read"]);

        // Only the super administrator, without any Human Resources request.
        Assert.Equal(GovernanceFailure.Forbidden, (await governance.CreateInternalUserAsync(HumanResourcesAccount,
            "contracts", input, cancellationToken)).Failure);
        Assert.Equal("department_mismatch", (await governance.CreateInternalUserAsync(SuperAdministratorAccount,
            "finance", input, cancellationToken)).Code);
        Assert.Equal("permissions_required", (await governance.CreateInternalUserAsync(SuperAdministratorAccount,
            "contracts", input with { PermissionCodes = [] }, cancellationToken)).Code);
        var created = await governance.CreateInternalUserAsync(SuperAdministratorAccount, "contracts", input,
            cancellationToken);
        Assert.True(created.IsSuccess, created.Code);
        Assert.Equal("identification_in_use", (await governance.CreateInternalUserAsync(SuperAdministratorAccount,
            "contracts", input with { Employee = employee with { EmployeeNumber = "QA-CON-021" } },
            cancellationToken)).Code);

        // The employee record exists and is linked to the account; nothing waits for validation.
        var person = await context.Users.AsNoTracking().Where(user => user.PublicId == created.Id)
            .Select(user => user.PersonId).SingleAsync(cancellationToken);
        Assert.True(await context.Employees.AnyAsync(item => item.PersonId == person && item.EmployeeNumber == "QA-CON-020",
            cancellationToken));
        Assert.Equal(0, (await governance.GetDepartmentSummaryAsync(SuperAdministratorAccount, "contracts",
            cancellationToken))!.PendingRequests);

        // Effective access: «Servicios» read only. No home, no closures, no catalog changes.
        var actor = (await actors.ResolveAsync(created.Id!.Value, cancellationToken))!;
        Assert.True(actor.HasPermission("contracts.catalog.read"));
        Assert.False(actor.HasPermission("contracts.home.read"));
        Assert.False(actor.HasPermission("contracts.catalog.create"));
        Assert.False(actor.HasPermission("contracts.service_closures.read"));

        Assert.NotNull(await catalog.ListAsync(created.Id.Value, cancellationToken));
        Assert.Equal(CatalogMutationFailure.Forbidden, (await catalog.SaveAsync(created.Id.Value, null,
            new ManagedServiceInput("QA-SVC", "Servicio de prueba", "Descripción", "operation", null, null, 1, false,
                true, null), cancellationToken)).Failure);
        Assert.Null(await closures.ListAsync(created.Id.Value, null, 1, 20, cancellationToken));

        // Granting the closures sub-window also grants the screen that contains it, nothing more.
        var normalized = Elevant.Domain.Governance.DepartmentPermissionCatalog.Normalize(["contracts.service_closures.read"]);
        Assert.Equal(["contracts.catalog.read", "contracts.service_closures.read"], normalized);
    }
}
