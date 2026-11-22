using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// The workforce part of the catalog (part B): the history ramp agents (<c>HIST-RA-*</c>, never DEV-RA-001) with
/// their shifts, scopes, permits, qualifications and position coverages, rebuilt from the database with the rest of
/// the catalog. Empty until the <c>workforce</c> chunk has committed.
/// </summary>
internal sealed partial class HistoryCatalog
{
    public const string HistoryAgentPrefix = "HIST-RA-";

    private IReadOnlyList<HistoryAgent> _agents = [];
    private IReadOnlyList<HistoryCoverage> _coverages = [];
    private Dictionary<long, TerminalAnchor> _terminals = [];
    private long? _bridgeEquipmentTypeId;
    private long _stationId;

    /// <summary>History agents only (HIST-RA-*), ordered by employee number; never DEV-RA-001.</summary>
    public IReadOnlyList<HistoryAgent> Agents => _agents;

    /// <summary>Position coverages of the history agents (all released at the end of the shift), by start.</summary>
    public IReadOnlyList<HistoryCoverage> Coverages => _coverages;

    /// <summary>
    /// Agents with a shift that fully contains [<paramref name="from"/>, <paramref name="to"/>] on
    /// <paramref name="date"/>, whose PUJ station scope (and terminal scope, when <paramref name="terminalId"/> is
    /// given; plus a valid bridge qualification when that terminal requires it) is in force, with an airport permit
    /// and a ramp driver licence valid on that date. An agent with less than three months (junior) is only returned
    /// when a position coverage that names a mentor covers the window, as the OCC board requires. Deterministic
    /// order (employee number). The terminal filter checks the scope, not the shift's own terminal.
    /// </summary>
    public IReadOnlyList<HistoryAgent> EligibleAt(DateOnly date, DateTimeOffset from, DateTimeOffset to,
        long? terminalId = null)
    {
        TerminalAnchor? terminal = null;
        if (terminalId is { } id && !_terminals.TryGetValue(id, out terminal)) return [];
        var eligible = new List<HistoryAgent>();
        foreach (var agent in _agents)
        {
            if (!agent.Shifts.TryGetValue(date, out var shift) || shift.StartsAt > from || to > shift.EndsAt) continue;
            if (!agent.CanWork(_stationId, date)) continue;
            if (terminal is not null)
            {
                if (!agent.HasTerminalScope(terminal.Id, date)) continue;
                if (terminal.RequiresBridgeQualification &&
                    (_bridgeEquipmentTypeId is not { } bridge || !agent.HasQualification(bridge, date)))
                    continue;
            }
            if (agent.IsJuniorOn(date) && !_coverages.Any(coverage => coverage.RampAgentId == agent.RampAgentId &&
                    coverage.MentorRampAgentId is not null && coverage.StartsAt <= from && to <= coverage.EndsAt))
                continue;
            eligible.Add(agent);
        }
        return eligible;
    }

    /// <summary>The history agents a coverage assigns to <paramref name="standId"/> during the whole window.</summary>
    public IReadOnlyList<HistoryAgent> CoveringAgents(long standId, DateTimeOffset from, DateTimeOffset to)
    {
        var ids = _coverages.Where(coverage => coverage.StandIds.Contains(standId) && coverage.StartsAt <= from &&
                to <= coverage.EndsAt)
            .Select(coverage => coverage.RampAgentId).ToHashSet();
        return _agents.Where(agent => ids.Contains(agent.RampAgentId)).ToArray();
    }

