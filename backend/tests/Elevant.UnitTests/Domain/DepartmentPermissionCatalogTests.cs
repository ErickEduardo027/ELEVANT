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
    [InlineData("operations.review.decide", Department.Operations)]
    [InlineData("human_resources.access_requests.validate", Department.HumanResources)]
    [InlineData("finance.preinvoices.manage", Department.Finance)]
    public void KnowsWhichDepartmentOwnsACode(string code, Department department)
    {
        Assert.Equal(department, DepartmentPermissionCatalog.DepartmentOf(code));
        Assert.True(DepartmentPermissionCatalog.Belongs(code, department));
        Assert.False(DepartmentPermissionCatalog.Belongs(code,
            department == Department.Finance ? Department.Contracts : Department.Finance));
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
}
