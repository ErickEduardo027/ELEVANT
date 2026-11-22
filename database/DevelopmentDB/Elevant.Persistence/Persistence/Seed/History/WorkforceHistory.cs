using System.Globalization;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Part B (Gestión Humana). Chunk <c>workforce</c>: the history ramp agents <c>HIST-RA-001…</c> (person
/// <c>hist.agent.NN@dev.elevant.test</c>, employee «Agente de rampa» with its assignment and station, ramp profile,
/// PUJ station scope from 2026-05-01 and terminal scopes), their airport permits, ramp licences and equipment
/// qualifications (about 20 % renewed: cycle 1 superseded by a current cycle 2) and their 5×2 shifts, Morning
/// 06:00–14:00 or Afternoon 14:00–22:00. Three agents are hired in August and work beside a senior mentor (their
/// <c>SupervisorAgentId</c>), copying the mentor's shifts; two leave on 2026-10-15 and have no shift from that day.
/// The expiries, seen from 2026-11-22, are 70 % beyond 90 days, 15 % within 30, 5 % within 60 and 10 % already
/// expired; the expired ones belong to the agents who left or are equipment qualifications nobody needs to work,
/// so every shift has a valid airport permit and licence (and the bridge qualification in a bridge terminal).
/// Chunk <c>workforce:coverage</c>: OCC's position coverages of each shift (one stand each in a terminal with two
/// stands, all of them when one agent is alone), some reinforcements, the juniors on their mentor's stands with the
/// mentor named, all released by OCC at the end of the shift. Built from the catalog, so it covers exactly the
/// shifts that committed. Insert only; DEV-RA-001 is never touched.
/// </summary>
internal static class WorkforceHistory
{
    public const string ChunkName = "workforce";
    public const string CoverageChunkName = "workforce:coverage";

    /// <summary>The PUJ station scope of the agents hired before it starts here.</summary>
    public static readonly DateOnly StationScopeStart = new(2026, 5, 1);

    /// <summary>The day the leavers leave; their scopes end that day and they have no shift from it.</summary>
    public static readonly DateOnly LeaveDate = new(2026, 10, 15);

    /// <summary>The day the expiry distribution is measured from.</summary>
    public static readonly DateOnly ExpiryReference = new(2026, 11, 22);

    public static readonly TimeOnly MorningStart = new(6, 0);
    public static readonly TimeOnly MorningEnd = new(14, 0);
    public static readonly TimeOnly AfternoonStart = new(14, 0);
    public static readonly TimeOnly AfternoonEnd = new(22, 0);

    /// <summary>Chance that an experienced agent without a stand of their own reinforces a covered one.</summary>
    private const double ReinforcementChance = 0.15;

    private const string JobPositionName = "Agente de rampa";
    private const string GpuCode = "GPU";

    private static readonly string[] FirstNames =
    [
        "José", "María", "Luis", "Ana", "Carlos", "Yohanna", "Miguel", "Rosa", "Juan", "Carmen", "Pedro", "Altagracia",
        "Ramón", "Yesenia", "Francisco", "Mercedes", "Manuel", "Esther", "Rafael", "Paola", "Wilson", "Yudelka",
        "Héctor", "Indhira", "Félix", "Nathalie", "Darwin", "Leidy",
    ];

    private static readonly string[] LastNames =
    [
        "Rodríguez", "Pérez", "Martínez", "Santos", "Reyes", "Díaz", "Jiménez", "Hernández", "Peña", "Castillo",
        "Rosario", "Vásquez", "Ramírez", "Batista", "Guzmán", "Mejía", "De la Cruz", "Féliz", "Polanco", "Tavárez",
        "Almonte", "Encarnación", "Cabrera", "Báez", "Mateo", "Valdez", "Núñez",
    ];

    private static readonly string[] Instructors =
    [
        "Ing. Rafael Gómez", "Lic. Patricia Ureña", "Cap. Andrés Molina", "Ing. Carolina Brito", "Téc. Julio Severino",
    ];

    private static readonly string[] CertifyingEntities =
    [
        "Centro de Instrucción AVIAM PUJ", "Instituto Dominicano de Aviación Civil (IDAC)",
        "Escuela de Servicios Aeroportuarios del Este",
    ];

    private static readonly string[] LeaveReasons =
    [
        "Renuncia voluntaria: se traslada a otra provincia.",
        "Fin del contrato por tiempo determinado.",
    ];

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        yield return HistoryChunk.Create(ChunkName, RunAsync);
        yield return HistoryChunk.Create(CoverageChunkName, RunCoverageAsync);
    }

    private enum Expiry { Far, Within30, Within60, Expired }

    private sealed record Cycle(int Number, DateOnly Training, DateOnly From, DateOnly Expires);

    private sealed class DocumentPlan
    {
        public required AgentPlan Agent { get; init; }
        public string? PermitType { get; init; }
        public string? EquipmentCode { get; init; }
        public long? EquipmentTypeId { get; init; }
        public bool IsPermit => PermitType is not null;
        public string Name => PermitType ?? EquipmentCode!;
        public Expiry Bucket { get; set; } = Expiry.Far;
        public bool Renewed { get; set; }
        public List<Cycle> Cycles { get; } = [];
        public bool ValidOn(DateOnly date) => Cycles.Any(cycle => cycle.From <= date && date <= cycle.Expires);
    }

    private sealed class AgentPlan
    {
        public required int Index { get; init; }
        public required string Code { get; init; }
        public required string FirstName { get; init; }
        public required string LastName { get; init; }
        public required DateOnly HireDate { get; init; }
        public required bool IsJunior { get; init; }
        public required bool Leaves { get; init; }
        public required bool HasBridge { get; init; }
        public AgentPlan? Mentor { get; set; }
        public bool IsMentor { get; set; }
        public List<DocumentPlan> Documents { get; } = [];
        public DateOnly ScopeFrom => HireDate > StationScopeStart ? HireDate : StationScopeStart;
        public DateOnly FirstWorkDay => IsJunior ? HireDate.AddDays(7) : ScopeFrom;

        public bool DocumentValid(string name, DateOnly date) =>
            Documents.Any(document => document.Name == name && document.ValidOn(date));

        public bool CanWork(DateOnly date) =>
            date >= FirstWorkDay && (!Leaves || date < LeaveDate) &&
            DocumentValid(PermitDocumentTypes.AirportId, date) && DocumentValid(PermitDocumentTypes.RampDriverLicense, date);
    }

    private sealed record ShiftPlan(AgentPlan Agent, DateOnly Date, ShiftBlock Block, TerminalAnchor Terminal);

    /// <summary>New hires with a mentor and leavers: 3 and 2 in the plan, 1 and 1 in a small roster.</summary>
    private static (int Juniors, int Leavers) Shape(int agentCount) =>
        agentCount >= 20 ? (3, 2) : agentCount >= 4 ? (1, 1) : (0, 0);

    private static List<AgentPlan> Plan(DevelopmentHistoryOptions options, HistoryAnchors anchors)
    {
        var count = options.AgentCount;
        var (juniors, leavers) = Shape(count);
        var seniors = count - juniors - leavers;
        var agents = new List<AgentPlan>(count);
        var firstHire = new DateOnly(2025, 1, 6);
        var lastHire = new DateOnly(2026, 2, 27);
        for (var index = 1; index <= count; index++)
        {
            var code = string.Create(CultureInfo.InvariantCulture, $"{HistoryCatalog.HistoryAgentPrefix}{index:000}");
            var random = HistoryRandom.For($"hr:agent:{code}:hire");
            var isJunior = index > seniors + leavers;
            // The experienced agents were hired early enough to be past their three months on the first day.
            var hire = isJunior
                ? new DateOnly(2026, 8, 3).AddDays(random.Next(22))
                : firstHire.AddDays(random.Next(lastHire.DayNumber - firstHire.DayNumber + 1));
            agents.Add(new AgentPlan
            {
                Index = index, Code = code, FirstName = FirstNames[(index - 1) % FirstNames.Length],
                LastName = LastNames[(index - 1) * 5 % LastNames.Length], HireDate = hire, IsJunior = isJunior,
                Leaves = !isJunior && index > seniors,
                // 60 % of the experienced agents hold the boarding-bridge qualification; the new hires do not.
                HasBridge = !isJunior && (index % 5) is 0 or 1 or 3,
            });
        }
        // Junior k works beside senior k: their supervisor and the mentor the coverages name.
        var juniorList = agents.Where(agent => agent.IsJunior).ToArray();
        for (var k = 0; k < juniorList.Length; k++)
        {
            juniorList[k].Mentor = agents[k];
            agents[k].IsMentor = true;
        }

        var bridgeCode = EfPositionCoverageStore.BridgeEquipmentTypeCode;
        var others = anchors.EquipmentTypes.Keys.Where(code => code != GpuCode && code != bridgeCode)
            .Order(StringComparer.Ordinal).ToArray();
        foreach (var agent in agents)
        {
            agent.Documents.Add(new DocumentPlan { Agent = agent, PermitType = PermitDocumentTypes.AirportId });
            agent.Documents.Add(new DocumentPlan { Agent = agent, PermitType = PermitDocumentTypes.RampDriverLicense });
            if (anchors.EquipmentTypes.TryGetValue(GpuCode, out var gpu))
                agent.Documents.Add(new DocumentPlan { Agent = agent, EquipmentCode = GpuCode, EquipmentTypeId = gpu });
            if (agent.HasBridge && anchors.EquipmentTypes.TryGetValue(bridgeCode, out var bridge))
                agent.Documents.Add(new DocumentPlan { Agent = agent, EquipmentCode = bridgeCode, EquipmentTypeId = bridge });
            var extra = HistoryRandom.For($"hr:agent:{agent.Code}:equipment");
            foreach (var code in others)
                if (!agent.IsJunior && extra.Chance(0.5))
                    agent.Documents.Add(new DocumentPlan
                        { Agent = agent, EquipmentCode = code, EquipmentTypeId = anchors.EquipmentTypes[code] });
        }

        AssignBuckets(agents);
        foreach (var document in agents.SelectMany(agent => agent.Documents)) PlanCycles(document);
        return agents;
    }

    /// <summary>
    /// 10 % expired (first the leavers' documents, then qualifications of active seniors that no rule needs to
    /// work), about 20 % of the active seniors' other documents renewed, then 15 % within 30 days, 5 % within 60
    /// and the rest beyond 90 days.
    /// </summary>
    private static void AssignBuckets(List<AgentPlan> agents)
    {
        var documents = agents.SelectMany(agent => agent.Documents).ToArray();
        var total = documents.Length;
        var random = HistoryRandom.For("hr:documents:buckets");
        var bridgeCode = EfPositionCoverageStore.BridgeEquipmentTypeCode;
        var expiredTarget = (int)Math.Round(total * 0.10, MidpointRounding.AwayFromZero);
        var leaverDocuments = documents.Where(document => document.Agent.Leaves).ToArray();
        var optional = random.Shuffle(documents.Where(document => !document.Agent.Leaves && !document.Agent.IsJunior &&
            !document.IsPermit && document.EquipmentCode != bridgeCode));
        foreach (var document in leaverDocuments
                     .Concat(optional.Take(Math.Max(1, expiredTarget - leaverDocuments.Length))))
            document.Bucket = Expiry.Expired;

        foreach (var document in documents.Where(document => document.Bucket != Expiry.Expired &&
                     !document.Agent.Leaves && !document.Agent.IsJunior))
            document.Renewed = HistoryRandom.For($"hr:document:{document.Agent.Code}:{document.Name}:renewal").Chance(0.2);

        var rest = random.Shuffle(documents.Where(document => document.Bucket != Expiry.Expired));
        var within30 = (int)Math.Round(total * 0.15, MidpointRounding.AwayFromZero);
        var within60 = (int)Math.Round(total * 0.05, MidpointRounding.AwayFromZero);
        for (var index = 0; index < rest.Length; index++)
            rest[index].Bucket = index < within30 ? Expiry.Within30 : index < within30 + within60 ? Expiry.Within60 : Expiry.Far;
    }

    /// <summary>
    /// The cycles of one document, issued right after the hire. A renewal ends cycle 1 inside the window and starts
    /// cycle 2 up to two weeks before that end, so the document never lapses.
    /// </summary>
    private static void PlanCycles(DocumentPlan document)
    {
        var agent = document.Agent;
        var random = HistoryRandom.For($"hr:document:{agent.Code}:{document.Name}:cycles");
        var from = agent.IsJunior ? agent.HireDate.AddDays(1 + random.Next(4)) : agent.HireDate.AddDays(1 + random.Next(20));
        var training = from.AddDays(-(1 + random.Next(5)));
        if (document.Renewed)
        {
            var earliest = Max(new DateOnly(2026, 6, 10), from.AddDays(30));
            var latest = new DateOnly(2026, 11, 10);
            var firstEnd = earliest >= latest ? latest : earliest.AddDays(random.Next(latest.DayNumber - earliest.DayNumber + 1));
            document.Cycles.Add(new Cycle(1, training, from, firstEnd));
            var renewedFrom = Max(from.AddDays(1), firstEnd.AddDays(-random.Next(15)));
            var renewedTraining = renewedFrom.AddDays(-(1 + random.Next(4)));
            document.Cycles.Add(new Cycle(2, renewedTraining, renewedFrom, ExpiresOn(document, renewedFrom, random)));
            return;
        }
        document.Cycles.Add(new Cycle(1, training, from, ExpiresOn(document, from, random)));
    }

    private static DateOnly ExpiresOn(DocumentPlan document, DateOnly from, HistoryRandom random)
    {
        var expires = document.Bucket switch
        {
            Expiry.Within30 => ExpiryReference.AddDays(1 + random.Next(29)),
            Expiry.Within60 => ExpiryReference.AddDays(31 + random.Next(29)),
            // Already expired before the reference: after the leavers left, and late enough for the others that
            // nothing they needed lapsed in the middle of the window.
            Expiry.Expired => (document.Agent.Leaves ? new DateOnly(2026, 10, 16) : new DateOnly(2026, 10, 20))
                .AddDays(random.Next(document.Agent.Leaves ? 36 : 32)),
            _ => ExpiryReference.AddDays(91 + random.Next(500)),
        };
        return expires < from ? from : expires;
    }

    private static DateOnly Max(DateOnly left, DateOnly right) => left > right ? left : right;

    private static int IsoWeek(DateOnly date) => ISOWeek.GetWeekOfYear(date.ToDateTime(TimeOnly.MinValue));

    /// <summary>The 5×2 rotation: agent <c>i</c> rests two consecutive days, staggered by its index.</summary>
    private static bool OnRotation(AgentPlan agent, DateOnly date) =>
        (date.DayNumber + (agent.Index - 1) % 7) % 7 < 5;

    /// <summary>The block alternates every ISO week, half of the roster in each.</summary>
    private static ShiftBlock BlockOf(AgentPlan agent, DateOnly date) =>
        ((agent.Index - 1) + IsoWeek(date)) % 2 == 0 ? ShiftBlock.Morning : ShiftBlock.Afternoon;

    private static TerminalAnchor PrimaryTerminal(HistoryAnchors anchors) =>
        anchors.Terminals.FirstOrDefault(terminal => !terminal.RequiresBridgeQualification) ?? anchors.Terminals[0];

    private static List<ShiftPlan> Shifts(DevelopmentHistoryOptions options, HistoryAnchors anchors, List<AgentPlan> agents)
    {
        var primary = PrimaryTerminal(anchors);
        var bridgeTerminal = anchors.Terminals.FirstOrDefault(terminal => terminal.RequiresBridgeQualification &&
            terminal.Id != primary.Id);
        var bridgeCode = EfPositionCoverageStore.BridgeEquipmentTypeCode;
        var shifts = new List<ShiftPlan>();
        var byAgent = new Dictionary<(int, DateOnly), ShiftPlan>();
        foreach (var date in options.Days())
        {
            foreach (var agent in agents.Where(agent => !agent.IsJunior))
            {
                if (!agent.CanWork(date) || !OnRotation(agent, date)) continue;
                var terminal = primary;
                // The bridge-qualified agents work the bridge terminal about half of their weeks; mentors stay with
                // their new hire in the main terminal.
                if (bridgeTerminal is not null && !agent.IsMentor && agent.DocumentValid(bridgeCode, date) &&
                    HistoryRandom.For($"hr:terminal:{agent.Code}:{date.Year}-W{IsoWeek(date):00}").Chance(0.5))
                    terminal = bridgeTerminal;
                if (terminal.RequiresBridgeQualification && !agent.DocumentValid(bridgeCode, date)) continue;
                var shift = new ShiftPlan(agent, date, BlockOf(agent, date), terminal);
                shifts.Add(shift);
                byAgent[(agent.Index, date)] = shift;
            }
            // A new hire works the mentor's shift, in the mentor's terminal.
            foreach (var junior in agents.Where(agent => agent.IsJunior))
            {
                if (!junior.CanWork(date) || junior.Mentor is null ||
                    !byAgent.TryGetValue((junior.Mentor.Index, date), out var mentorShift))
                    continue;
                if (mentorShift.Terminal.RequiresBridgeQualification && !junior.DocumentValid(bridgeCode, date)) continue;
                shifts.Add(mentorShift with { Agent = junior });
            }
        }
        return shifts;
    }

    private static async Task RunAsync(HistoryChunkContext chunk, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var anchors = chunk.Anchors;
        var clock = chunk.Clock;
        var hr = anchors.HumanResources.Id;
        var jobPosition = await db.JobPositions.AsNoTracking()
            .Where(item => item.Department == Department.Operations && item.Name == JobPositionName && item.IsRampPosition)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken) ??
            throw new InvalidOperationException($"The Development history needs the job position «{JobPositionName}».");
        var agents = Plan(chunk.Options, anchors);
        var hired = agents.ToDictionary(agent => agent.Index,
            agent => clock.At(agent.HireDate, new TimeOnly(9, agent.Index % 60)));
        var left = agents.Where(agent => agent.Leaves)
            .ToDictionary(agent => agent.Index, agent => clock.At(LeaveDate, new TimeOnly(16, agent.Index % 60)));

        // Layer 1: persons.
        var persons = agents.ToDictionary(agent => agent.Index, agent => HistoryChunkContext.Stamp(new Person
        {
            FirstName = agent.FirstName, LastName = agent.LastName,
            PrimaryEmail = string.Create(CultureInfo.InvariantCulture, $"hist.agent.{agent.Index:00}@dev.elevant.test"),
            IdentificationType = "Synthetic",
            IdentificationNumber = string.Create(CultureInfo.InvariantCulture, $"HIST-AGENT-{agent.Index:000}"),
        }, $"person:{agent.Code}", hired[agent.Index]));
        await chunk.InsertAsync(agents.Select(agent => (object)persons[agent.Index]), cancellationToken);

        // Layer 2: employees and the ramp profiles of the experienced agents (the mentors of layer 3).
        var employees = agents.ToDictionary(agent => agent.Index, agent => HistoryChunkContext.Stamp(new Employee
        {
            PersonId = persons[agent.Index].Id, EmployeeNumber = agent.Code, Department = Department.Operations,
            JobPositionId = jobPosition, HireDate = agent.HireDate,
            Status = agent.Leaves ? EmployeeStatus.Terminated : EmployeeStatus.Active,
            TerminatedOn = agent.Leaves ? LeaveDate : null,
            TerminationReason = agent.Leaves ? LeaveReasons[(agent.Index - 1) % LeaveReasons.Length] : null,
            TerminatedByAccountId = agent.Leaves ? hr : null,
            CreatedByAccountId = hr,
        }, $"employee:{agent.Code}", hired[agent.Index], agent.Leaves ? left[agent.Index] : hired[agent.Index]));
        var profiles = new Dictionary<int, RampAgent>();
        RampAgent Profile(AgentPlan agent) => profiles[agent.Index] = HistoryChunkContext.Stamp(new RampAgent
        {
            PersonId = persons[agent.Index].Id, EmployeeNumber = agent.Code, Category = JobPositionName,
            HireDate = agent.HireDate, IsActive = !agent.Leaves,
            SupervisorAgentId = agent.Mentor is { } mentor ? profiles[mentor.Index].Id : null,
        }, $"ramp-agent:{agent.Code}", hired[agent.Index], agent.Leaves ? left[agent.Index] : hired[agent.Index]);
        await chunk.InsertAsync(agents.Select(agent => (object)employees[agent.Index])
            .Concat(agents.Where(agent => !agent.IsJunior).Select(Profile)).ToArray(), cancellationToken);

        // Layer 3: the new hires' profiles (their supervisor is the mentor), assignments and stations.
        await chunk.InsertAsync(agents.Where(agent => agent.IsJunior).Select(agent => (object)Profile(agent))
            .Concat(agents.SelectMany(agent => new object[]
            {
                new EmployeeAssignment
                {
                    EmployeeId = employees[agent.Index].Id, Department = Department.Operations, JobPositionId = jobPosition,
                    ValidFrom = hired[agent.Index], ValidTo = agent.Leaves ? left[agent.Index] : null,
                    ChangedByAccountId = hr, Reason = "Alta de agente de rampa (historial de Development)",
                },
                new EmployeeStation
                {
                    EmployeeId = employees[agent.Index].Id, StationId = anchors.Station.Id, ValidFrom = agent.HireDate,
                    ValidTo = agent.Leaves ? LeaveDate : null,
                },
            })).ToArray(), cancellationToken);

        // Layer 4: scopes, first cycles of permits and qualifications, and the shifts.
        var primary = PrimaryTerminal(anchors);
        var layer4 = new List<object>();
        var firstCycles = new Dictionary<DocumentPlan, object>();
        foreach (var agent in agents)
        {
            var agentId = profiles[agent.Index].Id;
            DateOnly? scopeTo = agent.Leaves ? LeaveDate : null;
            layer4.Add(new RampAgentStationScope
                { RampAgentId = agentId, StationId = anchors.Station.Id, ValidFrom = agent.ScopeFrom, ValidTo = scopeTo });
            foreach (var terminal in anchors.Terminals)
                if (terminal.Id == primary.Id || terminal.RequiresBridgeQualification && agent.HasBridge)
                    layer4.Add(new RampAgentTerminalScope
                        { RampAgentId = agentId, TerminalId = terminal.Id, ValidFrom = agent.ScopeFrom, ValidTo = scopeTo });
            foreach (var document in agent.Documents)
            {
                var row = CycleRow(document, document.Cycles[0], agentId, null, clock);
                firstCycles[document] = row;
                layer4.Add(row);
            }
        }
        foreach (var shift in Shifts(chunk.Options, anchors, agents))
        {
            // Gestión Humana publishes the week's roster the Thursday before.
            var monday = shift.Date.AddDays(-(((int)shift.Date.DayOfWeek + 6) % 7));
            var published = clock.At(monday.AddDays(-4), new TimeOnly(10, shift.Agent.Index % 60));
            var morning = shift.Block == ShiftBlock.Morning;
            layer4.Add(HistoryChunkContext.Stamp(new ShiftAssignment
            {
                RampAgentId = profiles[shift.Agent.Index].Id, StationId = anchors.Station.Id, TerminalId = shift.Terminal.Id,
                OperationalPositionId = anchors.RampAgentPositionId, WorkDate = shift.Date,
                StartsAtLocal = morning ? MorningStart : AfternoonStart, EndsAtLocal = morning ? MorningEnd : AfternoonEnd,
                Block = shift.Block,
            }, string.Create(CultureInfo.InvariantCulture, $"shift:{shift.Agent.Code}:{shift.Date:yyyy-MM-dd}"), published));
        }
        await chunk.InsertAsync(layer4, cancellationToken);

        // Layer 5: the renewals, each superseding its first cycle (which stays as history, no longer current).
        var renewals = new List<object>();
        foreach (var document in agents.SelectMany(agent => agent.Documents).Where(document => document.Cycles.Count > 1))
        {
            var supersedes = firstCycles[document] switch
            {
                AirportPermitCycle permit => permit.Id,
                QualificationCycle qualification => qualification.Id,
                _ => throw new InvalidOperationException("Unknown document cycle."),
            };
            renewals.Add(CycleRow(document, document.Cycles[1], profiles[document.Agent.Index].Id, supersedes, clock));
        }
        await chunk.InsertAsync(renewals, cancellationToken);
    }

    private static object CycleRow(DocumentPlan document, Cycle cycle, long agentId, long? supersedes, HistoryClock clock)
    {
        var agent = document.Agent;
        var current = cycle.Number == document.Cycles.Count;
        var key = $"{(document.IsPermit ? "permit" : "qualification")}:{agent.Code}:{document.Name}:{cycle.Number}";
        var created = clock.At(cycle.From, new TimeOnly(10 + cycle.Number, agent.Index % 60));
        // A superseded cycle last changed when its renewal was registered.
        var updated = current ? created
            : clock.At(document.Cycles[cycle.Number].From, new TimeOnly(11 + cycle.Number, agent.Index % 60));
        if (document.IsPermit)
        {
            var prefix = document.PermitType == PermitDocumentTypes.AirportId ? "CA-PUJ" : "LCR-PUJ";
            return HistoryChunkContext.Stamp(new AirportPermitCycle
            {
                RampAgentId = agentId, DocumentType = document.PermitType!, CycleNumber = cycle.Number,
                DocumentNumber = string.Create(CultureInfo.InvariantCulture, $"{prefix}-H{agent.Index:000}-{cycle.Number}"),
                IssuedOn = cycle.From, ExpiresOn = cycle.Expires, SupersedesPermitId = supersedes, IsCurrent = current,
            }, key, created, updated);
        }
        var random = HistoryRandom.For($"hr:document:{agent.Code}:{document.Name}:{cycle.Number}:issuer");
        return HistoryChunkContext.Stamp(new QualificationCycle
        {
            RampAgentId = agentId, EquipmentTypeId = document.EquipmentTypeId!.Value, CycleNumber = cycle.Number,
            TrainingDate = cycle.Training, ObtainedOn = cycle.From, ExpiresOn = cycle.Expires,
            CertifyingEntity = random.Pick(CertifyingEntities), InstructorName = random.Pick(Instructors),
            Notes = cycle.Number > 1 ? "Renovación del ciclo anterior." : null,
            SupersedesQualificationId = supersedes, IsCurrent = current,
        }, key, created, updated);
    }

    /// <summary>
    /// OCC's coverages of each day, terminal and block, from the shifts the catalog read back: the experienced agents
    /// split the terminal's stands (the mentors first, one stand each; one agent alone takes them all, at most two),
    /// some of the rest reinforce a covered stand, and each junior covers the mentor's stands with the mentor named.
    /// All are assigned a few hours before the shift and released by OCC when it ends.
    /// </summary>
    private static async Task RunCoverageAsync(HistoryChunkContext chunk, CancellationToken cancellationToken)
    {
        var anchors = chunk.Anchors;
        var clock = chunk.Clock;
        var occ = anchors.Occ.Id;
        var terminals = anchors.Terminals.ToDictionary(terminal => terminal.Id);
        var stands = anchors.Stands.Where(stand => stand.TerminalId is not null).ToLookup(stand => stand.TerminalId!.Value);
        var coverages = new List<(PositionCoverage Coverage, IReadOnlyList<long> Stands)>();
        foreach (var date in chunk.Options.Days())
        {
            var groups = chunk.Catalog.Agents
                .Where(agent => agent.Shifts.ContainsKey(date))
                .Select(agent => (Agent: agent, Shift: agent.Shifts[date]))
                .Where(item => terminals.ContainsKey(item.Shift.TerminalId))
                .GroupBy(item => (item.Shift.TerminalId, item.Shift.StartsAt))
                .OrderBy(group => group.Key.StartsAt)
                .ThenBy(group => terminals[group.Key.TerminalId].Code, StringComparer.Ordinal);
            foreach (var group in groups)
            {
                var terminal = terminals[group.Key.TerminalId];
                var terminalStands = stands[terminal.Id].OrderBy(stand => stand.Code, StringComparer.Ordinal).ToArray();
                if (terminalStands.Length == 0) continue;
                // Never more than two stands: a third needs a vehicle and a driving licence check.
                var maxStands = Math.Min(terminal.MaxStandsPerAgent ?? 3, 2);
                var morning = clock.LocalTime(group.Key.StartsAt) < AfternoonStart;
                var random = HistoryRandom.For(
                    $"hr:coverage:{date:yyyy-MM-dd}:{terminal.Code}:{(morning ? "AM" : "PM")}");
                // Morning coverages are assigned the evening before; afternoon ones the same morning.
                var assignedAt = morning
                    ? clock.At(date.AddDays(-1), 19 * 60 + random.Next(150))
                    : clock.At(date, 10 * 60 + random.Next(180));
                var members = group.OrderBy(item => item.Agent.EmployeeNumber, StringComparer.Ordinal).ToArray();
                var juniors = members.Where(item => item.Agent.IsJuniorOn(date)).ToArray();
                var mentorIds = juniors.Select(item => item.Agent.SupervisorRampAgentId).OfType<long>().ToHashSet();
                var seniors = random.Shuffle(members.Where(item => !item.Agent.IsJuniorOn(date)))
                    .OrderBy(item => mentorIds.Contains(item.Agent.RampAgentId) ? 0 : 1).ToArray();
                var primaries = Math.Min(seniors.Length, terminalStands.Length);
                var covered = new Dictionary<long, (PositionCoverage Coverage, IReadOnlyList<long> Stands)>();
                for (var index = 0; index < seniors.Length; index++)
                {
                    var (agent, shift) = seniors[index];
                    long[] own;
                    var reinforcement = false;
                    if (index < primaries)
                        own = terminalStands.Where((_, position) => position % primaries == index).Take(maxStands)
                            .Select(stand => stand.Id).ToArray();
                    else if (random.Chance(ReinforcementChance))
                    {
                        own = [random.Pick(terminalStands).Id];
                        reinforcement = true;
                    }
                    else continue;
                    var coverage = Coverage(agent, shift, null, reinforcement, assignedAt.AddMinutes(2 * index), occ,
                        anchors.Station.Id, terminal.Id, date);
                    coverages.Add((coverage, own));
                    covered[agent.RampAgentId] = (coverage, own);
                }
                foreach (var (junior, shift) in juniors)
                {
                    if (junior.SupervisorRampAgentId is not { } mentorId || !covered.TryGetValue(mentorId, out var mentor))
                        continue;
                    coverages.Add((Coverage(junior, shift, mentorId, false, mentor.Coverage.CreatedAt.AddMinutes(1), occ,
                        anchors.Station.Id, terminal.Id, date), mentor.Stands));
                }
            }
        }

        await chunk.InsertAsync(coverages.Select(item => (object)item.Coverage).ToArray(), cancellationToken);
        await chunk.InsertAsync(coverages.SelectMany(item => item.Stands.Select(stand => (object)new PositionCoverageStand
            { PositionCoverageId = item.Coverage.Id, StandId = stand })).ToArray(), cancellationToken);
    }

    private static PositionCoverage Coverage(HistoryAgent agent, HistoryShift shift, long? mentorId, bool reinforcement,
        DateTimeOffset assignedAt, long occ, long stationId, long terminalId, DateOnly date) =>
        HistoryChunkContext.Stamp(new PositionCoverage
        {
            StationId = stationId, TerminalId = terminalId, RampAgentId = agent.RampAgentId, MentorRampAgentId = mentorId,
            IsReinforcement = reinforcement, StartsAt = shift.StartsAt, EndsAt = shift.EndsAt, ReleasedAt = shift.EndsAt,
            AssignedByAccountId = occ, ReleasedByAccountId = occ,
        }, string.Create(CultureInfo.InvariantCulture, $"coverage:{agent.EmployeeNumber}:{date:yyyy-MM-dd}"),
            assignedAt, shift.EndsAt);
}
