using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;

namespace Elevant.UnitTests.Application;

public sealed class DepartmentAccessResolverTests
{
    [Fact]
    public void AdministratorReceivesEveryPermissionOfTheDepartmentOnly()
    {
        var access = Resolve(new(DepartmentAssignmentKind.Administrator, Department.Contracts, false, false));

        Assert.NotNull(access);
        Assert.True(access.Administers(Department.Contracts));
        Assert.False(access.Administers(Department.Finance));
        Assert.Equal(DepartmentPermissionCatalog.CodesOf(Department.Contracts).Order(), access.Permissions.Order());
        Assert.False(access.Has("finance.preinvoices.manage"));
    }

    [Fact]
    public void MemberInheritsTheActiveTemplateAndIgnoresOtherDepartments()
    {
        var access = Resolve(new(DepartmentAssignmentKind.Member, Department.Contracts, true, true),
            profileGrants: ["contracts.requests.approve", "finance.tariffs.read"]);

        Assert.NotNull(access);
        Assert.Equal(["contracts.requests.approve", "contracts.requests.read"], access.Permissions.Order());
        Assert.False(access.Administers(Department.Contracts));
    }

    [Fact]
    public void MemberOfAnInactiveTemplateHasNoPermissions()
    {
        var access = Resolve(new(DepartmentAssignmentKind.Member, Department.Contracts, true, false),
            profileGrants: ["contracts.requests.read"], accountGrants: ["contracts.catalog.read"]);

        Assert.NotNull(access);
        Assert.Empty(access.Permissions);
    }

    [Fact]
    public void MemberWithoutTemplateUsesExplicitGrants()
    {
        var access = Resolve(new(DepartmentAssignmentKind.Member, Department.Operations, false, false),
            accountGrants: ["operations.review.decide"]);

        Assert.Equal(["operations.review.decide", "operations.review.read"], access!.Permissions.Order());
    }

    [Fact]
    public void SuperAdministratorGovernsButDoesNotOperateFinanceOrOcc()
    {
        var access = Resolve(new(DepartmentAssignmentKind.SuperAdministrator, null, false, false));

        Assert.True(access!.IsSuperAdministrator);
        Assert.True(access.Administers(Department.Finance));
        Assert.True(access.Has("human_resources.access_requests.validate"));
        Assert.True(access.Has("contracts.requests.approve"));
        Assert.False(access.Has("finance.preinvoices.manage"));
        Assert.False(access.Has("operations.review.decide"));
    }

    [Theory]
    [InlineData("ADMIN_OCC", Department.Operations)]
    [InlineData("GESTION_HUMANA", Department.HumanResources)]
    [InlineData("CONTRATOS", Department.Contracts)]
    [InlineData("FINANZAS", Department.Finance)]
    public void LegacyDepartmentRoleWithoutAssignmentIsAnAdministrator(string role, Department department)
    {
        var access = DepartmentAccessResolver.FromRoles([role]);

        Assert.True(access!.Administers(department));
        Assert.Equal(DepartmentAssignmentKind.Administrator, access.Kind);
    }

    [Fact]
    public void LegacyCustomRoleKeepsItsCommercialPermissionsAsContracts()
    {
        var access = DepartmentAccessResolver.Resolve(null, ["CUSTOM_ABC123"], [], [],
            ["commercial.requests.full", "commercial.service_closures.request"]);

        Assert.Equal(DepartmentAssignmentKind.Member, access!.Kind);
        Assert.Equal(Department.Contracts, access.Department);
        Assert.True(access.Has("contracts.requests.approve"));
        Assert.True(access.Has("contracts.requests.cancel"));
        Assert.True(access.Has("contracts.drafts.activate"));
        Assert.True(access.Has("contracts.drafts.delete"));
        Assert.False(access.Has("operations.service_closures.request"));
    }

    [Fact]
    public void RolesOnlyCountOnTheirPortal()
    {
        Assert.True(DepartmentAccessResolver.CountsForAccess("ADMIN_OCC", PortalKind.BackOffice));
        Assert.False(DepartmentAccessResolver.CountsForAccess("ADMIN_OCC", PortalKind.RampMobileApp));
        Assert.True(DepartmentAccessResolver.CountsForAccess("RAMP_AGENT", PortalKind.RampMobileApp));
        Assert.False(DepartmentAccessResolver.CountsForAccess("RAMP_AGENT", PortalKind.BackOffice));
        Assert.Null(DepartmentAccessResolver.FromRoles(["AIRLINE_CLIENT"]));
    }

