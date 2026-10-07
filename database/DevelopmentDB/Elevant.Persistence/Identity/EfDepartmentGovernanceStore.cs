using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Two-level department governance. The super administrator governs every
/// department; department administrators manage the members and templates of their
/// own department and request new accounts that Human Resources validates.
/// </summary>
internal sealed partial class EfDepartmentGovernanceStore(
    ElevantDbContext context,
    UserManager<ApplicationUser> userManager,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IDepartmentGovernanceStore
{
    private static readonly IReadOnlyDictionary<string, Department> DepartmentKeys =
        new Dictionary<string, Department>(StringComparer.Ordinal)
        {
            ["human-resources"] = Department.HumanResources,
            ["contracts"] = Department.Contracts,
            ["operations"] = Department.Operations,
            ["finance"] = Department.Finance,
        };

    private static readonly IReadOnlyDictionary<Department, string> DepartmentLabels =
        new Dictionary<Department, string>
        {
            [Department.HumanResources] = "Gestión Humana",
            [Department.Contracts] = "Contratos",
            [Department.Operations] = "Centro de Operaciones",
            [Department.Finance] = "Finanzas",
        };

    private const string ValidateRequestsPermission = "human_resources.access_requests.validate";

    public static string KeyOf(Department department) =>
        DepartmentKeys.Single(pair => pair.Value == department).Key;

    private static bool TryParse(string? key, out Department department)
    {
        department = default;
        return key is not null && DepartmentKeys.TryGetValue(key, out department);
    }

    private sealed record Actor(long Id, ActorContext Context, DepartmentAccess? Access)
    {
        public bool IsSuper => Access?.IsSuperAdministrator == true;

        public bool Administers(Department department) => Access?.Administers(department) == true;

        public bool CanValidate => Access?.Has(ValidateRequestsPermission) == true;

        public IReadOnlySet<Guid> StationIds { get; } =
            Context.StationScopes.Select(scope => scope.StationId).ToHashSet();
    }

    private async Task<Actor?> ActorAsync(Guid actorId, CancellationToken cancellationToken)
    {
        if (actorId == Guid.Empty) return null;
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return null;
        var id = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        return new Actor(id, actor, actor.EffectiveAccess);
    }

    public async Task<MyDepartmentAccessData?> GetMyAccessAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor?.Access is not { } access) return null;
        return new MyDepartmentAccessData(
            access.Kind.ToString(),
            access.Department is { } department ? KeyOf(department) : null,
            access.Permissions.Order(StringComparer.Ordinal).ToArray(),
            actor.Context.StationScopes.Select(scope => new GovernanceStationData(scope.StationId, scope.StationCode)).ToArray(),
            access.IsSuperAdministrator || access.Kind == DepartmentAssignmentKind.Administrator,
            actor.CanValidate);
    }

    public async Task<IReadOnlyList<DepartmentCatalogData>?> GetCatalogAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor?.Access is null) return null;
        var visible = actor.IsSuper
            ? DepartmentPermissionCatalog.Departments
            : actor.Access.Department is { } own ? [own] : [];
        return visible.Select(department => new DepartmentCatalogData(KeyOf(department), DepartmentLabels[department],
            DepartmentPermissionCatalog.ModulesOf(department).Select(module => new PermissionModuleData(module.Key,
                module.Label, module.Actions.Select(action =>
                    new PermissionActionData(action.Code, action.Action, action.Label)).ToArray())).ToArray())).ToArray();
    }

    private sealed record UserRow(long Id, Guid PublicId, string FirstName, string LastName, string Email,
        AccountLifecycleStatus Status, bool MustChangePassword, DateTimeOffset? LastLoginAt, string? Avatar,
        byte[] RowVersion, DepartmentAccess Access, bool IsRampAgent, long? ProfileId);

    /// <summary>Every internal account of a department, active or disabled.</summary>
    private async Task<IReadOnlyList<UserRow>> DepartmentUsersAsync(Department? department,
        CancellationToken cancellationToken)
    {
        var accounts = await (
            from user in context.Users.AsNoTracking()
            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
            where context.OrganizationMemberships.Any(membership => membership.AccountId == user.Id &&
                membership.Status == MembershipStatus.Active &&
                membership.Kind == MembershipKind.InternalStaff &&
                context.Organizations.Any(organization => organization.Id == membership.OrganizationId &&
                    organization.Type == OrganizationType.AviamOperator))
            select new
            {
                user.Id, user.PublicId, person.FirstName, person.LastName, Email = user.Email ?? string.Empty,
                user.Status, user.MustChangePassword, user.LastLoginAt, person.AvatarMediaUrl, user.RowVersion,
            }).ToArrayAsync(cancellationToken);
        var accesses = await DepartmentAccessQueries.ReadManyAsync(context,
            accounts.Select(account => account.Id).ToArray(), cancellationToken);
        var ids = accounts.Select(account => account.Id).ToArray();
        var rampAccounts = (await (
                from link in context.Set<IdentityUserRole<long>>().AsNoTracking()
                join role in context.Roles.AsNoTracking() on link.RoleId equals role.Id
                where ids.Contains(link.UserId) && role.NormalizedName == "RAMP_AGENT" && role.IsActive
                select link.UserId).ToArrayAsync(cancellationToken)).ToHashSet();
        var profiles = await context.DepartmentAssignments.AsNoTracking()
            .Where(assignment => ids.Contains(assignment.AccountId))
            .ToDictionaryAsync(assignment => assignment.AccountId, assignment => assignment.AccessProfileId,
                cancellationToken);
        return accounts
            .Where(account => accesses.TryGetValue(account.Id, out var access) && !access.IsSuperAdministrator &&
                (department is null || access.Department == department))
            .Select(account => new UserRow(account.Id, account.PublicId, account.FirstName, account.LastName,
                account.Email, account.Status, account.MustChangePassword, account.LastLoginAt, account.AvatarMediaUrl,
                account.RowVersion, accesses[account.Id], rampAccounts.Contains(account.Id),
                profiles.GetValueOrDefault(account.Id)))
            .ToArray();
    }

    private static string KindOf(UserRow row) =>
        row.IsRampAgent ? "RampAgent" : row.Access.Kind.ToString();

    private async Task<DepartmentSummaryData> SummaryAsync(Department department,
        IReadOnlyList<UserRow> users, CancellationToken cancellationToken)
    {
        var departmentUsers = users.Where(user => user.Access.Department == department).ToArray();
        var pending = await context.UserAccessRequests.CountAsync(request =>
            request.Department == department && request.Status == UserAccessRequestStatus.Pending, cancellationToken);
        var profiles = await context.AccessProfiles.CountAsync(profile =>
            profile.Department == department && profile.IsActive, cancellationToken);
        var active = departmentUsers.Where(user => user.Status == AccountLifecycleStatus.Active).ToArray();
        return new DepartmentSummaryData(
            KeyOf(department),
            DepartmentLabels[department],
            active.Count(user => user.Access.Kind == DepartmentAssignmentKind.Administrator),
            active.Count(user => user.Access.Kind == DepartmentAssignmentKind.Member && !user.IsRampAgent),
            active.Count(user => user.IsRampAgent),
            departmentUsers.Count(user => user.Status != AccountLifecycleStatus.Active),
            pending,
            active.Count(user => user.MustChangePassword && user.LastLoginAt is null),
            profiles);
    }

    public async Task<DepartmentsOverviewData?> GetOverviewAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.IsSuper) return null;
        var users = await DepartmentUsersAsync(null, cancellationToken);
        var departments = new List<DepartmentSummaryData>();
        foreach (var department in DepartmentPermissionCatalog.Departments)
            departments.Add(await SummaryAsync(department, users, cancellationToken));
        var active = users.Where(user => user.Status == AccountLifecycleStatus.Active).ToArray();
        return new DepartmentsOverviewData(
            active.Length,
            active.Count(user => user.Access.Kind == DepartmentAssignmentKind.Administrator),
            active.Count(user => user.Access.Kind == DepartmentAssignmentKind.Member),
            departments.Sum(summary => summary.PendingRequests),
            departments);
    }

    public async Task<DepartmentSummaryData?> GetDepartmentSummaryAsync(Guid actorId, string department,
        CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed)) return null;
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return null;
        return await SummaryAsync(parsed, await DepartmentUsersAsync(parsed, cancellationToken), cancellationToken);
    }

    public async Task<DepartmentUserPage?> ListUsersAsync(Guid actorId, string department, int page, int limit,
        string? kind, string? status, Guid? accessProfileId, Guid? stationId, string? search,
        CancellationToken cancellationToken = default)
    {
        if (!TryParse(department, out var parsed) || page < 1 || limit is < 1 or > 100) return null;
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Administers(parsed)) return null;
        var users = await DepartmentUsersAsync(parsed, cancellationToken);
        var stations = await StationsOfAsync(users.Select(user => user.Id).ToArray(), cancellationToken);
        var profileIds = users.Where(user => user.ProfileId != null).Select(user => user.ProfileId!.Value).Distinct().ToArray();
        var profiles = await context.AccessProfiles.AsNoTracking().Where(profile => profileIds.Contains(profile.Id))
            .ToDictionaryAsync(profile => profile.Id, cancellationToken);
        var term = search?.Trim();
        var filtered = users
            .Where(user => kind is null || KindOf(user) == kind)
            .Where(user => status is null || user.Status.ToString() == status)
            .Where(user => accessProfileId is null ||
                user.ProfileId is { } profileId && profiles[profileId].PublicId == accessProfileId)
            .Where(user => stationId is null || stations[user.Id].Any(station => station.Id == stationId))
            .Where(user => string.IsNullOrEmpty(term) ||
                $"{user.FirstName} {user.LastName} {user.Email}".Contains(term, StringComparison.OrdinalIgnoreCase))
            .OrderBy(user => user.Access.Kind == DepartmentAssignmentKind.Administrator ? 0 : 1)
            .ThenBy(user => user.Status == AccountLifecycleStatus.Active ? 0 : 1)
            .ThenBy(user => user.LastName, StringComparer.CurrentCulture)
            .ThenBy(user => user.FirstName, StringComparer.CurrentCulture)
            .ToArray();
        var pageRows = filtered.Skip((page - 1) * limit).Take(limit).Select(user =>
        {
            var profile = user.ProfileId is { } profileId ? profiles[profileId] : null;
            return new DepartmentUserData(user.PublicId, user.FirstName, user.LastName, user.Email, KindOf(user),
                user.Status.ToString(), profile?.PublicId, profile?.Name,
                user.Access.Permissions.Order(StringComparer.Ordinal).ToArray(), stations[user.Id],
                user.MustChangePassword, user.LastLoginAt, user.Avatar, GovernanceSupport.Version(user.RowVersion));
        }).ToArray();
        return new DepartmentUserPage(page, limit, filtered.Length, page * limit < filtered.Length, pageRows);
    }

    private async Task<IReadOnlyDictionary<long, GovernanceStationData[]>> StationsOfAsync(long[] accountIds,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from scope in context.AccountStationScopes.AsNoTracking()
            join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
            where accountIds.Contains(scope.AccountId) && scope.RevokedAt == null
            orderby station.Code
            select new { scope.AccountId, station.PublicId, station.Code }).ToArrayAsync(cancellationToken);
        var lookup = rows.ToLookup(row => row.AccountId, row => new GovernanceStationData(row.PublicId, row.Code));
        return accountIds.ToDictionary(id => id, id => lookup[id].ToArray());
    }
}
