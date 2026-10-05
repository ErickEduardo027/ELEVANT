using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesReportStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IHumanResourcesReportStore
{
    public async Task<HumanResourcesReportReadResult<HumanResourcesExpirationRow>>
        ListExpirationsAsync(Guid actorId, Guid stationId, DateOnly startDate, DateOnly endDate,
            int page, int limit, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty ||
            !HumanResourcesReportPolicy.ValidRange(startDate, endDate) ||
            page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code == "GESTION_HUMANA") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return new(null, HumanResourcesReportFailure.ForbiddenRole);
        if (!actor.StationScopes.Any(scope => scope.StationId == stationId))
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var station = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.IanaTimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null)
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var asOf = timeProvider.GetUtcNow();
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            asOf, TimeZoneInfo.FindSystemTimeZoneById(station.IanaTimeZone)).DateTime);

        var qualifications =
            from cycle in context.QualificationCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on cycle.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join scope in context.Set<RampAgentStationScope>().AsNoTracking()
                on agent.Id equals scope.RampAgentId
            join equipment in context.EquipmentTypes.AsNoTracking()
                on cycle.EquipmentTypeId equals equipment.Id
            where cycle.IsCurrent && agent.IsActive && scope.StationId == station.Id &&
                scope.ValidFrom <= localToday &&
                (scope.ValidTo == null || scope.ValidTo >= localToday) &&
                cycle.ExpiresOn >= startDate && cycle.ExpiresOn <= endDate
            select new
            {
                cycle.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                Kind = "Qualification",
                Code = equipment.Code,
                cycle.ExpiresOn,
                SortId = cycle.Id,
            };
        var permits =
            from permit in context.AirportPermitCycles.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on permit.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join scope in context.Set<RampAgentStationScope>().AsNoTracking()
                on agent.Id equals scope.RampAgentId
            where permit.IsCurrent && agent.IsActive && scope.StationId == station.Id &&
                scope.ValidFrom <= localToday &&
                (scope.ValidTo == null || scope.ValidTo >= localToday) &&
                permit.ExpiresOn >= startDate && permit.ExpiresOn <= endDate
            select new
            {
                permit.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                Kind = "Permit",
                Code = permit.DocumentType == PermitDocumentType.AirportId
                    ? "AirportId" : "RampDriverLicense",
                permit.ExpiresOn,
                SortId = permit.Id,
            };
        var rows = await qualifications.Concat(permits).Distinct()
            .OrderBy(item => item.ExpiresOn).ThenBy(item => item.Kind)
            .ThenBy(item => item.SortId)
            .Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new(
            new HumanResourcesReportPage<HumanResourcesExpirationRow>(
                stationId, startDate, endDate, page, limit, rows.Length > limit, asOf,
                rows.Take(limit).Select(item => new HumanResourcesExpirationRow(
                    item.PublicId, item.RampProfileId,
                    $"{item.FirstName} {item.LastName}", item.EmployeeNumber,
                    item.Kind, item.Code, item.ExpiresOn)).ToArray()), null);
    }

    public async Task<HumanResourcesReportReadResult<HumanResourcesStaffDistributionRow>>
        ListStaffDistributionAsync(Guid actorId, Guid stationId,
            DateOnly startDate, DateOnly endDate, int page, int limit,
            CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty ||
            !HumanResourcesReportPolicy.ValidRange(startDate, endDate) ||
            page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code == "GESTION_HUMANA") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return new(null, HumanResourcesReportFailure.ForbiddenRole);
        if (!actor.StationScopes.Any(scope => scope.StationId == stationId))
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var stationInternalId = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => (long?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (stationInternalId is null)
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var asOf = timeProvider.GetUtcNow();
        var rows = await (
            from shift in context.ShiftAssignments.AsNoTracking()
            join agent in context.RampAgents.AsNoTracking()
                on shift.RampAgentId equals agent.Id
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            join terminal in context.Terminals.AsNoTracking()
                on shift.TerminalId equals terminal.Id
            join position in context.OperationalPositions.AsNoTracking()
                on shift.OperationalPositionId equals (long?)position.Id into positions
            from position in positions.DefaultIfEmpty()
            where shift.StationId == stationInternalId &&
                shift.WorkDate >= startDate && shift.WorkDate <= endDate
            orderby shift.WorkDate, agent.EmployeeNumber, shift.Id
            select new
            {
                shift.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                TerminalId = terminal.PublicId,
                TerminalCode = terminal.Code,
                PositionCode = position == null ? null : position.Code,
                shift.WorkDate,
                shift.StartsAtLocal,
                shift.EndsAtLocal,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);
        return new(new HumanResourcesReportPage<HumanResourcesStaffDistributionRow>(
            stationId, startDate, endDate, page, limit, rows.Length > limit, asOf,
            rows.Take(limit).Select(item => new HumanResourcesStaffDistributionRow(
                item.PublicId, item.RampProfileId,
                $"{item.FirstName} {item.LastName}", item.EmployeeNumber,
                item.TerminalId, item.TerminalCode, item.PositionCode,
                item.WorkDate, item.StartsAtLocal, item.EndsAtLocal)).ToArray()), null);
    }

    public async Task<HumanResourcesReportReadResult<HumanResourcesQualificationCoverageRow>>
        ListQualificationCoverageAsync(Guid actorId, Guid stationId,
            DateOnly reportDate, int page, int limit,
            CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty || reportDate == default ||
            page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(reportDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code == "GESTION_HUMANA") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return new(null, HumanResourcesReportFailure.ForbiddenRole);
        if (!actor.StationScopes.Any(scope => scope.StationId == stationId))
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var stationInternalId = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => (long?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (stationInternalId is null)
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var eligibleAgents = context.RampAgents.AsNoTracking().Where(agent =>
            agent.IsActive && context.Set<RampAgentStationScope>().Any(scope =>
                scope.RampAgentId == agent.Id && scope.StationId == stationInternalId &&
                scope.ValidFrom <= reportDate &&
                (scope.ValidTo == null || scope.ValidTo >= reportDate)));
        var rows = await context.EquipmentTypes.AsNoTracking()
            .Where(equipment => equipment.IsActive && equipment.RequiresQualification)
            .OrderBy(equipment => equipment.Code).ThenBy(equipment => equipment.Id)
            .Select(equipment => new
            {
                EquipmentTypeId = equipment.PublicId,
                EquipmentCode = equipment.Code,
                EquipmentName = equipment.Name,
                EligibleAgents = eligibleAgents.Count(),
                QualifiedAgents = context.QualificationCycles.AsNoTracking()
                    .Where(cycle => cycle.EquipmentTypeId == equipment.Id &&
                        cycle.IsCurrent && cycle.ObtainedOn <= reportDate &&
                        cycle.ExpiresOn >= reportDate &&
                        eligibleAgents.Any(agent => agent.Id == cycle.RampAgentId))
                    .Select(cycle => cycle.RampAgentId).Distinct().Count(),
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new(new HumanResourcesReportPage<HumanResourcesQualificationCoverageRow>(
            stationId, reportDate, reportDate, page, limit, rows.Length > limit,
            timeProvider.GetUtcNow(), rows.Take(limit).Select(item =>
                new HumanResourcesQualificationCoverageRow(item.EquipmentTypeId,
                    item.EquipmentCode, item.EquipmentName,
                    item.EligibleAgents, item.QualifiedAgents)).ToArray()), null);
    }

    public async Task<HumanResourcesReportReadResult<HumanResourcesAccountMovementRow>>
        ListAccountMovementsAsync(Guid actorId, Guid stationId,
            DateOnly startDate, DateOnly endDate, int page, int limit,
            CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty ||
            !HumanResourcesReportPolicy.ValidRange(startDate, endDate) ||
            page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(startDate));

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code == "GESTION_HUMANA") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return new(null, HumanResourcesReportFailure.ForbiddenRole);
        if (!actor.StationScopes.Any(scope => scope.StationId == stationId))
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var station = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.IanaTimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null)
            return new(null, HumanResourcesReportFailure.ForbiddenStation);

        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.IanaTimeZone);
        var utcStart = startDate == DateOnly.MinValue
            ? DateTimeOffset.MinValue
            : new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(
                startDate.ToDateTime(TimeOnly.MinValue), zone));
        DateTimeOffset? utcEndExclusive = endDate == DateOnly.MaxValue
            ? null
            : new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(
                endDate.AddDays(1).ToDateTime(TimeOnly.MinValue), zone));
        var rows = await (
            from audit in context.AuditEntries.AsNoTracking()
            join account in context.Users.AsNoTracking()
                on audit.EntityPublicId equals (Guid?)account.PublicId
            join agent in context.RampAgents.AsNoTracking()
                on account.PersonId equals agent.PersonId
            join person in context.Persons.AsNoTracking()
                on agent.PersonId equals person.Id
            where audit.StationId == station.Id &&
                audit.EntityType == "iam.accounts" &&
                (audit.Action == "governance.user.created" ||
                 audit.Action == "governance.user.deactivated" ||
                 (audit.Action == "governance.user.updated" &&
                  audit.MetadataJson != null &&
                  EF.Functions.Like(audit.MetadataJson, "%\"Field\":\"user.status\"%"))) &&
                audit.OccurredAt >= utcStart &&
                (utcEndExclusive == null || audit.OccurredAt < utcEndExclusive)
            orderby audit.OccurredAt, audit.Id
            select new
            {
                audit.PublicId,
                AccountId = account.PublicId,
                RampProfileId = agent.PublicId,
                person.FirstName,
                person.LastName,
                agent.EmployeeNumber,
                audit.Action,
                audit.MetadataJson,
                audit.OccurredAt,
            }).Skip((page - 1) * limit).Take(limit + 1)
            .ToArrayAsync(cancellationToken);

        return new(new HumanResourcesReportPage<HumanResourcesAccountMovementRow>(
            stationId, startDate, endDate, page, limit, rows.Length > limit,
            timeProvider.GetUtcNow(), rows.Take(limit).Select(item =>
                new HumanResourcesAccountMovementRow(item.PublicId, item.AccountId,
                    item.RampProfileId, $"{item.FirstName} {item.LastName}",
                    item.EmployeeNumber,
                    item.Action == "governance.user.created" ? "Created" :
                    item.Action == "governance.user.deactivated" ? "Deactivated" :
                    item.MetadataJson?.Contains("\"After\":\"Active\"",
                        StringComparison.Ordinal) == true ? "Reactivated" : "Deactivated",
                    item.OccurredAt)).ToArray()), null);
    }
}