    [Fact]
    public void AssignmentIsRevokedWhenTheDepartmentRoleIsRemoved()
    {
        var facts = new DepartmentAssignmentFacts(DepartmentAssignmentKind.Administrator, Department.Finance, false, false);
        Assert.Null(DepartmentAccessResolver.Resolve(facts, ["CONTRATOS"], [], [], []));
        Assert.Null(DepartmentAccessResolver.Resolve(
            new(DepartmentAssignmentKind.SuperAdministrator, null, false, false), ["FINANZAS"], [], [], []));
        Assert.NotNull(DepartmentAccessResolver.Resolve(
            new(DepartmentAssignmentKind.Member, Department.Operations, false, false), ["RAMP_AGENT"], [], [], []));
    }

    [Fact]
    public void ContractsMemberEditedBeforeItsLegacyRoleWasConvertedKeepsTheChosenPermissions()
    {
        // 2-N19: an edit created the Member/Contracts assignment without the CONTRATOS role; the legacy role still
        // counts and the permissions the administrator chose apply, not the role's.
        var contracts = new DepartmentAssignmentFacts(DepartmentAssignmentKind.Member, Department.Contracts, false, false);
        var access = DepartmentAccessResolver.Resolve(contracts, ["CUSTOM_VENTAS"], [], ["contracts.catalog.read"],
            ["commercial.requests.full"]);

        Assert.NotNull(access);
        Assert.Equal(["contracts.catalog.read"], access.Permissions.Order());
        Assert.False(access.Has("contracts.requests.approve"));
        // The legacy role never opens another department nor an administration.
        Assert.Null(DepartmentAccessResolver.Resolve(
            new(DepartmentAssignmentKind.Member, Department.Finance, false, false), ["CUSTOM_VENTAS"], [], [], []));
        Assert.Null(DepartmentAccessResolver.Resolve(
            new(DepartmentAssignmentKind.Administrator, Department.Contracts, false, false), ["CUSTOM_VENTAS"], [], [], []));
        Assert.True(DepartmentAccessResolver.IsLegacyCustomRole("CUSTOM_VENTAS"));
        Assert.False(DepartmentAccessResolver.IsLegacyCustomRole("CONTRATOS"));
    }

    [Fact]
    public void AnAccountWithoutItsDepartmentRoleHasNoAccessLeftAfterATransfer()
    {
        // 2-N07: the transfer retires the roles and keeps the assignment, which then grants nothing.
        var finance = new DepartmentAssignmentFacts(DepartmentAssignmentKind.Member, Department.Finance, false, false);
        Assert.Null(DepartmentAccessResolver.Resolve(finance, [], [], ["finance.home.read"], []));
    }

    [Fact]
    public void TabletPermissionsBelongToOperationsAndPortalCapabilitiesToNoDepartment()
    {
        Assert.Equal(Department.Operations, DepartmentPermissionCatalog.DepartmentOf("operations.devices.read"));
        Assert.True(DepartmentPermissionCatalog.Belongs("operations.devices.unbind", Department.Operations));
        Assert.True(DepartmentPermissionCatalog.Belongs("operations.devices.revoke", Department.Operations));
        Assert.Contains("operations.devices.read", DepartmentPermissionCatalog.Normalize(["operations.devices.revoke"]));
        // 2-N20: the airline portal's representative and signer grants live outside the department catalog.
        foreach (var department in DepartmentPermissionCatalog.Departments)
        {
            Assert.False(DepartmentPermissionCatalog.Belongs("airline_portal.signer", department));
            Assert.False(DepartmentPermissionCatalog.Belongs("airline_portal.representative", department));
        }
        var member = new DepartmentAssignmentFacts(DepartmentAssignmentKind.Member, Department.Contracts, false, false);
        Assert.Equal(["contracts.home.read"], DepartmentAccessResolver.Resolve(member, ["CONTRATOS"], [],
            ["contracts.home.read", "airline_portal.signer"], [])!.Permissions.Order());
    }

    private static DepartmentAccess? Resolve(DepartmentAssignmentFacts facts,
        string[]? profileGrants = null, string[]? accountGrants = null) =>
        DepartmentAccessResolver.Resolve(facts, RolesFor(facts), profileGrants ?? [], accountGrants ?? [], []);

    private static string[] RolesFor(DepartmentAssignmentFacts facts) =>
        facts.Department is { } department ? [DepartmentAccessResolver.RoleCodeOf(department)] : ["SUPERADMIN"];
}
