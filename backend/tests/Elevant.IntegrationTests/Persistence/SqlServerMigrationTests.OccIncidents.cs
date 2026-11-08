using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// 3-G: OCC follows the live incidents of an operation of its stations, reports its own and moves them with a note and
/// a history; the tablet keeps reading the same keys and sees what OCC reported.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task OccManagesTheIncidentsOfAnOperationWithNotesAndHistory()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000e1", ct);
        // The operation is running: the agent started it twenty minutes ago.
        var now = DateTimeOffset.UtcNow;
        var startedAt = Truncate(now.AddMinutes(-20));
        long operationInternalId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == TimingOperation, ct);
            operationInternalId = operation.Id;
            operation.CurrentStatus = GroundOperationStatus.InProgress;
            operation.ActualStartAt = startedAt;
            operation.ActualEndAt = null;
            var turnaround = await setup.Turnarounds.SingleAsync(item => item.Id == operation.TurnaroundId, ct);
            turnaround.CurrentStatus = TurnaroundStatus.InProgress;
            var arrival = await setup.FlightLegs.SingleAsync(leg => leg.TurnaroundId == turnaround.Id &&
                leg.Direction == FlightDirection.Arrival, ct);
            arrival.ActualAt = startedAt.AddMinutes(-10);
            await setup.SaveChangesAsync(ct);
        }
        IOccIncidentStore Incidents(IServiceProvider services) => services.GetRequiredService<IOccIncidentStore>();

        // 1. The tablet reports one: its report is the first step of the history OCC reads.
        var tabletKey = Guid.NewGuid();
        var tablet = await Run(services => services.GetRequiredService<IRampIncidentStore>().ReportAsync(
            new RampIncidentWriteRequest(TimingAgent, [TimingStation], TimingOperation, "Safety", IncidentSeverity.High,
                "Derrame de combustible en la posición", now.AddMinutes(-5), installation, tabletKey, Guid.NewGuid(),
                "incident-tablet"), ct));
        Assert.True(tablet.IsSuccess, tablet.Failure?.ToString());
        var list = await Run(services => Incidents(services).ListAsync(TimingOcc, TimingOperation, ct));
        var fromTablet = Assert.Single(list.Value!.Incidents);
        Assert.Equal(("Agent", "Open", true), (fromTablet.ReportedByKind, fromTablet.Status, list.Value.CanReport));
        Assert.Equal(["InReview", "Resolved"], fromTablet.AllowedStatuses);
        Assert.Equal(EfOccIncidentStore.RampReportedNote, Assert.Single(fromTablet.History).Note);
        Assert.Equal("not_found", (await Run(services => Incidents(services).ListAsync(TimingOcc, Guid.NewGuid(), ct))).Code);
        Assert.Equal("forbidden", (await Run(services => Incidents(services).ListAsync(TimingAgent, TimingOperation, ct))).Code);

        // 2. OCC reports its own, in the station's time converted to UTC: idempotent with its key, never in the future.
        Task<MasterDataResult<OccIncidentData>> Report(Guid? key, string type, string description, DateTimeOffset at,
            string? delayCode = null) =>
            Run(services => Incidents(services).ReportAsync(TimingOcc, TimingOperation,
                new OccIncidentReportInput(type, "Medium", description, at, delayCode), key, ct));
        Assert.Equal("idempotency_key_required", (await Report(null, "Operational", "Demora del equipaje", now)).Code);
        Assert.Equal(OccIncidentCodes.ReportInvalid, (await Report(Guid.NewGuid(), "Weather", "Lluvia sobre la plataforma",
            now)).Code);
        Assert.Equal(OccIncidentCodes.ReportInvalid, (await Report(Guid.NewGuid(), "Deviation", "Demora por la torre",
            now)).Code);
        Assert.Equal(OccIncidentCodes.OccurredAtInvalid, (await Report(Guid.NewGuid(), "Operational", "Demora del equipaje",
            now.AddMinutes(30))).Code);
        Assert.Equal(OccIncidentCodes.OccurredAtInvalid, (await Report(Guid.NewGuid(), "Operational", "Demora del equipaje",
            startedAt.AddDays(-2))).Code);
        var key = Guid.NewGuid();
        var reported = await Report(key, "Deviation", "Demora por congestión en la torre", now.AddMinutes(-3), "87");
        Assert.True(reported.Value is not null, reported.Code);
        Assert.False(reported.Replayed);
        var replayed = await Report(key, "Deviation", "Demora por congestión en la torre", now.AddMinutes(-3), "87");
        Assert.Equal((reported.Value!.Id, true), (replayed.Value!.Id, replayed.Replayed));
        Assert.Equal("idempotency_conflict", (await Report(key, "Deviation", "Otra descripción con la clave",
            now.AddMinutes(-3), "87")).Code);
        Assert.Equal(("Occ", "Open", "87"), (reported.Value.ReportedByKind, reported.Value.Status, reported.Value.DelayCode));

        // 3. State changes carry a note and the version OCC saw.
        Task<MasterDataResult<OccIncidentData>> Change(Guid incident, string status, string note, string? version) =>
            Run(services => Incidents(services).ChangeStatusAsync(TimingOcc, incident,
                new OccIncidentStatusInput(status, note, version), Guid.NewGuid(), ct));
        var id = reported.Value.Id;
        Assert.Equal("expected_version_required", (await Change(id, "InReview", "Revisando con la aerolínea", null)).Code);
        Assert.Equal("version_conflict", (await Change(id, "InReview", "Revisando con la aerolínea", "AAAAAAAAAAA=")).Code);
        Assert.Equal(OccIncidentCodes.TransitionInvalid,
            (await Change(id, "Closed", "Cerrar sin resolver", reported.Value.Version)).Code);
        Assert.Equal("reason_required", (await Change(id, "InReview", "corta", reported.Value.Version)).Code);
        var inReview = await Change(id, "InReview", "Revisando con la aerolínea", reported.Value.Version);
        Assert.Equal("InReview", inReview.Value!.Status);
        var resolved = await Change(id, "Resolved", "La torre confirmó la demora", inReview.Value.Version);
        Assert.Equal(("Resolved", "La torre confirmó la demora"), (resolved.Value!.Status, resolved.Value.ResolutionNote));
        Assert.NotNull(resolved.Value.ResolvedAt);
        Assert.NotNull(resolved.Value.ResolvedBy);
        // Taken back into review the resolution stays in the history only; then it is resolved and closed.
        var back = await Change(id, "InReview", "La aerolínea pidió más datos", resolved.Value.Version);
        Assert.Equal(("InReview", (string?)null), (back.Value!.Status, back.Value.ResolutionNote));
        var again = await Change(id, "Resolved", "Datos enviados a la aerolínea", back.Value.Version);
        var closed = await Change(id, "Closed", "Caso cerrado con la aerolínea", again.Value!.Version);
        Assert.Equal(("Closed", "Datos enviados a la aerolínea"), (closed.Value!.Status, closed.Value.ResolutionNote));
        Assert.Empty(closed.Value.AllowedStatuses);
        Assert.Equal(["-", "Open", "InReview", "Resolved", "InReview", "Resolved"],
            closed.Value.History.Select(item => item.FromStatus ?? "-").ToArray());
        Assert.Equal(OccIncidentCodes.TransitionInvalid,
            (await Change(id, "InReview", "Reabrir una cerrada", closed.Value.Version)).Code);

        // 4. The tablet keeps reading the same keys and sees what OCC reported and managed.
        var ramp = await Run(services => services.GetRequiredService<IRampIncidentStore>().GetAsync(
            new RampIncidentReadRequest(TimingAgent, [TimingStation], TimingOperation), ct));
        Assert.Equal(2, ramp.Incidents!.Count);
        Assert.Contains(ramp.Incidents, item => item.Id == id && item.Status == "Closed");
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.Equal(1, await check.AuditEntries.CountAsync(item => item.Action == "occ.incident.reported", ct));
            Assert.Equal(5, await check.AuditEntries.CountAsync(item => item.Action == "occ.incident.status_changed", ct));
            var row = await check.Incidents.AsNoTracking().SingleAsync(item => item.PublicId == id, ct);
            Assert.Equal((null, true), (row.ReportedByRampAgentId, row.ReportedByAccountId is not null));
        }

        // 5. An approved operation's incidents are history: OCC no longer reports on it nor takes a resolved one back into
        // review (its resolution stands); it still closes it.
        var tabletResolved = await Change(fromTablet.Id, "Resolved", "Limpieza confirmada por la torre", fromTablet.Version);
        Assert.Equal("Resolved", tabletResolved.Value!.Status);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item => item.Id == operationInternalId, ct);
            operation.CurrentStatus = GroundOperationStatus.Approved;
            await setup.SaveChangesAsync(ct);
        }
        Assert.Equal(OccIncidentCodes.OperationClosed, (await Report(Guid.NewGuid(), "Operational", "Demora del equipaje",
            now.AddMinutes(-1))).Code);
        var approved = (await Run(services => Incidents(services).ListAsync(TimingOcc, TimingOperation, ct))).Value!;
        Assert.False(approved.CanReport);
        var history = Assert.Single(approved.Incidents, item => item.Id == fromTablet.Id);
        Assert.Equal(["Closed"], history.AllowedStatuses);
        var refused = await Change(fromTablet.Id, "InReview", "La aerolínea pidió revisarla", history.Version);
        Assert.Equal((MasterDataFailure.Conflict, OccIncidentCodes.OperationClosed), (refused.Failure, refused.Code));
        var kept = await Change(fromTablet.Id, "Closed", "Caso cerrado con la aerolínea", history.Version);
        Assert.Equal(("Closed", "Limpieza confirmada por la torre"), (kept.Value!.Status, kept.Value.ResolutionNote));
    }
}
