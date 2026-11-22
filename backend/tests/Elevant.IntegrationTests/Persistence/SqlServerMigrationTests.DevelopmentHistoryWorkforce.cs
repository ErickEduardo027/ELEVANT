using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence.Seed.History;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Part B of the Development history (Gestión Humana): agents, documents, 5×2 shifts and OCC coverages, run under
/// the seeder's grants with the small options, read back through the catalog and the HR and OCC report stores.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private sealed class WorkforceHistoryClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public async Task DevelopmentHistoryWorkforceSchedulesValidAgentsAndFeedsTheHumanResourcesAndCoverageReports()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        // «Today» of the reports is the day after the window: 2026-11-22, 09:00 at PUJ.
        await using var provider = await SeededFinanceProviderAsync(database, ct,
            new WorkforceHistoryClock(new DateTimeOffset(2026, 11, 22, 13, 0, 0, TimeSpan.Zero)));
        var options = DevelopmentHistoryOptions.Small;
        var ran = await SeedHistoryAsSeederAsync(database, options, ct);
        Assert.Contains(WorkforceHistory.ChunkName, ran);
        Assert.Contains(WorkforceHistory.CoverageChunkName, ran);

        await using var db = CreateContext(database.ConnectionString);
        var anchors = await HistoryAnchors.LoadAsync(db, ct);
        var catalog = await HistoryCatalog.LoadAsync(db, anchors, ct);
        var clock = new HistoryClock(anchors.Station.IanaTimeZone);
        var agents = catalog.Agents;
        Assert.Equal(options.AgentCount, agents.Count);
        Assert.All(agents, agent => Assert.StartsWith(HistoryCatalog.HistoryAgentPrefix, agent.EmployeeNumber, StringComparison.Ordinal));
        Assert.DoesNotContain(agents, agent => agent.RampAgentId == anchors.BaseRampAgentId);
        Assert.Equal(agents.Select(agent => agent.EmployeeNumber).Order(StringComparer.Ordinal),
            agents.Select(agent => agent.EmployeeNumber));
        Assert.Single(agents, agent => agent.LeftOn == WorkforceHistory.LeaveDate && !agent.IsActive);
        var junior = Assert.Single(agents, agent => agent.SupervisorRampAgentId is not null);
        Assert.Equal(8, junior.HireDate.Month);
        Assert.Equal(options.AgentCount, await db.Employees.CountAsync(item =>
            item.EmployeeNumber.StartsWith(HistoryCatalog.HistoryAgentPrefix), ct));
        Assert.Equal(options.AgentCount, await db.Persons.CountAsync(item =>
            item.PrimaryEmail!.StartsWith("hist.agent.") && item.PrimaryEmail.EndsWith("@dev.elevant.test"), ct));

        // Shifts: one per agent and day, 06–14 or 14–22, 5×2, only where the agent may work; never DEV-RA-001.
        var ids = agents.Select(agent => agent.RampAgentId).ToArray();
        var shifts = await db.ShiftAssignments.AsNoTracking().Where(item => ids.Contains(item.RampAgentId)).ToArrayAsync(ct);
        Assert.NotEmpty(shifts);
        Assert.Equal(shifts.Length, shifts.Select(item => (item.RampAgentId, item.WorkDate)).Distinct().Count());
        Assert.All(shifts, shift =>
        {
            Assert.InRange(shift.WorkDate, options.WindowStart, options.WindowEnd);
            Assert.True(shift.Block == ShiftBlock.Morning
                ? shift.StartsAtLocal == new TimeOnly(6, 0) && shift.EndsAtLocal == new TimeOnly(14, 0)
                : shift.StartsAtLocal == new TimeOnly(14, 0) && shift.EndsAtLocal == new TimeOnly(22, 0));
            Assert.True(clock.IsOperatingTime(shift.CreatedAt), $"{shift.CreatedAt:O}");
        });
        foreach (var agent in agents)
        {
            Assert.True(agent.Shifts.Count <= (options.WindowEnd.DayNumber - options.WindowStart.DayNumber + 1) * 5 / 7 + 2);
            foreach (var shift in agent.Shifts.Values)
            {
                Assert.True(agent.CanWork(anchors.Station.Id, shift.WorkDate), $"{agent.EmployeeNumber} {shift.WorkDate}");
                Assert.True(agent.HasTerminalScope(shift.TerminalId, shift.WorkDate));
            }
        }

        // Documents: one current cycle per agent and type, renewals supersede, dates in order, all instants by day.
        var cycles = await db.QualificationCycles.AsNoTracking().Where(item => ids.Contains(item.RampAgentId)).ToArrayAsync(ct);
        var permits = await db.AirportPermitCycles.AsNoTracking().Where(item => ids.Contains(item.RampAgentId)).ToArrayAsync(ct);
        Assert.All(cycles.GroupBy(item => (item.RampAgentId, item.EquipmentTypeId)), group => Assert.Single(group, item => item.IsCurrent));
        Assert.All(permits.GroupBy(item => (item.RampAgentId, item.DocumentType)), group => Assert.Single(group, item => item.IsCurrent));
        Assert.All(agents, agent => Assert.Contains(permits, item => item.RampAgentId == agent.RampAgentId &&
            item.DocumentType == PermitDocumentTypes.AirportId));
        Assert.All(agents, agent => Assert.Contains(permits, item => item.RampAgentId == agent.RampAgentId &&
            item.DocumentType == PermitDocumentTypes.RampDriverLicense));
        Assert.All(cycles, item => Assert.True(item.TrainingDate <= item.ObtainedOn && item.ObtainedOn <= item.ExpiresOn));
        Assert.All(cycles.Where(item => item.CycleNumber > 1), item => Assert.NotNull(item.SupersedesQualificationId));
        Assert.All(permits.Where(item => item.CycleNumber > 1), item => Assert.NotNull(item.SupersedesPermitId));
        Assert.Contains(cycles.Concat<object>(permits), item => item is Elevant.Domain.Entities.Workforce.QualificationCycle
            { CycleNumber: 2 } or Elevant.Domain.Entities.Workforce.AirportPermitCycle { CycleNumber: 2 });
        Assert.All(cycles.Select(item => item.CreatedAt).Concat(permits.Select(item => item.CreatedAt)),
            at => Assert.True(clock.IsOperatingTime(at), $"{at:O}"));
        var reference = WorkforceHistory.ExpiryReference;
        var current = cycles.Where(item => item.IsCurrent).Select(item => item.ExpiresOn)
            .Concat(permits.Where(item => item.IsCurrent).Select(item => item.ExpiresOn)).ToArray();
        Assert.Contains(current, day => day < reference);
        Assert.Contains(current, day => day >= reference && day <= reference.AddDays(30));
        Assert.Contains(current, day => day > reference.AddDays(90));

        // Coverages: inside the shift and the operating day, released by OCC at the end, stands of the terminal,
        // juniors with their mentor on the mentor's stands, never a stand taken twice outside reinforcement.
        var coverages = catalog.Coverages;
        Assert.NotEmpty(coverages);
        var coverageRows = await db.Set<PositionCoverage>().AsNoTracking().Where(item => ids.Contains(item.RampAgentId))
            .ToArrayAsync(ct);
        Assert.Equal(coverages.Count, coverageRows.Length);
        Assert.All(coverageRows, row =>
        {
            foreach (var at in new[] { row.StartsAt, row.EndsAt, row.CreatedAt, row.ReleasedAt!.Value })
                Assert.True(clock.IsOperatingTime(at), $"{at:O}");
            Assert.True(row.CreatedAt < row.StartsAt && row.EndsAt == row.ReleasedAt);
            Assert.Equal(anchors.Occ.Id, row.AssignedByAccountId);
            Assert.Equal(anchors.Occ.Id, row.ReleasedByAccountId);
        });
        var byId = agents.ToDictionary(agent => agent.RampAgentId);
        var standTerminal = anchors.Stands.ToDictionary(stand => stand.Id, stand => stand.TerminalId);
        foreach (var coverage in coverages)
        {
            var agent = byId[coverage.RampAgentId];
            var shift = agent.Shifts[clock.LocalDate(coverage.StartsAt)];
            Assert.Equal((shift.StartsAt, shift.EndsAt, shift.TerminalId), (coverage.StartsAt, coverage.EndsAt, coverage.TerminalId));
            Assert.InRange(coverage.StandIds.Count, 1, 2);
            Assert.All(coverage.StandIds, stand => Assert.Equal(coverage.TerminalId, standTerminal[stand]));
            if (agent.IsJuniorOn(shift.WorkDate))
            {
                Assert.Equal(agent.SupervisorRampAgentId, coverage.MentorRampAgentId);
                Assert.Contains(coverages, other => other.RampAgentId == coverage.MentorRampAgentId &&
                    other.StartsAt == coverage.StartsAt && other.StandIds.SequenceEqual(coverage.StandIds));
            }
            else Assert.Null(coverage.MentorRampAgentId);
        }
        Assert.All(coverages.Where(item => !item.IsReinforcement && item.MentorRampAgentId is null)
                .SelectMany(item => item.StandIds.Select(stand => (stand, item.StartsAt)))
                .GroupBy(item => item),
            group => Assert.Single(group));

        // EligibleAt: typical windows of each block have at least two agents, all of them able to work.
        foreach (var day in options.Days())
        {
            foreach (var (from, to) in new[] { (new TimeOnly(8, 0), new TimeOnly(9, 30)), (new TimeOnly(16, 0), new TimeOnly(17, 30)) })
            {
                var eligible = catalog.EligibleAt(day, clock.At(day, from), clock.At(day, to));
                Assert.True(eligible.Count >= 2, $"{day} {from}: {eligible.Count} agents.");
                Assert.All(eligible, agent => Assert.True(agent.CanWork(anchors.Station.Id, day)));
                Assert.Equal(eligible.Select(agent => agent.EmployeeNumber).Order(StringComparer.Ordinal),
                    eligible.Select(agent => agent.EmployeeNumber));
            }
            var bridge = anchors.Terminals.FirstOrDefault(terminal => terminal.RequiresBridgeQualification);
            if (bridge is not null)
                Assert.All(catalog.EligibleAt(day, clock.At(day, new TimeOnly(8, 0)), clock.At(day, new TimeOnly(9, 0)), bridge.Id),
                    agent => Assert.True(agent.HasTerminalScope(bridge.Id, day)));
            Assert.Empty(catalog.EligibleAt(day, clock.At(day, new TimeOnly(13, 0)), clock.At(day, new TimeOnly(15, 0))));
        }

        // The Gestión Humana reports.
        await using var scope = provider.CreateAsyncScope();
        var hr = scope.ServiceProvider.GetRequiredService<IHumanResourcesReportStore>();
        var hrAccount = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var station = anchors.Station.PublicId;
        var expirations = await hr.ListExpirationsAsync(hrAccount, station, new DateOnly(2026, 10, 1),
            new DateOnly(2027, 9, 30), 1, 100, cancellationToken: ct);
        Assert.Null(expirations.Failure);
        Assert.Contains(expirations.Page!.Rows, row => row.EmployeeNumber.StartsWith(HistoryCatalog.HistoryAgentPrefix, StringComparison.Ordinal));
        var expired = await hr.ListExpirationsAsync(hrAccount, station, new DateOnly(2026, 10, 1),
            new DateOnly(2027, 9, 30), 1, 100, validity: "Expired", cancellationToken: ct);
        Assert.Contains(expired.Page!.Rows, row => row.EmployeeNumber.StartsWith(HistoryCatalog.HistoryAgentPrefix, StringComparison.Ordinal));
        var distribution = await hr.ListStaffDistributionAsync(hrAccount, station, options.WindowStart, options.WindowEnd,
            1, 100, ct);
        Assert.Null(distribution.Failure);
        Assert.Contains(distribution.Page!.Rows, row => row.EmployeeNumber.StartsWith(HistoryCatalog.HistoryAgentPrefix, StringComparison.Ordinal));
        var qualification = await hr.ListQualificationCoverageAsync(hrAccount, station, options.WindowStart,
            options.WindowEnd, 1, 20, ct);
        Assert.Null(qualification.Failure);
        Assert.True(Assert.Single(qualification.Page!.Rows, row => row.EquipmentCode == "GPU").EligibleAgents >=
            options.AgentCount - 1);

        // OCC's «Asignaciones de cobertura» lists them, released by OCC.
        var occ = scope.ServiceProvider.GetRequiredService<IOccReportStore>();
        var report = await occ.ReadAsync(Guid.Parse("40000000-0000-7000-8000-000000000001"),
            OccReportKind.CoverageAssignments, station, options.WindowStart, options.WindowEnd, 1, 1000,
            OccReportFilters.None, ct);
        Assert.Null(report.Failure);
        Assert.True(report.Table!.Rows.Count >= coverages.Count, $"{report.Table.Rows.Count} coverage rows.");

        // A second run is the fast path: nothing is written.
        var counts = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Assert.Empty(await SeedHistoryAsSeederAsync(database, options, ct));
        Assert.Equal(counts, await HistoryTableCountsAsync(database.ConnectionString, ct));
    }
}
