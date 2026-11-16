using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// «¿Puede operar?» per ramp agent and the agent's own schedule (ADR-0026). Readiness uses the
/// same account, scope and document conditions as the OCC eligibility projection
/// (<c>EfOccPlanningReadStore</c>), evaluated for today instead of for one flight.
/// </summary>
internal sealed class EfWorkforceReadinessStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider clock) : IWorkforceReadinessStore
{
    public async Task<IReadOnlyList<RampAgentReadinessData>?> ListReadinessAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.HasPermission("human_resources.ramp_profiles.read") != true ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return null;
        var now = clock.GetUtcNow();
        var today = BusinessCalendar.Today(now);

        var agents = await (from agent in context.RampAgents.AsNoTracking()
                            join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                            where agent.IsActive
                            orderby person.LastName, person.FirstName
                            select new { agent.Id, agent.PublicId, agent.PersonId, agent.EmployeeNumber, agent.IsActive,
                                Name = person.FirstName + " " + person.LastName })
            .ToArrayAsync(cancellationToken);
        if (agents.Length == 0) return [];
        var agentIds = agents.Select(agent => agent.Id).ToArray();
        var personIds = agents.Select(agent => agent.PersonId).ToArray();

        var accounts = await context.Users.AsNoTracking().Where(account => personIds.Contains(account.PersonId))
            .Select(account => new
            {
                account.Id, account.PersonId,
                IsActive = account.Status == AccountLifecycleStatus.Active &&
                    account.InvitationStatus == InvitationStatus.Accepted && account.EmailConfirmed &&
                    account.LockoutEnabled && !account.TwoFactorEnabled && account.SecurityStamp != null &&
                    account.SecurityStamp != string.Empty && (account.LockoutEnd == null || account.LockoutEnd <= now),
            }).ToArrayAsync(cancellationToken);
        var accountIds = accounts.Select(account => account.Id).ToArray();
        var mobileRole = (await (from assignment in context.Set<IdentityUserRole<long>>().AsNoTracking()
                                 join role in context.Roles.AsNoTracking() on assignment.RoleId equals role.Id
                                 where accountIds.Contains(assignment.UserId) && role.NormalizedName == "RAMP_AGENT" &&
                                       role.Portal == PortalKind.RampMobileApp
                                 select assignment.UserId).Distinct().ToArrayAsync(cancellationToken)).ToHashSet();
        var memberships = (await (from membership in context.OrganizationMemberships.AsNoTracking()
                                  join organization in context.Organizations.AsNoTracking()
                                      on membership.OrganizationId equals organization.Id
                                  where accountIds.Contains(membership.AccountId) &&
                                        membership.Status == MembershipStatus.Active &&
                                        membership.Kind == MembershipKind.InternalStaff &&
                                        organization.Status == OrganizationStatus.Active &&
                                        organization.Type == OrganizationType.AviamOperator &&
                                        (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                                        (membership.ValidTo == null || membership.ValidTo >= today)
                                  select membership.AccountId).Distinct().ToArrayAsync(cancellationToken)).ToHashSet();
        var accountStations = (await (from scope in context.AccountStationScopes.AsNoTracking()
                                      join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
                                      where accountIds.Contains(scope.AccountId) && scope.GrantedAt <= now && scope.RevokedAt == null
                                      select new { scope.AccountId, station.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.AccountId, item => item.Code);
        var agentStations = (await (from scope in context.Set<RampAgentStationScope>().AsNoTracking()
                                    join station in context.Stations.AsNoTracking() on scope.StationId equals station.Id
                                    where agentIds.Contains(scope.RampAgentId) && scope.ValidFrom <= today &&
                                          (scope.ValidTo == null || scope.ValidTo >= today)
                                    select new { scope.RampAgentId, station.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId, item => item.Code);
        var terminals = (await context.Set<RampAgentTerminalScope>().AsNoTracking()
                .Where(scope => agentIds.Contains(scope.RampAgentId) && scope.ValidFrom <= today &&
                    (scope.ValidTo == null || scope.ValidTo >= today))
                .Select(scope => scope.RampAgentId).ToArrayAsync(cancellationToken))
            .GroupBy(id => id).ToDictionary(group => group.Key, group => group.Count());
        var permits = await context.AirportPermitCycles.AsNoTracking()
            .Where(cycle => agentIds.Contains(cycle.RampAgentId) && cycle.IsCurrent && cycle.IssuedOn <= today)
            .Select(cycle => new { cycle.RampAgentId, cycle.DocumentType, cycle.ExpiresOn }).ToArrayAsync(cancellationToken);
        var qualifications = (await (from cycle in context.QualificationCycles.AsNoTracking()
                                     join equipment in context.EquipmentTypes.AsNoTracking() on cycle.EquipmentTypeId equals equipment.Id
                                     where agentIds.Contains(cycle.RampAgentId) && cycle.IsCurrent && cycle.ObtainedOn <= today
                                     select new { cycle.RampAgentId, equipment.Code, cycle.ExpiresOn }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId);
        var horizon = today.AddDays(13);
        var shifts = (await context.ShiftAssignments.AsNoTracking()
                .Where(shift => agentIds.Contains(shift.RampAgentId) && shift.WorkDate >= today && shift.WorkDate <= horizon)
                .Select(shift => shift.RampAgentId).ToArrayAsync(cancellationToken))
            .GroupBy(id => id).ToDictionary(group => group.Key, group => group.Count());
        var absences = (await context.AvailabilityRequests.AsNoTracking()
                .Where(request => agentIds.Contains(request.RampAgentId) && request.Status == AvailabilityRequestStatus.Approved &&
                    (request.Type == AvailabilityRequestType.DayOff || request.Type == AvailabilityRequestType.Restriction) &&
                    request.EndsOn >= today && request.StartsOn <= horizon)
                .Select(request => new { request.RampAgentId, request.StartsOn }).ToArrayAsync(cancellationToken))
            .GroupBy(item => item.RampAgentId).ToDictionary(group => group.Key, group => group.Min(item => item.StartsOn));

        return agents.Select(agent =>
        {
            var account = accounts.FirstOrDefault(item => item.PersonId == agent.PersonId);
            DateOnly? Permit(PermitDocumentType type) => permits.Where(item => item.RampAgentId == agent.Id && item.DocumentType == type)
                .Select(item => (DateOnly?)item.ExpiresOn).Max();
            var facts = new RampAgentReadinessFacts(
                agent.IsActive, account is not null, account?.IsActive == true,
                account is not null && mobileRole.Contains(account.Id), account is not null && memberships.Contains(account.Id),
                agentStations[agent.Id].Distinct().ToArray(),
                account is null ? [] : accountStations[account.Id].Distinct().ToArray(),
                terminals.GetValueOrDefault(agent.Id), Permit(PermitDocumentType.AirportId), Permit(PermitDocumentType.RampDriverLicense),
                qualifications[agent.Id].Select(item => (item.Code, item.ExpiresOn)).ToArray(),
                shifts.GetValueOrDefault(agent.Id), absences.TryGetValue(agent.Id, out var absence) ? absence : null);
            return RampAgentReadiness.Evaluate(agent.PublicId, agent.Name, agent.EmployeeNumber, facts, today);
        }).ToArray();
    }

    public async Task<RampAgentScheduleData?> GetOwnScheduleAsync(Guid accountId, DateOnly from, DateOnly to,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null || !RampOperationsAccess.IsAuthorized(actor)) return null;
        var agents = await (from account in context.Users.AsNoTracking()
                            join agent in context.RampAgents.AsNoTracking() on account.PersonId equals agent.PersonId
                            join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                            where account.PublicId == accountId && agent.IsActive
                            select new { agent.Id, agent.PublicId, Name = person.FirstName + " " + person.LastName })
            .Take(2).ToArrayAsync(cancellationToken);
        if (agents.Length != 1) return null;
        var me = agents[0];
        var (first, last) = (from, to);
        var today = BusinessCalendar.Today(clock.GetUtcNow());

        var shifts = await (from shift in context.ShiftAssignments.AsNoTracking()
                            join station in context.Stations.AsNoTracking() on shift.StationId equals station.Id
                            join terminal in context.Terminals.AsNoTracking() on shift.TerminalId equals terminal.Id
                            where shift.RampAgentId == me.Id && shift.WorkDate >= first && shift.WorkDate <= last
                            orderby shift.WorkDate, shift.StartsAtLocal
                            select new RampAgentShiftData(shift.PublicId, shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal,
                                shift.Block.ToString(), station.Code, terminal.Code))
            .ToArrayAsync(cancellationToken);
        var permits = await context.AirportPermitCycles.AsNoTracking()
            .Where(cycle => cycle.RampAgentId == me.Id && cycle.IsCurrent)
            .Select(cycle => new { cycle.DocumentType, cycle.DocumentNumber, cycle.ExpiresOn }).ToArrayAsync(cancellationToken);
        var qualifications = await (from cycle in context.QualificationCycles.AsNoTracking()
                                    join equipment in context.EquipmentTypes.AsNoTracking() on cycle.EquipmentTypeId equals equipment.Id
                                    where cycle.RampAgentId == me.Id && cycle.IsCurrent
                                    select new { equipment.Name, cycle.ExpiresOn }).ToArrayAsync(cancellationToken);
        var documents = permits.Select(item => new RampAgentDocumentData(item.DocumentType.ToString(),
                item.DocumentType == PermitDocumentType.AirportId ? "Carnet aeroportuario" : "Licencia de conducción en rampa",
                item.DocumentNumber, item.ExpiresOn, RampAgentReadiness.Validity(item.ExpiresOn, today)))
            .Concat(qualifications.Select(item => new RampAgentDocumentData("Qualification", "Habilitación · " + item.Name, null,
                item.ExpiresOn, RampAgentReadiness.Validity(item.ExpiresOn, today))))
            .OrderBy(item => item.ExpiresOn).ToArray();
        return new RampAgentScheduleData(me.PublicId, me.Name, from, to, shifts, documents);
    }
}
