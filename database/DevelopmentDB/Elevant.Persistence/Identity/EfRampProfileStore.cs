using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfRampProfileStore(ElevantDbContext context,
    IActorContextResolver actors) : IRampProfileStore
{
    public async Task<RampProfileCatalog?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await AuthorizedAsync(actorId, cancellationToken)) return null;
        var stations = await context.Stations.AsNoTracking().Where(item => item.IsActive)
            .OrderBy(item => item.Code).Select(item => new RampProfileStation(
                item.PublicId, item.Code, item.Name)).ToArrayAsync(cancellationToken);
        var activeTerminals = await (from terminal in context.Terminals.AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on terminal.StationId equals station.Id
            where terminal.IsActive && station.IsActive
            orderby station.Code, terminal.Code
            select new { terminal.Id, Data = new RampProfileTerminal(terminal.PublicId,
                station.PublicId, terminal.Code, terminal.Name) })
            .ToArrayAsync(cancellationToken);
        var profiles = await context.RampAgents.AsNoTracking()
            .OrderBy(item => item.EmployeeNumber).ToArrayAsync(cancellationToken);
        var personIds = profiles.Select(item => item.PersonId).ToArray();
        var persons = await context.Persons.AsNoTracking().Where(item => personIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var accounts = await context.Users.AsNoTracking().Where(item => personIds.Contains(item.PersonId))
            .ToDictionaryAsync(item => item.PersonId, item => item.Status, cancellationToken);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var scopes = await context.Set<RampAgentStationScope>().AsNoTracking()
            .Where(item => item.ValidFrom <= today && (item.ValidTo == null || item.ValidTo >= today))
            .ToArrayAsync(cancellationToken);
        var terminalScopes = await context.Set<RampAgentTerminalScope>().AsNoTracking()
            .Where(item => item.ValidFrom <= today && (item.ValidTo == null || item.ValidTo >= today))
            .ToArrayAsync(cancellationToken);
        var stationsById = await context.Stations.AsNoTracking()
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var terminalsById = activeTerminals.ToDictionary(item => item.Id, item => item.Data);
        var profilesById = profiles.ToDictionary(item => item.Id, item => item.PublicId);
        return new RampProfileCatalog(profiles.Select(profile =>
            Map(profile, persons[profile.PersonId], scopes, stationsById,
                terminalScopes, terminalsById, profilesById,
                accounts.ContainsKey(profile.PersonId),
                accounts.TryGetValue(profile.PersonId, out var status) ? status : null))
            .ToArray(), stations, activeTerminals.Select(item => item.Data).ToArray());
    }

    public async Task<RampProfileResult> SaveAsync(Guid actorId, Guid? profileId,
        SaveRampProfileInput input, CancellationToken cancellationToken = default)
    {
        if (!await AuthorizedAsync(actorId, cancellationToken))
            return RampProfileResult.Failed(RampProfileFailure.Forbidden);
        if (input is null || !Valid(input))
            return RampProfileResult.Failed(RampProfileFailure.Invalid);
        var requestedStations = await context.Stations.Where(item =>
            input.StationIds.Contains(item.PublicId) && item.IsActive)
            .ToArrayAsync(cancellationToken);
        if (requestedStations.Length != input.StationIds.Count)
            return RampProfileResult.Failed(RampProfileFailure.Invalid);
        var requestedStationKeys = requestedStations.Select(item => item.Id).ToHashSet();
        var requestedTerminals = input.TerminalIds is null ? null :
            await context.Terminals.AsNoTracking().Where(item =>
                input.TerminalIds.Contains(item.PublicId) && item.IsActive &&
                requestedStationKeys.Contains(item.StationId))
                .ToArrayAsync(cancellationToken);
        if (requestedTerminals is not null && requestedTerminals.Length != input.TerminalIds!.Count)
            return RampProfileResult.Failed(RampProfileFailure.Invalid);
        var profile = profileId is null ? null : await context.RampAgents.SingleOrDefaultAsync(
            item => item.PublicId == profileId, cancellationToken);
        if (profileId is not null && profile is null)
            return RampProfileResult.Failed(RampProfileFailure.NotFound);
        RampAgent? supervisor = null;
        if (input.Supervisor is { Id: Guid supervisorId })
        {
            if (supervisorId == profileId)
                return RampProfileResult.Failed(RampProfileFailure.Invalid);
            var existingSupervisorId = profile?.SupervisorAgentId;
            supervisor = await context.RampAgents.AsNoTracking().SingleOrDefaultAsync(
                item => item.PublicId == supervisorId &&
                    (item.IsActive || item.Id == existingSupervisorId), cancellationToken);
            if (supervisor is null)
                return RampProfileResult.Failed(RampProfileFailure.Invalid);
        }
        if (input.AvatarMediaUrl is not null)
        {
            if (!input.AvatarMediaUrl.StartsWith("/api/v1/media/", StringComparison.Ordinal) ||
                !Guid.TryParse(input.AvatarMediaUrl["/api/v1/media/".Length..], out var avatarId))
                return RampProfileResult.Failed(RampProfileFailure.Invalid);
            var currentAvatar = profile is null ? null : await context.Persons.AsNoTracking()
                .Where(item => item.Id == profile.PersonId)
                .Select(item => item.AvatarMediaUrl).SingleAsync(cancellationToken);
            var cutoff = CommercialMediaLinkPolicy.LinkCutoff(DateTimeOffset.UtcNow);
            if (!await context.MediaAssets.AnyAsync(asset => asset.PublicId == avatarId &&
                asset.Purpose == "avatar" &&
                (asset.CreatedAt >= cutoff || input.AvatarMediaUrl == currentAvatar), cancellationToken))
                return RampProfileResult.Failed(RampProfileFailure.Invalid);
        }
        if (await context.RampAgents.AnyAsync(item => item.EmployeeNumber == input.EmployeeNumber.Trim() &&
            (profile == null || item.Id != profile.Id), cancellationToken))
            return RampProfileResult.Failed(RampProfileFailure.Conflict);

        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var actorDatabaseId = await context.Users.Where(item => item.PublicId == actorId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (profile is not null && supervisor is not null && input.Supervisor is not null &&
                    await WouldCreateSupervisorCycleAsync(profile.Id, supervisor.Id, cancellationToken))
                    return RampProfileResult.Failed(RampProfileFailure.Invalid);
                Person person;
                if (profile is null)
                {
                    person = new Person { PublicId = Guid.CreateVersion7(), CreatedAt = now,
                        UpdatedAt = now, FirstName = input.FirstName.Trim(), LastName = input.LastName.Trim(),
                        IdentificationType = "RAMP_EMPLOYEE",
                        IdentificationNumber = Guid.CreateVersion7().ToString("N") };
                    context.Persons.Add(person);
                    await context.SaveChangesAsync(cancellationToken);
                    profile = new RampAgent { PublicId = Guid.CreateVersion7(), CreatedAt = now,
                        PersonId = person.Id };
                    context.RampAgents.Add(profile);
                }
                else
                {
                    person = await context.Persons.SingleAsync(item => item.Id == profile.PersonId,
                        cancellationToken);
                    person.FirstName = input.FirstName.Trim();
                    person.LastName = input.LastName.Trim();
                    person.UpdatedAt = now;
                }
                if (input.AvatarMediaUrl is not null) person.AvatarMediaUrl = input.AvatarMediaUrl;
                profile.EmployeeNumber = input.EmployeeNumber.Trim();
                profile.Category = input.Category.Trim();
                profile.HireDate = input.HireDate;
                if (input.Supervisor is not null)
                    profile.SupervisorAgentId = supervisor?.Id;
                profile.IsActive = input.IsActive;
                profile.UpdatedAt = now;
                await context.SaveChangesAsync(cancellationToken);

                var oldScopes = await context.Set<RampAgentStationScope>()
                    .Where(item => item.RampAgentId == profile.Id && item.ValidTo == null)
                    .ToArrayAsync(cancellationToken);
                var affectedStationIds = oldScopes.Select(item => item.StationId)
                    .Concat(requestedStations.Select(item => item.Id)).Distinct().ToArray();
                HashSet<long> wantedIds = input.IsActive ? requestedStations.Select(item => item.Id).ToHashSet() : [];
                foreach (var scope in oldScopes.Where(item => !wantedIds.Contains(item.StationId)))
                {
                    if (scope.ValidFrom == today)
                        context.Set<RampAgentStationScope>().Remove(scope);
                    else
                        scope.ValidTo = today.AddDays(-1);
                }
                foreach (var stationId in wantedIds.Except(oldScopes.Select(item => item.StationId)))
                    context.Set<RampAgentStationScope>().Add(new RampAgentStationScope
                    { RampAgentId = profile.Id, StationId = stationId, ValidFrom = today });

                var oldTerminalScopes = await context.Set<RampAgentTerminalScope>()
                    .Where(item => item.RampAgentId == profile.Id && item.ValidTo == null)
                    .ToArrayAsync(cancellationToken);
                var eligibleTerminals = await context.Terminals.AsNoTracking()
                    .Where(item => item.IsActive && wantedIds.Contains(item.StationId))
                    .ToArrayAsync(cancellationToken);
                var eligibleTerminalIds = eligibleTerminals.Select(item => item.Id).ToHashSet();
                var retainedTerminalIds = input.TerminalIds is null
                    ? await context.Terminals.AsNoTracking()
                        .Where(item => wantedIds.Contains(item.StationId))
                        .Select(item => item.Id).ToHashSetAsync(cancellationToken)
                    : null;
                HashSet<long> wantedTerminalIds = input.IsActive
                    ? (requestedTerminals is null
                        ? oldTerminalScopes.Select(item => item.TerminalId)
                        : requestedTerminals.Select(item => item.Id))
                        .Where(item => requestedTerminals is null
                            ? retainedTerminalIds!.Contains(item)
                            : eligibleTerminalIds.Contains(item)).ToHashSet()
                    : [];
                foreach (var terminalScope in oldTerminalScopes.Where(item =>
                    !wantedTerminalIds.Contains(item.TerminalId)))
                {
                    if (terminalScope.ValidFrom >= today)
                        context.Set<RampAgentTerminalScope>().Remove(terminalScope);
                    else
                        terminalScope.ValidTo = today.AddDays(-1);
                }
                foreach (var terminalId in wantedTerminalIds.Except(
                    oldTerminalScopes.Select(item => item.TerminalId)))
                    context.Set<RampAgentTerminalScope>().Add(new RampAgentTerminalScope
                    { RampAgentId = profile.Id, TerminalId = terminalId, ValidFrom = today });

                var account = await context.Users.SingleOrDefaultAsync(item =>
                    item.PersonId == person.Id, cancellationToken);
                if (account is not null)
                {
                    var accountScopes = await context.AccountStationScopes.Where(item =>
                        item.AccountId == account.Id && item.RevokedAt == null)
                        .ToArrayAsync(cancellationToken);
                    foreach (var scope in accountScopes.Where(item => !wantedIds.Contains(item.StationId)))
                        scope.RevokedAt = now;
                    if (!input.IsActive)
                        account.Status = AccountLifecycleStatus.Disabled;
                }
                context.AuditEntries.Add(new AuditEntry { PublicId = Guid.CreateVersion7(),
                    OccurredAt = now, ActorType = AuditActorType.Account,
                    ActorAccountId = actorDatabaseId, Source = AuditSource.Api,
                    CorrelationId = Guid.CreateVersion7(),
                    Action = profileId is null ? "hr.ramp_profile.created" : "hr.ramp_profile.updated",
                    EntityType = "hr.ramp_agents", EntityPublicId = profile.PublicId });
                var recipients = await (from link in context.Set<IdentityUserRole<long>>()
                    join role in context.Roles on link.RoleId equals role.Id
                    where role.NormalizedName == "SUPERADMIN" || role.NormalizedName == "GESTION_HUMANA"
                    select link.UserId).Distinct().ToArrayAsync(cancellationToken);
                foreach (var recipient in recipients)
                    AccountChangeOutboxWriter.Add(context, recipient, null,
                        "ramp_profiles", profile.PublicId, now);
                var affectedStations = await context.Stations.AsNoTracking()
                    .Where(item => affectedStationIds.Contains(item.Id))
                    .Select(item => new { item.Id, item.PublicId })
                    .ToArrayAsync(cancellationToken);
                foreach (var station in affectedStations)
                    await OccPlanningChangeWriter.AddForStationAsync(context, station.Id,
                        station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return RampProfileResult.Success(new RampProfileData(profile.PublicId,
                    person.FirstName, person.LastName, profile.EmployeeNumber,
                    profile.Category, profile.HireDate, profile.IsActive,
                    input.IsActive ? requestedStations.Select(item => new RampProfileStation(
                        item.PublicId, item.Code, item.Name)).ToArray() : [], account is not null,
                    person.AvatarMediaUrl,
                    eligibleTerminals.Where(item => wantedTerminalIds.Contains(item.Id))
                        .Select(item => new RampProfileTerminal(item.PublicId,
                            requestedStations.Single(station => station.Id == item.StationId).PublicId,
                            item.Code, item.Name)).ToArray(),
                    profile.SupervisorAgentId is long supervisorKey
                        ? await context.RampAgents.AsNoTracking()
                            .Where(item => item.Id == supervisorKey)
                            .Select(item => (Guid?)item.PublicId)
                            .SingleOrDefaultAsync(cancellationToken)
                        : null,
                    account?.Status.ToString()));
            });
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return RampProfileResult.Failed(RampProfileFailure.Conflict);
        }
    }

    private async Task<bool> AuthorizedAsync(Guid actorId, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.HasPermission("human_resources.ramp_profiles.read") == true &&
            actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff);
    }

    private async Task<bool> WouldCreateSupervisorCycleAsync(long profileId, long supervisorId,
        CancellationToken cancellationToken)
    {
        var visited = new HashSet<long>();
        long? currentId = supervisorId;
        while (currentId is long ancestorId)
        {
            if (ancestorId == profileId || !visited.Add(ancestorId)) return true;
            currentId = await context.RampAgents.AsNoTracking()
                .Where(item => item.Id == ancestorId)
                .Select(item => item.SupervisorAgentId)
                .SingleAsync(cancellationToken);
        }
        return false;
    }

    private static bool Valid(SaveRampProfileInput input) =>
        !string.IsNullOrWhiteSpace(input.FirstName) && input.FirstName.Trim().Length is >= 2 and <= 100 &&
        !string.IsNullOrWhiteSpace(input.LastName) && input.LastName.Trim().Length is >= 2 and <= 100 &&
        !string.IsNullOrWhiteSpace(input.EmployeeNumber) && input.EmployeeNumber.Trim().Length is >= 2 and <= 32 &&
        !string.IsNullOrWhiteSpace(input.Category) && input.Category.Trim().Length is >= 2 and <= 64 &&
        input.HireDate != default && input.HireDate <= DateOnly.FromDateTime(DateTime.UtcNow) &&
        input.StationIds is { Count: > 0 and <= 20 } &&
        input.StationIds.All(id => id != Guid.Empty) &&
        input.StationIds.Distinct().Count() == input.StationIds.Count &&
        (input.TerminalIds is null || input.TerminalIds.Count <= 40 &&
            input.TerminalIds.All(id => id != Guid.Empty) &&
            input.TerminalIds.Distinct().Count() == input.TerminalIds.Count) &&
        input.Supervisor?.Id != Guid.Empty;

    private static RampProfileData Map(RampAgent profile, Person person,
        IReadOnlyList<RampAgentStationScope> scopes,
        Dictionary<long, Elevant.Domain.Entities.Reference.Station> stations,
        IReadOnlyList<RampAgentTerminalScope> terminalScopes,
        Dictionary<long, RampProfileTerminal> terminals,
        Dictionary<long, Guid> profiles,
        bool hasAccount, AccountLifecycleStatus? accountStatus) =>
        new(profile.PublicId, person.FirstName, person.LastName,
            profile.EmployeeNumber, profile.Category, profile.HireDate, profile.IsActive,
            scopes.Where(item => item.RampAgentId == profile.Id && stations.ContainsKey(item.StationId))
                .Select(item => stations[item.StationId]).Select(item =>
                    new RampProfileStation(item.PublicId, item.Code, item.Name)).ToArray(), hasAccount,
            person.AvatarMediaUrl,
            terminalScopes.Where(item => item.RampAgentId == profile.Id &&
                terminals.ContainsKey(item.TerminalId))
                .Select(item => terminals[item.TerminalId]).ToArray(),
            profile.SupervisorAgentId is long supervisorId &&
                profiles.TryGetValue(supervisorId, out var supervisorPublicId)
                ? supervisorPublicId : null,
            accountStatus?.ToString());
}
