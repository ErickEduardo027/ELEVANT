using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;

namespace Elevant.Application.Identity;

/// <summary>Effective department governance of an internal account.</summary>
public sealed record DepartmentAccess(
    DepartmentAssignmentKind Kind,
    Department? Department,
    IReadOnlySet<string> Permissions)
{
    public bool IsSuperAdministrator => Kind == DepartmentAssignmentKind.SuperAdministrator;

    public bool Has(string permissionCode) => Permissions.Contains(permissionCode);

    /// <summary>True for the super administrator and for administrators of <paramref name="department"/>.</summary>
    public bool Administers(Department department) =>
        IsSuperAdministrator || (Kind == DepartmentAssignmentKind.Administrator && Department == department);
}

/// <summary>A persisted department assignment as read by the resolver.</summary>
public sealed record DepartmentAssignmentFacts(
    DepartmentAssignmentKind Kind,
    Department? Department,
    bool UsesProfile,
    bool ProfileIsActive);

/// <summary>
/// Pure rules that turn assignments, roles and grants into effective access. Accounts
/// created before department governance have no assignment: their built-in department
/// role makes them administrators of that department and a legacy <c>CUSTOM_*</c> role
/// keeps its commercial permissions as Contracts permissions until it is converted.
/// </summary>
public static class DepartmentAccessResolver
{
    public static readonly IReadOnlyDictionary<string, Department> DepartmentRoles =
        new Dictionary<string, Department>(StringComparer.Ordinal)
        {
            ["ADMIN_OCC"] = Department.Operations,
            ["GESTION_HUMANA"] = Department.HumanResources,
            ["CONTRATOS"] = Department.Contracts,
            ["FINANZAS"] = Department.Finance,
        };

    public static string RoleCodeOf(Department department) =>
        DepartmentRoles.Single(pair => pair.Value == department).Key;

    public static DepartmentAccess? Resolve(
        DepartmentAssignmentFacts? assignment,
        IReadOnlyCollection<string> activeRoleCodes,
        IEnumerable<string> profileGrants,
        IEnumerable<string> accountGrants,
        IEnumerable<string> legacyCommercialGrants)
    {
        if (assignment is not null)
        {
            // An assignment only counts while the account keeps the matching role; removing
            // the role revokes the department access immediately.
            if (!HoldsRoleFor(assignment, activeRoleCodes)) return null;
            return assignment.Kind switch
            {
                DepartmentAssignmentKind.SuperAdministrator => Super(),
                DepartmentAssignmentKind.Administrator when assignment.Department is { } department =>
                    new DepartmentAccess(DepartmentAssignmentKind.Administrator, department,
                        DepartmentPermissionCatalog.CodesOf(department).ToHashSet(StringComparer.Ordinal)),
                DepartmentAssignmentKind.Member when assignment.Department is { } department =>
                    new DepartmentAccess(DepartmentAssignmentKind.Member, department, Within(department,
                        assignment.UsesProfile ? (assignment.ProfileIsActive ? profileGrants : []) : accountGrants)),
                _ => null,
            };
        }

        if (activeRoleCodes.Contains("SUPERADMIN", StringComparer.Ordinal)) return Super();
        foreach (var (role, department) in DepartmentRoles)
        {
            if (activeRoleCodes.Contains(role, StringComparer.Ordinal))
                return new DepartmentAccess(DepartmentAssignmentKind.Administrator, department,
                    DepartmentPermissionCatalog.CodesOf(department).ToHashSet(StringComparer.Ordinal));
        }

        if (activeRoleCodes.Contains("RAMP_AGENT", StringComparer.Ordinal))
            return new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations,
                new HashSet<string>(StringComparer.Ordinal));

        if (activeRoleCodes.Any(code => code.StartsWith("CUSTOM_", StringComparison.Ordinal)))
            return new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Contracts,
                Within(Department.Contracts, MapLegacyCommercial(legacyCommercialGrants)));

        return null;
    }

    private static bool HoldsRoleFor(DepartmentAssignmentFacts assignment, IReadOnlyCollection<string> roles) =>
        assignment.Kind == DepartmentAssignmentKind.SuperAdministrator
            ? roles.Contains("SUPERADMIN", StringComparer.Ordinal)
            : assignment.Department is { } department &&
              (roles.Contains(RoleCodeOf(department), StringComparer.Ordinal) ||
               department == Department.Operations && assignment.Kind == DepartmentAssignmentKind.Member &&
               roles.Contains("RAMP_AGENT", StringComparer.Ordinal));

    /// <summary>
    /// Only roles of the right portal grant access: back-office roles on AVIAM Web and
    /// <c>RAMP_AGENT</c> on the mobile app.
    /// </summary>
    public static bool CountsForAccess(string roleCode, PortalKind portal) =>
        roleCode == "RAMP_AGENT" ? portal == PortalKind.RampMobileApp : portal == PortalKind.BackOffice;

    /// <summary>Access derived only from role codes, for actors built without persisted governance (tests).</summary>
    public static DepartmentAccess? FromRoles(IEnumerable<string> roleCodes) =>
        Resolve(null, roleCodes.ToArray(), [], [], []);

    /// <summary>Translates legacy <c>commercial.*</c> grants of custom roles into Contracts permissions.</summary>
    public static IEnumerable<string> MapLegacyCommercial(IEnumerable<string> codes)
    {
        foreach (var code in codes)
        {
            switch (code)
            {
                case "commercial.catalog.read": yield return "contracts.catalog.read"; break;
                case "commercial.catalog.create": yield return "contracts.catalog.create"; break;
                case "commercial.catalog.edit": yield return "contracts.catalog.edit"; break;
                case "commercial.catalog.full":
                case "commercial.catalog.write":
                    yield return "contracts.catalog.create";
                    yield return "contracts.catalog.edit";
                    yield return "contracts.catalog.retire";
                    break;
                case "commercial.requests.read":
                    yield return "contracts.requests.read";
                    yield return "contracts.drafts.read";
                    break;
                case "commercial.requests.edit":
                    yield return "contracts.requests.reject";
                    yield return "contracts.drafts.edit";
                    break;
                case "commercial.requests.full":
                case "commercial.requests.write":
                    yield return "contracts.requests.verify";
                    yield return "contracts.requests.approve";
                    yield return "contracts.requests.reject";
                    yield return "contracts.drafts.edit";
                    yield return "contracts.drafts.activate";
                    break;
                case "commercial.service_closures.read": yield return "contracts.service_closures.read"; break;
                case "commercial.service_closures.decide": yield return "contracts.service_closures.decide"; break;
                case "commercial.service_closures.reopen": yield return "contracts.service_closures.reopen"; break;
            }
        }
    }

    // Global governance plus the Human Resources and Contracts access the super
    // administrator already had; it does not operate Finance or the OCC.
    private static DepartmentAccess Super() =>
        new(DepartmentAssignmentKind.SuperAdministrator, null,
            DepartmentPermissionCatalog.CodesOf(Department.HumanResources)
                .Concat(DepartmentPermissionCatalog.CodesOf(Department.Contracts))
                .ToHashSet(StringComparer.Ordinal));

    private static HashSet<string> Within(Department department, IEnumerable<string> codes) =>
        DepartmentPermissionCatalog.Normalize(codes)
            .Where(code => DepartmentPermissionCatalog.Belongs(code, department))
            .ToHashSet(StringComparer.Ordinal);
}
