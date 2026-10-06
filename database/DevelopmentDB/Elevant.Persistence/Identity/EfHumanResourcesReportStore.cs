using System.Data;
using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Audit;
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
    public async Task<HumanResourcesReportFailure?> RecordExportAsync(
        Guid actorId, Guid stationId, HumanResourcesReportKind kind,
        DateOnly startDate, DateOnly endDate, string format, int rowCount,
        string? documentKind = null, string? validity = null,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty || !Enum.IsDefined(kind) ||
            !HumanResourcesReportPolicy.ValidRange(startDate, endDate) ||
            !HumanResourcesReportPolicy.ValidExpirationFilters(kind, documentKind, validity) ||
            format is not ("pdf" or "xlsx") || rowCount is < 0 or > 5000)
            throw new ArgumentException("The export audit is invalid.");

        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code == "GESTION_HUMANA") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return HumanResourcesReportFailure.ForbiddenRole;
        if (!actor.StationScopes.Any(scope => scope.StationId == stationId))
            return HumanResourcesReportFailure.ForbiddenStation;

        var stationInternalId = await context.Stations.AsNoTracking()
            .Where(station => station.PublicId == stationId && station.IsActive)
            .Select(station => (long?)station.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (stationInternalId is null)
            return HumanResourcesReportFailure.ForbiddenStation;
        var actorInternalId = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == actorId)
            .Select(user => user.Id)
            .SingleAsync(cancellationToken);

        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = timeProvider.GetUtcNow(),
            ActorType = AuditActorType.Account,
            ActorAccountId = actorInternalId,
            Action = "human-resources.report.exported",
            EntityType = "hr.reports",
            StationId = stationInternalId,
            Source = AuditSource.Api,
            CorrelationId = Guid.CreateVersion7(),
            MetadataJson = JsonSerializer.Serialize(new
            {
                Kind = kind.ToString(), From = startDate, To = endDate,
                Format = format, RowCount = rowCount,
                DocumentKind = documentKind, Validity = validity,
            }),
        });
        await context.SaveChangesAsync(cancellationToken);
        return null;
    }

    public async Task<HumanResourcesReportSnapshotResult> ReadSnapshotAsync(
        Guid actorId, Guid stationId, HumanResourcesReportKind kind,
        DateOnly startDate, DateOnly endDate, int maxRows,
        string? documentKind = null, string? validity = null,
        CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(kind) || maxRows is < 1 or > 5000 ||
            !HumanResourcesReportPolicy.ValidRange(startDate, endDate) ||
            !HumanResourcesReportPolicy.ValidExpirationFilters(kind, documentKind, validity))
            throw new ArgumentOutOfRangeException(nameof(maxRows));

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var asOf = timeProvider.GetUtcNow();
            var rows = new List<IReadOnlyList<HumanResourcesReportCell>>();
            IReadOnlyList<string> columns = kind switch
            {
                HumanResourcesReportKind.Expirations =>
                    ["Agente", "Empleado", "Clase", "Documento", "Vence"],
                HumanResourcesReportKind.AccountMovements =>
                    ["Fecha UTC", "Agente", "Empleado", "Movimiento"],
                HumanResourcesReportKind.StaffDistribution =>
                    ["Fecha", "Agente", "Empleado", "Terminal", "Puesto", "Inicio", "Fin"],
                HumanResourcesReportKind.QualificationCoverage =>
                    ["Equipo", "Nombre", "Elegibles", "Habilitados"],
                _ => throw new ArgumentOutOfRangeException(nameof(kind)),
            };
            var page = 1;
            while (true)
            {
                HumanResourcesReportFailure? failure;
                bool hasMore;
                IReadOnlyList<HumanResourcesReportCell>[] pageRows;
                switch (kind)
                {
                    case HumanResourcesReportKind.Expirations:
                    {
                        var result = await ListExpirationsAtAsync(actorId, stationId,
                            startDate, endDate, page, 100, documentKind, validity,
                            asOf, cancellationToken);
                        failure = result.Failure;
                        hasMore = result.Page?.HasMore ?? false;
                        pageRows = result.Page?.Rows.Select(item =>
                            (IReadOnlyList<HumanResourcesReportCell>)[
                                new(item.AgentName, HumanResourcesReportCellType.Text),
                                new(item.EmployeeNumber, HumanResourcesReportCellType.Text),
                                new(item.Kind, HumanResourcesReportCellType.Text),
                                new(item.Code, HumanResourcesReportCellType.Text),
                                new(item.ExpiresOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.Date),
                            ]).ToArray() ?? [];
                        break;
                    }
                    case HumanResourcesReportKind.AccountMovements:
                    {
                        var result = await ListAccountMovementsAsync(actorId, stationId,
                            startDate, endDate, page, 100, cancellationToken);
                        failure = result.Failure;
                        hasMore = result.Page?.HasMore ?? false;
                        pageRows = result.Page?.Rows.Select(item =>
                            (IReadOnlyList<HumanResourcesReportCell>)[
                                new(item.OccurredAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.DateTime),
                                new(item.AgentName, HumanResourcesReportCellType.Text),
                                new(item.EmployeeNumber, HumanResourcesReportCellType.Text),
                                new(item.Kind, HumanResourcesReportCellType.Text),
                            ]).ToArray() ?? [];
                        break;
                    }
                    case HumanResourcesReportKind.StaffDistribution:
                    {
                        var result = await ListStaffDistributionAsync(actorId, stationId,
                            startDate, endDate, page, 100, cancellationToken);
                        failure = result.Failure;
                        hasMore = result.Page?.HasMore ?? false;
                        pageRows = result.Page?.Rows.Select(item =>
                            (IReadOnlyList<HumanResourcesReportCell>)[
                                new(item.WorkDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.Date),
                                new(item.AgentName, HumanResourcesReportCellType.Text),
                                new(item.EmployeeNumber, HumanResourcesReportCellType.Text),
                                new(item.TerminalCode, HumanResourcesReportCellType.Text),
                                new(item.PositionCode ?? string.Empty, HumanResourcesReportCellType.Text),
                                new(item.StartsAtLocal.ToString("HH:mm", CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.Text),
                                new(item.EndsAtLocal.ToString("HH:mm", CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.Text),
                            ]).ToArray() ?? [];
                        break;
                    }
                    case HumanResourcesReportKind.QualificationCoverage:
                    {
                        var result = await ListQualificationCoverageAsync(actorId, stationId,
                            startDate, endDate, page, 100, cancellationToken);
                        failure = result.Failure;
                        hasMore = result.Page?.HasMore ?? false;
                        pageRows = result.Page?.Rows.Select(item =>
                            (IReadOnlyList<HumanResourcesReportCell>)[
                                new(item.EquipmentCode, HumanResourcesReportCellType.Text),
                                new(item.EquipmentName, HumanResourcesReportCellType.Text),
                                new(item.EligibleAgents.ToString(CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.Number),
                                new(item.QualifiedAgents.ToString(CultureInfo.InvariantCulture),
                                    HumanResourcesReportCellType.Number),
                            ]).ToArray() ?? [];
                        break;
                    }
                    default:
                        throw new ArgumentOutOfRangeException(nameof(kind));
                }
                if (failure is not null) return new HumanResourcesReportSnapshotResult(null, failure);
                if (rows.Count + pageRows.Length > maxRows)
                    return new HumanResourcesReportSnapshotResult(null,
                        HumanResourcesReportFailure.TooLarge);
                rows.AddRange(pageRows);
                if (!hasMore) break;
                page++;
            }

            var stationCode = await context.Stations.AsNoTracking()
                .Where(item => item.PublicId == stationId && item.IsActive)
                .Select(item => item.Code)
                .SingleAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new HumanResourcesReportSnapshotResult(
                new HumanResourcesReportSnapshot(kind, stationId, startDate,
                    endDate, asOf, columns, rows)
                {
                    StationCode = stationCode,
                    DocumentKind = documentKind,
                    Validity = validity,
                }, null);
        });
    }

    public Task<HumanResourcesReportReadResult<HumanResourcesExpirationRow>>
        ListExpirationsAsync(Guid actorId, Guid stationId, DateOnly startDate, DateOnly endDate,
            int page, int limit, string? documentKind = null, string? validity = null,
            CancellationToken cancellationToken = default) =>
        ListExpirationsAtAsync(actorId, stationId, startDate, endDate, page, limit,
            documentKind, validity, timeProvider.GetUtcNow(), cancellationToken);

    private async Task<HumanResourcesReportReadResult<HumanResourcesExpirationRow>>
        ListExpirationsAtAsync(Guid actorId, Guid stationId,
            DateOnly startDate, DateOnly endDate, int page, int limit,
            string? documentKind, string? validity, DateTimeOffset asOf,
            CancellationToken cancellationToken)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty ||
            !HumanResourcesReportPolicy.ValidRange(startDate, endDate) ||
            !HumanResourcesReportPolicy.ValidExpirationFilters(
                HumanResourcesReportKind.Expirations, documentKind, validity) ||
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
        var filtered = qualifications.Concat(permits).Distinct();
        if (documentKind is not null)
            filtered = filtered.Where(item => item.Kind == documentKind);
        if (validity == "Current")
            filtered = filtered.Where(item => item.ExpiresOn >= localToday);
        else if (validity == "Expired")
            filtered = filtered.Where(item => item.ExpiresOn < localToday);
        var rows = await filtered
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
            DateOnly startDate, DateOnly reportDate, int page, int limit,
            CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty ||
            !HumanResourcesReportPolicy.ValidRange(startDate, reportDate) ||
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
            stationId, startDate, reportDate, page, limit, rows.Length > limit,
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
