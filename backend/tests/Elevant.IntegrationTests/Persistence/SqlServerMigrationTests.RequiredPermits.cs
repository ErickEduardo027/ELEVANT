using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// ADR-0045: Gestión Humana keeps custom permit types next to the two system ones and the qualification equipment;
/// OCC requires permits at a stand, and the coverage and the assignment admit there only an agent with a current cycle
/// of each.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task HumanResourcesSettingsKeepCustomPermitTypesAndEquipmentWithoutTouchingTheSystemOnes()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        Task<T> Settings<T>(Func<IHumanResourcesSettingsStore, Task<T>> action) =>
            RunScopedAsync(provider, services => action(services.GetRequiredService<IHumanResourcesSettingsStore>()));
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);

        // OCC does not manage it; Gestión Humana reads the two system types first, flagged and without a version.
        Assert.Equal("forbidden", (await Settings(store => store.ReadPermitTypesAsync(SeededOccAccount, ct))).Code);
        var initial = (await Settings(store => store.ReadPermitTypesAsync(HumanResourcesAccount, ct))).Value!;
        Assert.Equal(["AirportId", "RampDriverLicense"], initial.PermitTypes.Select(item => item.Code));
        Assert.All(initial.PermitTypes, item => Assert.True(item.IsSystem && item.Id is null && item.Version is null));
        Assert.Equal(["Carnet aeroportuario", "Licencia de conducir en rampa"], initial.PermitTypes.Select(item => item.Name));

        // A system code is taken in any case; a malformed one is invalid; the key replays the creation.
        Assert.Equal("code_taken", (await Settings(store => store.CreatePermitTypeAsync(HumanResourcesAccount,
            new CreatePermitTypeInput("airportid", "Otro carnet", null), Guid.NewGuid(), ct))).Code);
        Assert.Equal("invalid_settings", (await Settings(store => store.CreatePermitTypeAsync(HumanResourcesAccount,
            new CreatePermitTypeInput("Z", "Otro carnet", null), Guid.NewGuid(), ct))).Code);
        var key = Guid.NewGuid();
        var input = new CreatePermitTypeInput("zona-restringida", "Carnet de zona restringida", "Zonas de seguridad");
        var created = await Settings(store => store.CreatePermitTypeAsync(HumanResourcesAccount, input, key, ct));
        Assert.Null(created.Failure);
        Assert.Equal(("ZONA-RESTRINGIDA", false, false), (created.Value!.Code, created.Value.IsSystem, created.Value.InUse));
        var replay = await Settings(store => store.CreatePermitTypeAsync(HumanResourcesAccount, input, key, ct));
        Assert.True(replay.Replayed);
        Assert.Equal("idempotency_conflict", (await Settings(store => store.CreatePermitTypeAsync(HumanResourcesAccount,
            input with { Name = "Otro nombre" }, key, ct))).Code);
        Assert.Equal("code_taken", (await Settings(store => store.CreatePermitTypeAsync(HumanResourcesAccount,
            input, Guid.NewGuid(), ct))).Code);

        // A cycle of the custom type is recorded like a system one.
        var cycle = Guid.NewGuid();
        Assert.Null((await RunScopedAsync(provider, services => services.GetRequiredService<IHumanResourcesPermitWriteStore>()
            .RecordAsync(HumanResourcesAccount, cycle, new RecordHumanResourcesPermitInput(RileyProfile, "ZONA-RESTRINGIDA",
                null, "ZR-0001", today.AddDays(-1), today.AddYears(1)), ct))).Failure);
        var listed = (await RunScopedAsync(provider, services => services.GetRequiredService<IHumanResourcesPermitReadStore>()
            .ListCurrentAsync(HumanResourcesAccount, 1, 10, RileyProfile, "ZONA-RESTRINGIDA", ct)))!;
        Assert.Equal("ZONA-RESTRINGIDA", Assert.Single(listed.Permits).DocumentType);
        // An unknown code takes no cycle.
        Assert.Equal(HumanResourcesPermitWriteFailure.Invalid, (await RunScopedAsync(provider, services => services
            .GetRequiredService<IHumanResourcesPermitWriteStore>().RecordAsync(HumanResourcesAccount, Guid.NewGuid(),
                new RecordHumanResourcesPermitInput(RileyProfile, "NO-EXISTE", null, "NX-0001", today.AddDays(-1),
                    today.AddYears(1)), ct))).Failure);

        // In use, its code is fixed; its name changes; deactivated, it takes no new cycle.
        var current = Assert.Single((await Settings(store => store.ReadPermitTypesAsync(HumanResourcesAccount, ct)))
            .Value!.PermitTypes, item => item.Code == "ZONA-RESTRINGIDA");
        Assert.True(current.InUse);
        Assert.Equal("code_in_use", (await Settings(store => store.UpdatePermitTypeAsync(HumanResourcesAccount, current.Id!.Value,
            new UpdatePermitTypeInput("ZONA-B", current.Name, null, true, current.Version!), Guid.NewGuid(), ct))).Code);
        Assert.Equal("system_type_locked", (await Settings(store => store.UpdatePermitTypeAsync(HumanResourcesAccount,
            current.Id!.Value, new UpdatePermitTypeInput("RampDriverLicense", current.Name, null, true, current.Version!),
            Guid.NewGuid(), ct))).Code);
        Assert.Equal("version_conflict", (await Settings(store => store.UpdatePermitTypeAsync(HumanResourcesAccount,
            current.Id!.Value, new UpdatePermitTypeInput(current.Code, "Zona", null, true, "AAAAAAAAAAA="), Guid.NewGuid(),
            ct))).Code);
        var deactivated = await Settings(store => store.UpdatePermitTypeAsync(HumanResourcesAccount, current.Id!.Value,
            new UpdatePermitTypeInput(current.Code, "Carnet de zona restringida (T1)", null, false, current.Version!),
            Guid.NewGuid(), ct));
        Assert.Null(deactivated.Failure);
        Assert.False(deactivated.Value!.IsActive);
        Assert.Equal(HumanResourcesPermitWriteFailure.Invalid, (await RunScopedAsync(provider, services => services
            .GetRequiredService<IHumanResourcesPermitWriteStore>().RecordAsync(HumanResourcesAccount, Guid.NewGuid(),
                new RecordHumanResourcesPermitInput(RileyProfile, "ZONA-RESTRINGIDA", cycle, "ZR-0002", today.AddDays(-1),
                    today.AddYears(1)), ct))).Failure);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.Equal(["hr.permit_type.created", "hr.permit_type.deactivated"], await check.AuditEntries.AsNoTracking()
                .Where(item => item.EntityPublicId == current.Id).OrderBy(item => item.Id).Select(item => item.Action)
                .ToArrayAsync(ct));

        // Equipment: the boarding bridge keeps its code and stays active; a code in use is fixed; a new one is added.
        var equipment = (await Settings(store => store.ReadEquipmentTypesAsync(HumanResourcesAccount, ct))).Value!;
        var bridge = Assert.Single(equipment.EquipmentTypes, item => item.Code == EfPositionCoverageStore.BridgeEquipmentTypeCode);
        Assert.True(bridge.IsLocked);
        Assert.Equal("system_type_locked", (await Settings(store => store.UpdateEquipmentTypeAsync(HumanResourcesAccount,
            bridge.Id, new UpdateEquipmentTypeInput(bridge.Code, bridge.Name, bridge.RequiresQualification, false,
                bridge.Version), Guid.NewGuid(), ct))).Code);
        var renamed = await Settings(store => store.UpdateEquipmentTypeAsync(HumanResourcesAccount, bridge.Id,
            new UpdateEquipmentTypeInput(bridge.Code, "Puente de abordaje (pasarela)", bridge.RequiresQualification, true,
                bridge.Version), Guid.NewGuid(), ct));
        Assert.Null(renamed.Failure);
        var gpu = Assert.Single(equipment.EquipmentTypes, item => item.Code == "GPU");
        Assert.True(gpu.InUse);
        Assert.Equal("code_in_use", (await Settings(store => store.UpdateEquipmentTypeAsync(HumanResourcesAccount, gpu.Id,
            new UpdateEquipmentTypeInput("GPU-2", gpu.Name, gpu.RequiresQualification, true, gpu.Version), Guid.NewGuid(),
            ct))).Code);
        var tug = await Settings(store => store.CreateEquipmentTypeAsync(HumanResourcesAccount,
            new CreateEquipmentTypeInput("tug-10", "Tractor de remolque", true), Guid.NewGuid(), ct));
        Assert.Equal(("TUG-10", true, false), (tug.Value!.Code, tug.Value.IsActive, tug.Value.InUse));
        var tugOff = await Settings(store => store.UpdateEquipmentTypeAsync(HumanResourcesAccount, tug.Value.Id,
            new UpdateEquipmentTypeInput("TUG-11", tug.Value.Name, true, false, tug.Value.Version), Guid.NewGuid(), ct));
        Assert.Equal(("TUG-11", false), (tugOff.Value!.Code, tugOff.Value.IsActive));
    }

    [Fact]
    public async Task AStandThatRequiresAPermitAdmitsOnlyAgentsWithACurrentCycleOfIt()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var connection = database.ConnectionString;
        var (airline, stands) = await PlanningFixtureAsync(connection, ct);
        var day = BusinessCalendar.Today(DateTimeOffset.UtcNow, StationZone).AddDays(2);
        long riley;
        string rileyNumber;
        await using (var setup = CreateContext(connection))
        {
            var row = await setup.RampAgents.Where(item => item.PublicId == RileyProfile)
                .Select(item => new { item.Id, item.EmployeeNumber }).SingleAsync(ct);
            (riley, rileyNumber) = (row.Id, row.EmployeeNumber);
        }
        await AddRampShiftAsync(connection, riley, day, "A", 6, 18, ct);
        var type = (await RunScopedAsync(provider, services => services.GetRequiredService<IHumanResourcesSettingsStore>()
            .CreatePermitTypeAsync(HumanResourcesAccount, new CreatePermitTypeInput("ZONA-RESTRINGIDA",
                "Carnet de zona restringida", null), Guid.NewGuid(), ct))).Value!;
        Task<MasterDataResult<OccMasterData>> Read() => RunScopedAsync(provider, services => services
            .GetRequiredService<IOccMasterDataStore>().ReadAsync(SeededOccAccount, SeededPujStation, ct));
        MasterStandData StandOf(OccMasterData data, string code) => Assert.Single(data.Stands, item => item.Code == code);

        // OCC offers the system types and the active custom one; A01 requires it, with its version.
        var before = (await Read()).Value!;
        Assert.Contains(before.PermitTypes!, item => item.Code == "ZONA-RESTRINGIDA" && !item.IsSystem);
        var a01 = StandOf(before, "A01");
        Assert.Empty(a01.RequiredPermits!);
        Assert.Equal("invalid_required_permits", (await RunScopedAsync(provider, services => services
            .GetRequiredService<IOccMasterDataStore>().SetStandRequiredPermitsAsync(SeededOccAccount, a01.Id,
                new SetStandRequiredPermitsInput(["NO-EXISTE"], a01.Version), Guid.NewGuid(), ct))).Code);
        var set = await RunScopedAsync(provider, services => services.GetRequiredService<IOccMasterDataStore>()
            .SetStandRequiredPermitsAsync(SeededOccAccount, a01.Id,
                new SetStandRequiredPermitsInput(["ZONA-RESTRINGIDA"], a01.Version), Guid.NewGuid(), ct));
        Assert.Null(set.Failure);
        Assert.Equal([new StandRequiredPermitData("ZONA-RESTRINGIDA", "Carnet de zona restringida")], set.Value!.RequiredPermits);
        Assert.NotEqual(a01.Version, set.Value.Version);
        Assert.Equal("version_conflict", (await RunScopedAsync(provider, services => services
            .GetRequiredService<IOccMasterDataStore>().SetStandRequiredPermitsAsync(SeededOccAccount, a01.Id,
                new SetStandRequiredPermitsInput([], a01.Version), Guid.NewGuid(), ct))).Code);
        // «Aplicar a varias posiciones»: A02 and A03 too, in one command; the type is now in use and stays active.
        var batch = await RunScopedAsync(provider, services => services.GetRequiredService<IOccMasterDataStore>()
            .ApplyStandRequiredPermitsAsync(SeededOccAccount, new ApplyStandRequiredPermitsInput(SeededPujStation,
                [stands["A02"], stands["A03"]], ["ZONA-RESTRINGIDA"]), Guid.NewGuid(), ct));
        Assert.Equal(["A02", "A03"], batch.Value!.Stands.Select(item => item.Code));
        Assert.Equal("code_in_use", (await RunScopedAsync(provider, services => services
            .GetRequiredService<IHumanResourcesSettingsStore>().UpdatePermitTypeAsync(HumanResourcesAccount, type.Id!.Value,
                new UpdatePermitTypeInput(type.Code, type.Name, null, false, type.Version!), Guid.NewGuid(), ct))).Code);
        await using (var check = CreateContext(connection))
            Assert.Equal(3, await check.AuditEntries.CountAsync(item => item.Action == "occ.stand.required_permits_changed", ct));

        // Coverage: Riley lacks it, so A01 refuses him and names the permit; A04 without requirements admits him.
        var terminalA = await TerminalAsync(connection, "A", ct);
        Task<CoverageResult> Cover(Guid stand) => RunScopedAsync(provider, services => services
            .GetRequiredService<IPositionCoverageStore>().CreateAsync(SeededOccAccount, SeededPujStation,
                new CreateCoverageInput(RileyProfile, terminalA, [stand], day, LocalAt(day, 8), LocalAt(day, 9), null, null,
                    false), Guid.NewGuid(), ct));
        var refused = await Cover(stands["A01"]);
        Assert.Equal(PositionCoverageFailure.Rejected, refused.Failure);
        Assert.Equal(["required_permit_missing"], refused.Reasons);
        Assert.Equal(["Carnet de zona restringida"], refused.MissingPermits);

        // The assignment of a flight on A02 names it too.
        var planned = await PlanManualFlightAsync(provider, airline, stands["A02"], day, "ZZ945", LocalAt(day, 10),
            LocalAt(day, 12), ct);
        Assert.True(planned.Failure is null, planned.Code ?? planned.Failure?.ToString());
        var option = OccAgentEligibilityPolicy.Evaluate(await CandidateAsync(provider, planned.TurnaroundId!.Value,
            rileyNumber, ct));
        Assert.Contains("required_permit_missing", option.EligibilityReasons);
        Assert.Equal(["Carnet de zona restringida"], option.MissingPermits);

        // An expired cycle does not count; a current one admits him in both.
        var expired = Guid.NewGuid();
        Assert.Null((await RunScopedAsync(provider, services => services.GetRequiredService<IHumanResourcesPermitWriteStore>()
            .RecordAsync(HumanResourcesAccount, expired, new RecordHumanResourcesPermitInput(RileyProfile, "ZONA-RESTRINGIDA",
                null, "ZR-0001", new DateOnly(2025, 1, 1), day.AddDays(-1)), ct))).Failure);
        Assert.Contains("required_permit_missing", (await Cover(stands["A01"])).Reasons);
        Assert.Null((await RunScopedAsync(provider, services => services.GetRequiredService<IHumanResourcesPermitWriteStore>()
            .RecordAsync(HumanResourcesAccount, Guid.NewGuid(), new RecordHumanResourcesPermitInput(RileyProfile,
                "ZONA-RESTRINGIDA", expired, "ZR-0002", BusinessCalendar.Today(DateTimeOffset.UtcNow).AddDays(-1), day.AddYears(1)),
                ct))).Failure);
        var admitted = OccAgentEligibilityPolicy.Evaluate(await CandidateAsync(provider, planned.TurnaroundId!.Value,
            rileyNumber, ct));
        Assert.DoesNotContain("required_permit_missing", admitted.EligibilityReasons);
        var accepted = await Cover(stands["A01"]);
        Assert.True(accepted.Failure is null, string.Join(",", accepted.Reasons));

        // The positions board names what A01 requires for its detail.
        var board = await RunScopedAsync(provider, services => services.GetRequiredService<IOccPositionStore>()
            .ReadAsync(SeededOccAccount, SeededPujStation, day, ct));
        Assert.Equal(["Carnet de zona restringida"], Assert.Single(board.Board!.Positions, item => item.Code == "A01")
            .RequiredPermits);
    }
}