    private async Task LoadWorkforceAsync(HistoryAnchors anchors, CancellationToken cancellationToken)
    {
        _stationId = anchors.Station.Id;
        _terminals = anchors.Terminals.ToDictionary(item => item.Id);
        _bridgeEquipmentTypeId = anchors.EquipmentTypes.TryGetValue(
            Elevant.Persistence.Operations.EfPositionCoverageStore.BridgeEquipmentTypeCode, out var bridge)
            ? bridge : null;
        var clock = new HistoryClock(anchors.Station.IanaTimeZone);

        var rows = await (from agent in _context.RampAgents.AsNoTracking()
                          join person in _context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                          where agent.EmployeeNumber.StartsWith(HistoryAgentPrefix)
                          orderby agent.EmployeeNumber
                          select new
                          {
                              agent.Id, agent.PublicId, agent.PersonId, agent.EmployeeNumber, agent.HireDate,
                              agent.IsActive, agent.SupervisorAgentId, person.FirstName, person.LastName,
                          }).ToArrayAsync(cancellationToken);
        if (rows.Length == 0)
        {
            _agents = [];
            _coverages = [];
            return;
        }
        var ids = rows.Select(row => row.Id).ToArray();
        var shifts = (await _context.ShiftAssignments.AsNoTracking().Where(item => ids.Contains(item.RampAgentId))
                .Select(item => new { item.Id, item.RampAgentId, item.WorkDate, item.StartsAtLocal, item.EndsAtLocal,
                    item.TerminalId })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId);
        var stationScopes = (await _context.Set<RampAgentStationScope>().AsNoTracking()
                .Where(item => ids.Contains(item.RampAgentId)).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId);
        var terminalScopes = (await _context.Set<RampAgentTerminalScope>().AsNoTracking()
                .Where(item => ids.Contains(item.RampAgentId)).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId);
        var permits = (await _context.AirportPermitCycles.AsNoTracking().Where(item => ids.Contains(item.RampAgentId))
                .Select(item => new { item.RampAgentId, item.DocumentType, item.IssuedOn, item.ExpiresOn, item.IsCurrent })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId);
        var qualifications = (await _context.QualificationCycles.AsNoTracking().Where(item => ids.Contains(item.RampAgentId))
                .Select(item => new { item.RampAgentId, item.EquipmentTypeId, item.ObtainedOn, item.ExpiresOn, item.IsCurrent })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.RampAgentId);
        var leftOn = (await _context.Employees.AsNoTracking()
                .Where(employee => employee.EmployeeNumber.StartsWith(HistoryAgentPrefix) && employee.TerminatedOn != null)
                .Select(employee => new { employee.EmployeeNumber, employee.TerminatedOn })
                .ToArrayAsync(cancellationToken))
            .ToDictionary(item => item.EmployeeNumber, item => item.TerminatedOn!.Value, StringComparer.Ordinal);

        _agents = rows.Select(row => new HistoryAgent(row.Id, row.PersonId, row.FirstName + " " + row.LastName,
                row.PublicId,
                shifts[row.Id].OrderBy(item => item.WorkDate).ToDictionary(item => item.WorkDate, item =>
                    new HistoryShift(item.WorkDate, clock.ToUtc(item.WorkDate, item.StartsAtLocal),
                        clock.ToUtc(item.EndsAtLocal <= item.StartsAtLocal ? item.WorkDate.AddDays(1) : item.WorkDate,
                            item.EndsAtLocal),
                        item.TerminalId, item.Id)))
            {
                EmployeeNumber = row.EmployeeNumber,
                HireDate = row.HireDate,
                IsActive = row.IsActive,
                SupervisorRampAgentId = row.SupervisorAgentId,
                LeftOn = leftOn.TryGetValue(row.EmployeeNumber, out var left) ? left : null,
                StationScopes = stationScopes[row.Id].Select(item => new HistoryScope(item.StationId, item.ValidFrom, item.ValidTo))
                    .ToArray(),
                TerminalScopes = terminalScopes[row.Id].Select(item => new HistoryScope(item.TerminalId, item.ValidFrom, item.ValidTo))
                    .ToArray(),
                Permits = permits[row.Id].Select(item => new HistoryDocument(item.DocumentType, null, item.IssuedOn,
                    item.ExpiresOn, item.IsCurrent)).ToArray(),
                Qualifications = qualifications[row.Id].Select(item => new HistoryDocument(null, item.EquipmentTypeId,
                    item.ObtainedOn, item.ExpiresOn, item.IsCurrent)).ToArray(),
            })
            .ToArray();

        var coverageRows = await _context.Set<PositionCoverage>().AsNoTracking()
            .Where(item => ids.Contains(item.RampAgentId))
            .OrderBy(item => item.StartsAt).ThenBy(item => item.Id)
            .Select(item => new { item.Id, item.RampAgentId, item.MentorRampAgentId, item.TerminalId, item.StartsAt,
                item.EndsAt, item.IsReinforcement })
            .ToArrayAsync(cancellationToken);
        var coverageIds = coverageRows.Select(item => item.Id).ToArray();
        var stands = new List<PositionCoverageStand>();
        foreach (var page in coverageIds.Chunk(1000))
            stands.AddRange(await _context.Set<PositionCoverageStand>().AsNoTracking()
                .Where(item => page.Contains(item.PositionCoverageId)).ToArrayAsync(cancellationToken));
        var standsOf = stands.ToLookup(item => item.PositionCoverageId, item => item.StandId);
        _coverages = coverageRows.Select(item => new HistoryCoverage(item.Id, item.RampAgentId, item.MentorRampAgentId,
            item.TerminalId, item.StartsAt, item.EndsAt, standsOf[item.Id].Order().ToArray(), item.IsReinforcement)).ToArray();
    }
}

