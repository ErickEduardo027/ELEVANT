using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;

namespace Elevant.UnitTests.Domain;

public sealed class DepartmentPermissionCatalogTests
{
    [Fact]
    public void CoversTheFourDepartmentsWithUniqueWellFormedCodes()
    {
        Assert.Equal(
            [Department.HumanResources, Department.Contracts, Department.Operations, Department.Finance],
            DepartmentPermissionCatalog.Departments);

        var codes = DepartmentPermissionCatalog.Departments.SelectMany(DepartmentPermissionCatalog.CodesOf).ToArray();
        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());
        Assert.All(codes, code =>
        {
            Assert.Matches("^[a-z_]+\\.[a-z_]+\\.[a-z]+$", code);
            Assert.True(code.Length <= 120);
        });
    }

    [Fact]
    public void EveryModuleOffersRead()
    {
        foreach (var department in DepartmentPermissionCatalog.Departments)
            Assert.All(DepartmentPermissionCatalog.ModulesOf(department),
                module => Assert.Contains(module.Actions, action => action.Action == "read"));
    }

    [Theory]
    [InlineData("contracts.requests.read", Department.Contracts)]
    [InlineData("contracts.requests.cancel", Department.Contracts)]
    [InlineData("contracts.drafts.delete", Department.Contracts)]
    [InlineData("finance.packages.delete", Department.Finance)]
    [InlineData("finance.packages.retire", Department.Finance)]
    [InlineData("operations.review.decide", Department.Operations)]
    [InlineData("human_resources.access_requests.validate", Department.HumanResources)]
    [InlineData("finance.preinvoices.issue", Department.Finance)]
    public void KnowsWhichDepartmentOwnsACode(string code, Department department)
    {
        Assert.Equal(department, DepartmentPermissionCatalog.DepartmentOf(code));
        Assert.True(DepartmentPermissionCatalog.Belongs(code, department));
        Assert.False(DepartmentPermissionCatalog.Belongs(code,
            department == Department.Finance ? Department.Contracts : Department.Finance));
    }

    [Fact]
    public void HumanResourcesCannotProgramShiftsBecauseOperationsOwnsThem()
    {
        Assert.True(DepartmentPermissionCatalog.IsKnown("human_resources.schedules.read"));
        Assert.False(DepartmentPermissionCatalog.IsKnown("human_resources.schedules.manage"));
        Assert.DoesNotContain("human_resources.schedules.manage",
            DepartmentPermissionCatalog.Normalize(["human_resources.schedules.manage"]));
    }

    [Fact]
    public void EveryMenuOptionHasASectionAndActionsInAMatrixColumn()
    {
        string[] kinds = [PermissionKinds.Read, PermissionKinds.Create, PermissionKinds.Update, PermissionKinds.Delete, PermissionKinds.Other];
        foreach (var department in DepartmentPermissionCatalog.Departments)
        {
            var modules = DepartmentPermissionCatalog.ModulesOf(department);
            Assert.All(modules, module =>
            {
                Assert.False(string.IsNullOrWhiteSpace(module.Section));
                Assert.All(module.Actions, action => Assert.Contains(action.Kind, kinds));
                Assert.Equal(1, module.Actions.Count(action => action.Kind == PermissionKinds.Read));
                Assert.True(module.Parent is null || modules.Any(other => other.Key == module.Parent && other.Parent is null),
                    $"{module.Key} must live inside a top-level option");
            });
        }
    }

    [Theory]
    [InlineData("finance.tariffs.manage", new[] { "finance.billing_units.create", "finance.billing_units.read", "finance.billing_units.update",
        "finance.tariffs.create", "finance.tariffs.delete", "finance.tariffs.publish", "finance.tariffs.read", "finance.tariffs.update" })]
    [InlineData("human_resources.employees.manage", new[] { "human_resources.employees.create", "human_resources.employees.read",
        "human_resources.employees.update" })]
    [InlineData("contracts.catalog.retire", new[] { "contracts.catalog.delete", "contracts.catalog.read" })]
    [InlineData("contracts.agreements.read", new[] { "contracts.agreed_services.read", "contracts.agreements.read", "contracts.permits.read" })]
    [InlineData("finance.receipts.read", new[] { "finance.receipts.read", "finance.statements.read" })]
    [InlineData("finance.packages.manage", new[] { "finance.packages.create", "finance.packages.delete", "finance.packages.publish",
        "finance.packages.read", "finance.packages.retire", "finance.packages.update" })]
    public void LegacyGrantsKeepTheirAccessAsCrudActions(string legacy, string[] expected)
    {
        Assert.False(DepartmentPermissionCatalog.IsKnown(legacy) && legacy.EndsWith(".manage", StringComparison.Ordinal));
        Assert.Equal(expected, DepartmentPermissionCatalog.Normalize([legacy]));
        Assert.True(DepartmentPermissionCatalog.Belongs(legacy, DepartmentPermissionCatalog.DepartmentOf(expected[0])!.Value));
    }

    [Fact]
    public void NoOptionStillOffersTheCombinedManageAction()
    {
        var codes = DepartmentPermissionCatalog.Departments.SelectMany(DepartmentPermissionCatalog.CodesOf).ToArray();
        Assert.DoesNotContain(codes, code => code.EndsWith(".manage", StringComparison.Ordinal) ||
            code.EndsWith(".edit", StringComparison.Ordinal));
        // «Retirar» of the catalog became its delete action; retiring a published package is a workflow of its own (1-N27).
        Assert.DoesNotContain("contracts.catalog.retire", codes);
        Assert.Equal(["finance.packages.retire"], codes.Where(code => code.EndsWith(".retire", StringComparison.Ordinal)));
    }

    [Fact]
    public void RejectsUnknownCodesIncludingLegacyCommercialOnes()
    {
        Assert.False(DepartmentPermissionCatalog.IsKnown("commercial.requests.full"));
        Assert.False(DepartmentPermissionCatalog.IsKnown("iam.users.write"));
        Assert.Null(DepartmentPermissionCatalog.DepartmentOf("contracts.requests.delete"));
    }

    [Fact]
    public void NormalizeAddsReadForGrantedActionsAndDropsUnknownCodes()
    {
        var normalized = DepartmentPermissionCatalog.Normalize(
            ["contracts.requests.approve", "contracts.requests.approve", "unknown.module.read"]);

        Assert.Equal(["contracts.requests.approve", "contracts.requests.read"], normalized);
    }

    [Theory]
    [InlineData("contracts.service_closures.decide", "contracts.catalog.read")]
    [InlineData("finance.adjustments.create", "finance.reconciliation.read")]
    [InlineData("operations.attendance.read", "operations.planning.read")]
    [InlineData("human_resources.availability.create", "human_resources.schedules.read")]
    public void SubWindowGrantsReadOfTheScreenThatContainsIt(string code, string parentRead)
    {
        var normalized = DepartmentPermissionCatalog.Normalize([code]);

        Assert.Contains(parentRead, normalized);
        Assert.Contains(code[..code.LastIndexOf('.')] + ".read", normalized);
        // The parent grant is read-only: nothing else of the containing screen is added.
        Assert.DoesNotContain(normalized, item => item.StartsWith(parentRead[..parentRead.LastIndexOf('.')], StringComparison.Ordinal) && item != parentRead);
    }

    [Fact]
    public void CatalogReadAloneGrantsNoSubWindow()
    {
        Assert.Equal(["contracts.catalog.read"], DepartmentPermissionCatalog.Normalize(["contracts.catalog.read"]));
    }
}
