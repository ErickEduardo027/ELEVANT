using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Builds the OCC reports from the authoritative operation, review and service rows of one
/// station and period. Reports are projections: nothing is stored except the export audit.
/// </summary>
internal sealed class EfOccReportStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IOccReportStore
{
    private static readonly CultureInfo Spanish = CultureInfo.GetCultureInfo("es-DO");

    private sealed record OperationRow(long Id, long TurnaroundId, DateOnly Date, string Code, string Airline,
        string? Registration, GroundOperationStatus Status, DateTimeOffset? PlannedStart, DateTimeOffset? PlannedEnd,
        DateTimeOffset? ActualStart, DateTimeOffset? ActualEnd);

    public async Task<OccReportResult> ReadAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from,
        DateOnly to, int page, int limit, OccReportFilters filters, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filters);
        var definition = OccReportCatalog.All.SingleOrDefault(item => item.Kind == kind);
        if (definition is null || page < 1 || limit is < 1 or > OccReportCatalog.MaxExportRows ||
            (long)(page - 1) * limit > int.MaxValue || !OccReportCatalog.ValidRange(from, to) ||
            !OccReportCatalog.ValidFilters(definition, filters))
            throw new ArgumentException("The report query is invalid.");
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, "operations.reports.read", stationId))
            return new(null, OccReportFailure.Forbidden);
        var station = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code, item.Name, item.IanaTimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null) return new(null, OccReportFailure.StationNotFound);
        // The station's calendar (2-F): an unknown zone falls back to AVIAM's, never to the host's.
        var zone = BusinessCalendar.Zone(station.IanaTimeZone);
        var applied = await FiltersAsync(station.Id, filters, cancellationToken);

        List<IReadOnlyList<OccReportCell>> rows;
        if (kind == OccReportKind.CoverageAssignments)
            rows = await CoverageAssignmentsAsync(station.Id, from, to, applied, zone, cancellationToken);
        else
        {
            var status = filters.Status is { } code ? Enum.Parse<GroundOperationStatus>(code) : (GroundOperationStatus?)null;
            var query = from turnaround in context.Turnarounds.AsNoTracking()
                        join operation in context.GroundOperations.AsNoTracking() on turnaround.Id equals operation.TurnaroundId
                        join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                        where turnaround.StationId == station.Id &&
                              turnaround.OperationDate >= @from && turnaround.OperationDate <= to
                        select new { turnaround, operation, airline };
            if (applied.AirlineKey is { } airlineKey) query = query.Where(item => item.turnaround.AirlineId == airlineKey);
            if (status is { } wanted) query = query.Where(item => item.operation.CurrentStatus == wanted);
            // An agent's operations are those they were assigned to, released assignments included; the productivity
            // report keeps only that agent's own work.
            if (applied.AgentKey is { } agentKey && kind != OccReportKind.AgentProductivity)
                query = query.Where(item => context.OperationAgentAssignments.Any(assignment =>
                    assignment.GroundOperationId == item.operation.Id && assignment.RampAgentId == agentKey));
            var operations = await query
                .OrderBy(item => item.turnaround.OperationDate).ThenBy(item => item.turnaround.OperationCode)
                .ThenBy(item => item.operation.Id)
                .Select(item => new OperationRow(item.operation.Id, item.turnaround.Id, item.turnaround.OperationDate,
                    item.turnaround.OperationCode, item.airline.Name, item.turnaround.AircraftRegistration,
                    item.operation.CurrentStatus, item.operation.PlannedStartAt, item.operation.PlannedEndAt,
                    item.operation.ActualStartAt, item.operation.ActualEndAt))
                .ToArrayAsync(cancellationToken);
            var ids = operations.Select(item => item.Id).ToArray();
            rows = kind switch
            {
                OccReportKind.Operations => await OperationsAsync(operations, ids, zone, cancellationToken),
                OccReportKind.TurnaroundTimes => TurnaroundTimes(operations),
                OccReportKind.ServicesByAirline => await ServicesAsync(operations, cancellationToken),
                OccReportKind.Reviews => await ReviewsAsync(operations, ids, zone, cancellationToken),
                OccReportKind.DailyClose => await DailyCloseAsync(operations, ids, zone, cancellationToken),
                _ => await ProductivityAsync(operations, ids, applied.AgentKey, cancellationToken),
            };
        }
        var slice = rows.Skip((page - 1) * limit).Take(limit + 1).ToArray();
        return new(new OccReportTable(definition, stationId, station.Code, from, to, timeProvider.GetUtcNow(),
            slice.Take(limit).ToArray(), page, limit, slice.Length > limit)
        {
            TimeZoneId = station.IanaTimeZone,
            StationName = station.Name,
            GeneratedBy = actor!.DisplayName,
            Filters = applied.Labels,
            TotalRows = rows.Count,
            Summary = OccReportDocuments.Summary(kind, rows),
            Totals = OccReportDocuments.Totals(definition, rows),
        }, null);
    }

    /// <summary>The internal keys of the filters and their readable names; an unknown id matches nothing.</summary>
    private sealed record AppliedFilters(long? AirlineKey, long? AgentKey, long? TerminalKey,
        IReadOnlyList<Elevant.Application.Documents.ReportFilter> Labels);

    private async Task<AppliedFilters> FiltersAsync(long stationKey, OccReportFilters filters,
        CancellationToken cancellationToken)
    {
        var labels = new List<Elevant.Application.Documents.ReportFilter>();
        long? airlineKey = null, agentKey = null, terminalKey = null;
        if (filters.AirlineId is { } airlineId)
        {
            var airline = await context.Airlines.AsNoTracking().Where(item => item.PublicId == airlineId)
                .Select(item => new { item.Id, item.Name }).SingleOrDefaultAsync(cancellationToken);
            airlineKey = airline?.Id ?? -1;
            labels.Add(new(OccReportCatalog.FilterLabel(OccReportCatalog.AirlineFilter), airline?.Name ?? "No encontrada"));
        }
        if (filters.Status is { } status)
            labels.Add(new(OccReportCatalog.FilterLabel(OccReportCatalog.StatusFilter),
                OccReportCatalog.Statuses.Single(item => item.Code == status).Label));
        if (filters.AgentId is { } agentId)
        {
            var agent = await (from item in context.RampAgents.AsNoTracking()
                               join person in context.Persons.AsNoTracking() on item.PersonId equals person.Id
                               where item.PublicId == agentId
                               select new { item.Id, item.EmployeeNumber, Name = person.FirstName + " " + person.LastName })
                .SingleOrDefaultAsync(cancellationToken);
            agentKey = agent?.Id ?? -1;
            labels.Add(new(OccReportCatalog.FilterLabel(OccReportCatalog.AgentFilter),
                agent is null ? "No encontrado" : $"{agent.Name.Trim()} ({agent.EmployeeNumber})"));
        }
        if (filters.TerminalId is { } terminalId)
        {
            var terminal = await context.Terminals.AsNoTracking()
                .Where(item => item.PublicId == terminalId && item.StationId == stationKey)
                .Select(item => new { item.Id, item.Code, item.Name }).SingleOrDefaultAsync(cancellationToken);
            terminalKey = terminal?.Id ?? -1;
            labels.Add(new(OccReportCatalog.FilterLabel(OccReportCatalog.TerminalFilter),
                terminal is null ? "No encontrada" : string.IsNullOrWhiteSpace(terminal.Name) || terminal.Name == terminal.Code
                    ? terminal.Code : $"{terminal.Code} · {terminal.Name}"));
        }
        return new(airlineKey, agentKey, terminalKey, labels);
    }

    /// <summary>
    /// «Asignaciones de cobertura»: every position coverage that starts in the period (local days of the station),
    /// released ones included, with its stands, who assigned it and when and, once released, who released it and when.
    /// </summary>
    private async Task<List<IReadOnlyList<OccReportCell>>> CoverageAssignmentsAsync(long stationKey, DateOnly from,
        DateOnly to, AppliedFilters filters, TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        var start = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(
            System.DateTime.SpecifyKind(from.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified), zone));
        var end = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(
            System.DateTime.SpecifyKind(to.AddDays(1).ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified), zone));
        var query = context.Set<Elevant.Domain.Entities.Operations.PositionCoverage>().AsNoTracking()
            .Where(item => item.StationId == stationKey && item.StartsAt >= start && item.StartsAt < end);
        if (filters.TerminalKey is { } terminalKey) query = query.Where(item => item.TerminalId == terminalKey);
        if (filters.AgentKey is { } agentKey) query = query.Where(item => item.RampAgentId == agentKey);
        var coverages = await (from coverage in query
                               join terminal in context.Terminals.AsNoTracking() on coverage.TerminalId equals terminal.Id
                               join agent in context.RampAgents.AsNoTracking() on coverage.RampAgentId equals agent.Id
                               join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                               orderby coverage.StartsAt, terminal.Code, coverage.Id
                               select new { coverage.Id, coverage.StartsAt, coverage.EndsAt, coverage.CreatedAt,
                                   coverage.AssignedByAccountId, coverage.ReleasedAt, coverage.ReleasedByAccountId,
                                   coverage.IsReinforcement, Terminal = terminal.Code,
                                   Agent = person.FirstName + " " + person.LastName, agent.EmployeeNumber })
            .ToArrayAsync(cancellationToken);
        var ids = coverages.Select(item => item.Id).ToArray();
        var stands = (await (from link in context.Set<Elevant.Domain.Entities.Operations.PositionCoverageStand>().AsNoTracking()
                             join stand in context.Stands.AsNoTracking() on link.StandId equals stand.Id
                             where ids.Contains(link.PositionCoverageId)
                             select new { link.PositionCoverageId, stand.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.PositionCoverageId, item => item.Code);
        var accountIds = coverages.Select(item => item.AssignedByAccountId)
            .Concat(coverages.Select(item => item.ReleasedByAccountId).OfType<long>()).Distinct().ToArray();
        var accounts = await (from user in context.Users.AsNoTracking()
                              join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                              where accountIds.Contains(user.Id)
                              select new { user.Id, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, item => item.Name.Trim(), cancellationToken);
        string Account(long? id) => id is { } key && accounts.TryGetValue(key, out var name) && name.Length > 0 ? name : "—";
        return coverages.Select(item => (IReadOnlyList<OccReportCell>)
        [
            Text(Date(DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(item.StartsAt, zone).DateTime))), Text(item.Terminal),
            Text(stands[item.Id].Any() ? string.Join(", ", stands[item.Id].Order(StringComparer.Ordinal)) : "—"),
            Text($"{item.Agent.Trim()} ({item.EmployeeNumber})"),
            Text(DateTime(item.StartsAt, zone)), Text(DateTime(item.EndsAt, zone)), Text(DateTime(item.CreatedAt, zone)),
            Text(Account(item.AssignedByAccountId)),
            Text(item.ReleasedAt is { } released ? DateTime(released, zone) : "—"),
            Text(item.ReleasedAt is null ? "—" : Account(item.ReleasedByAccountId)),
            Text(item.IsReinforcement ? "Sí" : "No"),
        ]).ToList();
    }

    public async Task<OccReportFailure?> RecordExportAsync(Guid actorId, OccReportKind kind, Guid stationId,
        DateOnly from, DateOnly to, string format, int rows, OccReportFilters filters,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filters);
        if (!Enum.IsDefined(kind) || format is not ("csv" or "xlsx" or "pdf") || rows < 0 ||
            !OccReportCatalog.ValidRange(from, to))
            throw new ArgumentException("The export audit is invalid.");
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, "operations.reports.export", stationId)) return OccReportFailure.Forbidden;
        var stationKey = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (stationKey is null) return OccReportFailure.StationNotFound;
        var accountKey = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = timeProvider.GetUtcNow(),
            ActorType = AuditActorType.Account, ActorAccountId = accountKey,
            Action = "operations.report.exported", EntityType = "ops.reports", StationId = stationKey,
            Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            MetadataJson = JsonSerializer.Serialize(new
            {
                Kind = kind.ToString(), From = from, To = to, Format = format, RowCount = rows,
                filters.AirlineId, filters.Status, filters.AgentId, filters.TerminalId,
            }),
        });
        await context.SaveChangesAsync(cancellationToken);
        return null;
    }

    private static bool Allowed(ActorContext? actor, string permission, Guid stationId) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff) &&
        actor.StationScopes.Any(scope => scope.StationId == stationId);

    /// <summary>One assignment of record with its agent, for the work attribution of the reports (3-N14).</summary>
    private sealed record AssignmentRow(long OperationId, long AgentId, string EmployeeNumber, string Name,
        DateTimeOffset AssignedAt, DateTimeOffset? ReleasedAt);

    /// <summary>Every assignment of the operations, released ones included: the attribution decides who worked.</summary>
    private Task<AssignmentRow[]> AssignmentsAsync(long[] ids, CancellationToken cancellationToken) =>
        (from assignment in context.OperationAgentAssignments.AsNoTracking()
         join agent in context.RampAgents.AsNoTracking() on assignment.RampAgentId equals agent.Id
         join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
         where ids.Contains(assignment.GroundOperationId)
         select new AssignmentRow(assignment.GroundOperationId, agent.Id, agent.EmployeeNumber,
             person.FirstName + " " + person.LastName, assignment.AssignedAt, assignment.ReleasedAt))
        .ToArrayAsync(cancellationToken);

    /// <summary>Who worked the operation and their minutes (<see cref="OperationWorkAttribution"/>).</summary>
    private static IReadOnlyList<OperationWorkAttribution.AgentWork> Attribution(OperationRow operation,
        IEnumerable<AssignmentRow> assignments) =>
        OperationWorkAttribution.Attribute(assignments.Select(item =>
                new OperationWorkAttribution.Assignment(item.AgentId, item.AssignedAt, item.ReleasedAt)),
            operation.ActualStart, operation.ActualEnd);

    private async Task<List<IReadOnlyList<OccReportCell>>> OperationsAsync(OperationRow[] operations, long[] ids,
        TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        // «Agentes» lists who worked the operation (3-N14): its assigned agents before the start, then whoever worked
        // a stretch of it, a handover included; an agent released before the start does not appear.
        var assignments = (await AssignmentsAsync(ids, cancellationToken)).ToLookup(item => item.OperationId);
        return operations.Select(item =>
        {
            var names = assignments[item.Id].GroupBy(row => row.AgentId).ToDictionary(group => group.Key,
                group => group.First().Name);
            var agents = Attribution(item, assignments[item.Id]).Select(work => names[work.AgentId]).Order().ToArray();
            return (IReadOnlyList<OccReportCell>)
            [
                Text(Date(item.Date)), Text(item.Code), Text(item.Airline), Text(item.Registration ?? "—"),
                Text(OperationLabels.Status(item.Status)), Text(Time(item.PlannedStart, zone)), Text(Time(item.PlannedEnd, zone)),
                Text(Time(item.ActualStart, zone)), Text(Time(item.ActualEnd, zone)),
                Text(agents.Length > 0 ? string.Join(", ", agents) : "Sin asignar"),
            ];
        }).ToList();
    }

    private static List<IReadOnlyList<OccReportCell>> TurnaroundTimes(OperationRow[] operations) =>
        operations.Where(item => item.ActualStart is not null && item.ActualEnd is not null)
            .Select(item =>
            {
                var actual = Minutes(item.ActualStart, item.ActualEnd)!.Value;
                var planned = Minutes(item.PlannedStart, item.PlannedEnd);
                return (IReadOnlyList<OccReportCell>)
                [
                    Text(Date(item.Date)), Text(item.Code), Text(item.Airline),
                    planned is { } value ? OccReportCell.Number(value) : Text("—"), OccReportCell.Number(actual),
                    planned is { } plan ? OccReportCell.Number(actual - plan) : Text("—"),
                ];
            }).ToList();

    /// <summary>
    /// What was executed for each airline is what Finance bills (3-N15): the billable services of the operations OCC
    /// approved, with the one rule of <see cref="ServiceBillability"/> (OCC's exclusion included). Planned, not
    /// performed, cancelled or unreviewed work does not count, so the report matches «Por facturar».
    /// </summary>
    private async Task<List<IReadOnlyList<OccReportCell>>> ServicesAsync(OperationRow[] operations,
        CancellationToken cancellationToken)
    {
        var approved = operations.Where(item => item.Status == GroundOperationStatus.Approved).ToArray();
        var airlineOf = approved.ToDictionary(item => item.Id, item => item.Airline);
        var ids = approved.Select(item => item.Id).ToArray();
        var services = await (from service in context.OperationServices.AsNoTracking().Where(ServiceBillability.Billable)
                              join definition in context.ServiceDefinitions.AsNoTracking() on service.ServiceDefinitionId equals definition.Id
                              where ids.Contains(service.GroundOperationId)
                              select new { service.GroundOperationId, definition.Name, service.BillingUnitSnapshot,
                                  service.ContractedQuantity, service.ExecutedQuantity })
            .ToArrayAsync(cancellationToken);
        // 3-N26: the unit as Finance names it in its catalog («Operación»), not the code the rate snapshot keeps.
        var unitCodes = services.Select(item => item.BillingUnitSnapshot).Distinct().ToArray();
        var unitNames = await context.BillingUnits.AsNoTracking().Where(unit => unitCodes.Contains(unit.Code))
            .ToDictionaryAsync(unit => unit.Code, unit => unit.Name, StringComparer.OrdinalIgnoreCase, cancellationToken);
        string Unit(string code) => unitNames.TryGetValue(code, out var name) && !string.IsNullOrWhiteSpace(name)
            ? name.Trim() : OperationLabels.BillingUnit(code);
        return services.GroupBy(item => (Airline: airlineOf[item.GroundOperationId], item.Name, item.BillingUnitSnapshot))
            .OrderBy(group => group.Key.Airline, StringComparer.CurrentCulture).ThenBy(group => group.Key.Name, StringComparer.CurrentCulture)
            .Select(group => (IReadOnlyList<OccReportCell>)
            [
                Text(group.Key.Airline), Text(group.Key.Name), Text(Unit(group.Key.BillingUnitSnapshot)),
                OccReportCell.Number(group.Select(item => item.GroundOperationId).Distinct().Count()),
                OccReportCell.Number(group.Sum(item => item.ContractedQuantity)),
                OccReportCell.Number(group.Sum(item => item.ExecutedQuantity)),
            ]).ToList();
    }

    private async Task<List<IReadOnlyList<OccReportCell>>> ReviewsAsync(OperationRow[] operations, long[] ids,
        TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        var byId = operations.ToDictionary(item => item.Id);
        var decisions = await (from decision in context.ReviewDecisions.AsNoTracking()
                               join submission in context.OperationSubmissions.AsNoTracking() on decision.OperationSubmissionId equals submission.Id
                               where ids.Contains(submission.GroundOperationId)
                               orderby decision.DecidedAt
                               select new { submission.GroundOperationId, submission.RevisionNumber, decision.Outcome,
                                   decision.Reason, decision.DecidedAt })
            .ToArrayAsync(cancellationToken);
        var incidents = (await context.Incidents.AsNoTracking().Where(item => ids.Contains(item.GroundOperationId))
                .Select(item => new { item.GroundOperationId, item.IncidentType, item.Severity }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId);
        return decisions.Select(item =>
        {
            var operation = byId[item.GroundOperationId];
            var reported = incidents[item.GroundOperationId].ToArray();
            return (IReadOnlyList<OccReportCell>)
            [
                Text(Date(operation.Date)), Text(operation.Code), Text(operation.Airline),
                OccReportCell.Number(item.RevisionNumber), Text(item.Outcome == ReviewOutcome.Approved ? "Aprobada" : "Devuelta"),
                Text(string.IsNullOrWhiteSpace(item.Reason) ? "—" : item.Reason.Trim()), Text(DateTime(item.DecidedAt, zone)),
                Text(reported.Length == 0 ? "Ninguna"
                    : string.Join("; ", reported.Select(incident =>
                        OperationLabels.Incident(incident.IncidentType, incident.Severity)))),
            ];
        }).ToList();
    }

    /// <summary>
    /// Each agent's operations and minutes as <see cref="OperationWorkAttribution"/> attributes them (3-N14): an agent
    /// released before the start counts nothing and, in a handover, each agent adds the minutes of their own stretch.
    /// </summary>
    private async Task<List<IReadOnlyList<OccReportCell>>> ProductivityAsync(OperationRow[] operations, long[] ids,
        long? onlyAgent,
        CancellationToken cancellationToken)
    {
        var assignments = await AssignmentsAsync(ids, cancellationToken);
        var agents = assignments.GroupBy(item => item.AgentId)
            .ToDictionary(group => group.Key, group => (group.First().Name, group.First().EmployeeNumber));
        var byOperation = assignments.ToLookup(item => item.OperationId);
        var work = operations.SelectMany(operation => Attribution(operation, byOperation[operation.Id])
            .Select(item => (Operation: operation, item.AgentId, item.Minutes)))
            .Where(item => onlyAgent is null || item.AgentId == onlyAgent).ToArray();
        return work.GroupBy(item => item.AgentId)
            .OrderBy(group => agents[group.Key].Name, StringComparer.CurrentCulture)
            .ThenBy(group => agents[group.Key].EmployeeNumber, StringComparer.Ordinal)
            .Select(group =>
            {
                var (name, employeeNumber) = agents[group.Key];
                var worked = group.ToArray();
                return (IReadOnlyList<OccReportCell>)
                [
                    Text(name), Text(employeeNumber), OccReportCell.Number(worked.Length),
                    OccReportCell.Number(worked.Count(item => item.Operation.Status == GroundOperationStatus.Approved)),
                    OccReportCell.Number(worked.Count(item => item.Operation.Status == GroundOperationStatus.Returned)),
                    OccReportCell.Number(worked.Sum(item => item.Minutes)),
                ];
            }).ToList();
    }

    /// <summary>
    /// The day's operational close OCC used to build by hand (ADR-0034). The notice is the minutes
    /// between the last stand change and block-on: negative when the stand changed after the aircraft
    /// blocked, empty when the stand never changed.
    /// </summary>
    private async Task<List<IReadOnlyList<OccReportCell>>> DailyCloseAsync(OperationRow[] operations, long[] ids,
        TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        var turnaroundIds = operations.Select(item => item.TurnaroundId).Distinct().ToArray();
        var legs = (await context.FlightLegs.AsNoTracking().Where(leg => turnaroundIds.Contains(leg.TurnaroundId))
                .Select(leg => new { leg.TurnaroundId, leg.Direction, leg.FlightNumber, leg.ScheduledAt, leg.ActualAt })
                .ToArrayAsync(cancellationToken))
            .ToLookup(leg => leg.TurnaroundId);
        var stands = (await (from assignment in context.Set<Elevant.Domain.Entities.Operations.StandAssignment>().AsNoTracking()
                             join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                             where turnaroundIds.Contains(assignment.TurnaroundId)
                             orderby assignment.AssignedFrom, assignment.Id
                             select new { assignment.TurnaroundId, stand.Code, assignment.AssignedFrom })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.TurnaroundId);
        var milestones = (await context.Set<Elevant.Domain.Entities.Operations.OperationMilestone>().AsNoTracking()
                .Where(item => ids.Contains(item.GroundOperationId) && item.ActualAt != null &&
                    (item.Code == "BLOCK_ON" || item.Code == "PUSHBACK"))
                .Select(item => new { item.GroundOperationId, item.Code, item.ActualAt }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId);
        var categories = await (from turnaround in context.Turnarounds.AsNoTracking()
                                join type in context.AircraftTypes.AsNoTracking() on turnaround.AircraftTypeId equals type.Id
                                where turnaroundIds.Contains(turnaround.Id)
                                select new { turnaround.Id, type.SizeCategory }).ToDictionaryAsync(item => item.Id,
            item => item.SizeCategory, cancellationToken);
        var allowances = await context.GroundTimeAllowances.AsNoTracking()
            .ToDictionaryAsync(item => item.SizeCategory, item => item.AllowedMinutes, cancellationToken);
        var incidents = (await context.Incidents.AsNoTracking().Where(item => ids.Contains(item.GroundOperationId))
                .Select(item => new { item.GroundOperationId, item.DelayCode }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId);
        return operations.Select(item =>
        {
            var arrival = legs[item.TurnaroundId].FirstOrDefault(leg => leg.Direction == FlightDirection.Arrival);
            var departure = legs[item.TurnaroundId].FirstOrDefault(leg => leg.Direction == FlightDirection.Departure);
            var history = stands[item.TurnaroundId].ToArray();
            var blockOn = milestones[item.Id].FirstOrDefault(mark => mark.Code == "BLOCK_ON")?.ActualAt ?? item.ActualStart;
            var pushback = milestones[item.Id].FirstOrDefault(mark => mark.Code == "PUSHBACK")?.ActualAt ?? item.ActualEnd;
            decimal? notice = history.Length > 1 && blockOn is { } blocked
                ? Math.Round((decimal)(blocked - history[^1].AssignedFrom).TotalMinutes, 0) : null;
            var ground = Elevant.Application.Operations.AutomaticSurchargePolicy.GroundMinutes(blockOn, pushback);
            int? allowed = categories.TryGetValue(item.TurnaroundId, out var category) && category is { } size &&
                allowances.TryGetValue(size, out var minutes) ? minutes : null;
            var reported = incidents[item.Id].ToArray();
            var delays = reported.Select(incident => incident.DelayCode).OfType<string>().Distinct().Order().ToArray();
            return (IReadOnlyList<OccReportCell>)
            [
                Text(Date(item.Date)), Text(item.Code), Text(item.Airline),
                Text(string.Join(" / ", new[] { arrival?.FlightNumber, departure?.FlightNumber }.OfType<string>())),
                Text(Time(arrival?.ScheduledAt, zone)), Text(Time(arrival?.ActualAt, zone)),
                Text(Time(departure?.ScheduledAt, zone)), Text(Time(pushback, zone)),
                Text(history.FirstOrDefault()?.Code ?? "—"), Text(history.LastOrDefault()?.Code ?? "—"),
                notice is { } value ? OccReportCell.Number(value) : Text("—"),
                ground is { } groundMinutes ? OccReportCell.Number(groundMinutes) : Text("—"),
                allowed is { } allowance ? OccReportCell.Number(allowance) : Text("—"),
                Text(delays.Length == 0 ? "—" : string.Join(", ", delays)),
                OccReportCell.Number(reported.Length),
                Text(OperationLabels.Status(item.Status)),
            ];
        }).ToList();
    }

    private static OccReportCell Text(string value) => new(value);

    private static decimal? Minutes(DateTimeOffset? start, DateTimeOffset? end) =>
        start is { } s && end is { } e && e >= s ? Math.Round((decimal)(e - s).TotalMinutes, 0) : null;

    private static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", Spanish);

    private static string Time(DateTimeOffset? value, TimeZoneInfo zone) =>
        value is { } instant ? TimeZoneInfo.ConvertTime(instant, zone).ToString("HH:mm", Spanish) : "—";

    private static string DateTime(DateTimeOffset value, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(value, zone).ToString("dd/MM/yyyy HH:mm", Spanish);
}