/// <summary>A shift of a history agent: its local work date, UTC instants, terminal and row id.</summary>
internal sealed record HistoryShift(DateOnly WorkDate, DateTimeOffset StartsAt, DateTimeOffset EndsAt, long TerminalId,
    long ShiftAssignmentId);

/// <summary>A dated scope (station or terminal id) of an agent; <c>To</c> is inclusive, null is open.</summary>
internal sealed record HistoryScope(long TargetId, DateOnly From, DateOnly? To)
{
    public bool Covers(long targetId, DateOnly date) =>
        TargetId == targetId && From <= date && (To is null || date <= To);
}

/// <summary>
/// One cycle of a permit (<c>DocumentType</c>) or a qualification (<c>EquipmentTypeId</c>): valid from
/// <c>From</c> (issued or obtained) to <c>ExpiresOn</c>, both inclusive.
/// </summary>
internal sealed record HistoryDocument(string? DocumentType, long? EquipmentTypeId, DateOnly From, DateOnly ExpiresOn,
    bool IsCurrent)
{
    public bool ValidOn(DateOnly date) => From <= date && date <= ExpiresOn;
}

/// <summary>A history ramp agent with its shifts by work date (at most one a day).</summary>
internal sealed record HistoryAgent(long RampAgentId, long PersonId, string DisplayName, Guid PublicId,
    IReadOnlyDictionary<DateOnly, HistoryShift> Shifts)
{
    public string EmployeeNumber { get; init; } = string.Empty;

    public DateOnly HireDate { get; init; }

    /// <summary>False for the agents who left (2026-10-15).</summary>
    public bool IsActive { get; init; } = true;

    /// <summary>The mentor of a new hire (its ramp profile's supervisor), named on its coverages.</summary>
    public long? SupervisorRampAgentId { get; init; }

    /// <summary>The termination date of an agent who left; no shift on or after it.</summary>
    public DateOnly? LeftOn { get; init; }

    public IReadOnlyList<HistoryScope> StationScopes { get; init; } = [];

    public IReadOnlyList<HistoryScope> TerminalScopes { get; init; } = [];

    public IReadOnlyList<HistoryDocument> Permits { get; init; } = [];

    public IReadOnlyList<HistoryDocument> Qualifications { get; init; } = [];

    /// <summary>Less than three months since hiring (<see cref="PositionCoveragePolicy.IsJunior"/>): needs a mentor.</summary>
    public bool IsJuniorOn(DateOnly date) => PositionCoveragePolicy.IsJunior(HireDate, date);

    public bool HasPermit(string documentType, DateOnly date) =>
        Permits.Any(item => item.DocumentType == documentType && item.ValidOn(date));

    public bool HasQualification(long equipmentTypeId, DateOnly date) =>
        Qualifications.Any(item => item.EquipmentTypeId == equipmentTypeId && item.ValidOn(date));

    public bool HasTerminalScope(long terminalId, DateOnly date) =>
        TerminalScopes.Any(scope => scope.Covers(terminalId, date));

    /// <summary>Station scope in force, airport permit and ramp licence valid, and not gone.</summary>
    public bool CanWork(long stationId, DateOnly date) =>
        (LeftOn is null || date < LeftOn) && StationScopes.Any(scope => scope.Covers(stationId, date)) &&
        HasPermit(PermitDocumentTypes.AirportId, date) && HasPermit(PermitDocumentTypes.RampDriverLicense, date);
}

/// <summary>A position coverage of a history agent (released by OCC at its end).</summary>
internal sealed record HistoryCoverage(long Id, long RampAgentId, long? MentorRampAgentId, long TerminalId,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, IReadOnlyList<long> StandIds, bool IsReinforcement);
