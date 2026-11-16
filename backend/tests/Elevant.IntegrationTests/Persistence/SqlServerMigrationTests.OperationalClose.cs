using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Finance;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0034: Finance sets the ground time and the holidays; at hand-off ELEVANT marks the night,
    /// package-exceeded and delay surcharges once, respects what OCC removed, freezes the times in the
    /// evidence, and the day's operational close reports stands, ground time and allowance.
    /// </summary>
    [Fact]
    public async Task OperationalCloseAppliesFinanceRulesAndAutomaticSurcharges()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seeder = CreateContext(connection))
            await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, ct);
        var occ = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var finance = await FinanceAccountAsync(database.ConnectionString, ct);
        var station = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        IFinanceCloseRulesStore Rules(IServiceProvider services) => services.GetRequiredService<IFinanceCloseRulesStore>();

        // 1. Finance's rules: the seeded allowances, optimistic versions and an audited holiday calendar.
        var seeded = await Run(services => Rules(services).ReadAsync(ct));
        Assert.Equal([("Narrowbody", 75), ("Widebody", 135)],
            seeded.Allowances.Select(item => (item.Category, item.AllowedMinutes)).ToArray());
        var narrow = seeded.Allowances.Single(item => item.Category == "Narrowbody");
        Assert.Equal(FinanceCloseRulesFailure.Conflict, (await Run(services => Rules(services).SetAllowanceAsync(finance,
            AircraftSizeCategory.Narrowbody, 60, "00", "close-test", ct))).Failure);
        var updated = await Run(services => Rules(services).SetAllowanceAsync(finance, AircraftSizeCategory.Narrowbody,
            60, narrow.Version, "close-test", ct));
        Assert.Equal(60, updated.Data!.AllowedMinutes);
        Assert.NotEqual(narrow.Version, updated.Data.Version);
        var holiday = await Run(services => Rules(services).AddHolidayAsync(finance, new DateOnly(2026, 8, 16),
            "Día de la Restauración", "close-test", ct));
        Assert.Equal(holiday.Data!.Id, (await Run(services => Rules(services).AddHolidayAsync(finance,
            new DateOnly(2026, 8, 16), "Día de la Restauración", "close-test", ct))).Data!.Id);
        Assert.Equal(FinanceCloseRulesFailure.Conflict, (await Run(services => Rules(services).AddHolidayAsync(finance,
            new DateOnly(2026, 8, 16), "Otro nombre", "close-test", ct))).Failure);
        var extra = await Run(services => Rules(services).AddHolidayAsync(finance, new DateOnly(2026, 12, 25), "Navidad",
            "close-test", ct));
        Assert.Null(await Run(services => Rules(services).RemoveHolidayAsync(finance, extra.Data!.Id, "close-test", ct)));
        Assert.Equal([new DateOnly(2026, 8, 16)],
            (await Run(services => Rules(services).ReadAsync(ct))).Holidays.Select(item => item.Date).ToArray());

        // 2. A night operation of the seeded A320 (narrowbody): block-on 23:10 station time, 90 minutes on
        // the ground against 60 allowed, the arrival 50 minutes late, both services completed.
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo");
        var blockOn = new DateTimeOffset(2026, 8, 18, 23, 10, 0, TimeSpan.FromHours(-4)).ToUniversalTime();
        long operationInternalId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == operationId, ct);
            operationInternalId = operation.Id;
            operation.CurrentStatus = GroundOperationStatus.InProgress;
            operation.ActualStartAt = blockOn;
            foreach (var service in await setup.OperationServices.Where(item => item.GroundOperationId == operation.Id)
                         .ToArrayAsync(ct))
            {
                service.CurrentStatus = ServiceExecutionStatus.Completed;
                service.ExecutedQuantity = 1;
            }
            foreach (var (code, at) in new[] { ("BLOCK_ON", blockOn), ("PUSHBACK", blockOn.AddMinutes(90)) })
                setup.Set<OperationMilestone>().Add(new OperationMilestone
                {
                    PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, Code = code, ActualAt = at,
                    Status = MilestoneStatus.Actual, Source = OperationalDataSource.Manual,
                    CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
                });
            var arrival = await setup.FlightLegs.SingleAsync(leg => leg.TurnaroundId == operation.TurnaroundId &&
                leg.Direction == FlightDirection.Arrival, ct);
            arrival.ScheduledAt = blockOn.AddMinutes(-60);
            arrival.ActualAt = blockOn.AddMinutes(-10);
            await setup.SaveChangesAsync(ct);
        }

        async Task<IReadOnlyList<string>> ApplyAsync()
        {
            await using var context = CreateContext(database.ConnectionString);
            var applied = await AutomaticSurchargeApplier.ApplyAsync(context, operationInternalId, blockOn.AddMinutes(95), ct);
            await context.SaveChangesAsync(ct);
            return applied;
        }
        Assert.Equal(["NIGHT", "OVERTIME", "DELAY"], await ApplyAsync());
        Assert.Empty(await ApplyAsync());
        await using (var check = CreateContext(database.ConnectionString))
        {
            var marks = await (from mark in check.OperationServiceCharges.AsNoTracking()
                               join charge in check.ChargeDefinitions.AsNoTracking() on mark.ChargeDefinitionId equals charge.Id
                               join service in check.OperationServices.AsNoTracking() on mark.OperationServiceId equals service.Id
                               where service.GroundOperationId == operationInternalId
                               select new { charge.Code, mark.Source, mark.AppliedByRampAgentId, mark.Id }).ToArrayAsync(ct);
            var services = await check.OperationServices.CountAsync(item => item.GroundOperationId == operationInternalId, ct);
            Assert.Equal(services, marks.Count(item => item.Code == "NIGHT"));
            Assert.Single(marks, item => item.Code == "OVERTIME");
            Assert.Single(marks, item => item.Code == "DELAY");
            Assert.All(marks, item => Assert.Equal((ChargeMarkSource.Automatic, (long?)null), (item.Source, item.AppliedByRampAgentId)));

            var evidence = await OperationSubmissionEvidence.CaptureAsync(check, operationInternalId, ct, blockOn.AddMinutes(95));
            Assert.Equal(OperationSubmissionEvidence.CurrentVersion, evidence.Version);
            Assert.Equal((90m, 60, "Narrowbody", 50m), (evidence.Close!.GroundMinutes, evidence.Close.AllowedGroundMinutes,
                evidence.Close.AircraftCategory, evidence.Close.ArrivalDelayMinutes));
            Assert.All(evidence.Timings!, timing => Assert.Equal(30m, timing.OperationOverrunMinutes));
            Assert.All(evidence.Charges!, charge => Assert.Equal("Automatic", charge.Source));
        }

        // 3. A charge OCC removed is not marked again on a later hand-off.
        await using (var occRemoval = CreateContext(database.ConnectionString))
        {
            var occAccount = await occRemoval.Users.Where(user => user.PublicId == occ).Select(user => user.Id).SingleAsync(ct);
            var delay = await (from mark in occRemoval.OperationServiceCharges
                               join charge in occRemoval.ChargeDefinitions on mark.ChargeDefinitionId equals charge.Id
                               where charge.Code == "DELAY" && mark.RemovedAt == null
                               select mark).SingleAsync(ct);
            delay.RemovedAt = DateTimeOffset.UtcNow;
            delay.RemovedByAccountId = occAccount;
            delay.AdjustmentReason = "La demora fue de la torre de control.";
            await occRemoval.SaveChangesAsync(ct);
        }
        Assert.Empty(await ApplyAsync());

        // 4. The day's operational close.
        var report = await Run(services => services.GetRequiredService<IOccReportStore>().ReadAsync(occ,
            OccReportKind.DailyClose, station, new DateOnly(2026, 8, 18), new DateOnly(2026, 8, 18), 1, 50, ct));
        Assert.Null(report.Failure);
        var row = Assert.Single(report.Table!.Rows, cells => cells[1].Value == "DEV-TAT-0001");
        Assert.Equal(report.Table.Definition.Columns.Count, row.Count);
        Assert.Equal(TimeZoneInfo.ConvertTime(blockOn.AddMinutes(90), zone).ToString("HH:mm"), row[7].Value);
        Assert.Equal(("90", "60"), (row[11].Value, row[12].Value));
        Assert.Equal(OccReportCellType.Number, row[11].Type);
    }

    /// <summary>
    /// 3-B: the tablet types the aircraft type once (an older tablet's command keeps its receipt hash and replays), the
    /// ramp catalog lists the active types, the type is frozen from the first submission, and the package-exceeded
    /// surcharge is marked automatically from the type's ground-time allowance.
    /// </summary>
    [Fact]
    public async Task TheTabletTypesTheAircraftOnceAndOvertimeIsAppliedAutomatically()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await SeedDevelopmentAsync(database, ct);
        var agent = SeededRampAgentAccount;
        var station = SeededPujStation;
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installation = Guid.Parse("81000000-0000-7000-8000-000000000081");
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Task<RampExecutionWriteResult> FlightData(Guid key, Guid? aircraftTypeId, int passengers = 120) =>
            Run(services => services.GetRequiredService<IRampExecutionCommandStore>().UpdateFlightDataAsync(
                new RampFlightDataWriteRequest(agent, [station], operationId, passengers, 118, 70_000, null, installation, key,
                    "type-test", aircraftTypeId), ct));

        // The flight was planned without its type; the agent starts it on the tablet.
        await using (var setup = CreateContext(database.ConnectionString))
            await setup.Turnarounds.Where(item => item.OperationCode == "DEV-TAT-0001")
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.AircraftTypeId, (long?)null), ct);
        Assert.True((await Run(services => services.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(agent, installation, MobilePlatform.Android, "1.2.3",
                "Aircraft type SQL test tablet", "Android 16"), ct))).IsSuccess);
        var startKey = Guid.NewGuid();
        Assert.True((await Run(services => services.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
            new RampOperationStartWriteRequest(agent, [station], operationId, installation, startKey, startKey, "type-start"),
            ct))).IsSuccess);

        // The ramp catalog: active types only, and only for ramp agents.
        Guid narrow, wide;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            narrow = await setup.AircraftTypes.Where(item => item.IcaoCode == "A320").Select(item => item.PublicId).SingleAsync(ct);
            wide = await setup.AircraftTypes.Where(item => item.IcaoCode == "A333").Select(item => item.PublicId).SingleAsync(ct);
            await setup.AircraftTypes.Where(item => item.PublicId == wide)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, false), ct);
        }
        var catalog = await Run(services => services.GetRequiredService<IRampReferenceStore>().ListAircraftTypesAsync(agent, ct));
        Assert.Contains(catalog!, item => item.Id == narrow);
        Assert.DoesNotContain(catalog!, item => item.Id == wide);
        Assert.Null(await Run(services => services.GetRequiredService<IRampReferenceStore>()
            .ListAircraftTypesAsync(SeededOccAccount, ct)));

        // An older tablet queued flight data without a type: its receipt, stored with the first hash, replays as it was.
        var legacyKey = Guid.NewGuid();
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var device = await setup.MobileDevices.SingleAsync(item => item.InstallationId == installation, ct);
            var account = await setup.Users.Where(user => user.PublicId == agent).Select(user => user.Id).SingleAsync(ct);
            var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
            var v1 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                command = "ramp.operation.flight_data.update.v1", operationId, passengersIn = (int?)99, passengersOut = (int?)118,
                mtowKg = (int?)70_000, aircraftRegistration = (string?)null,
            }, web)))).ToLowerInvariant();
            var stored = new RampExecutionData(Guid.NewGuid(), operationId, [], new RampFlightData(99, 118, 70_000), null);
            setup.MobileCommandReceipts.Add(new MobileCommandReceipt
            {
                PublicId = stored.ReceiptId, MobileDeviceId = device.Id, AccountId = account,
                IdempotencyKey = legacyKey.ToString("D"), CommandType = "ramp.operation.flight_data.update.v1",
                PayloadHash = v1, Status = MobileCommandStatus.Processed, ReceivedAt = DateTimeOffset.UtcNow,
                ProcessedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
                ResultJson = JsonSerializer.Serialize(stored, web), CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
        }
        var legacy = await FlightData(legacyKey, null, 99);
        Assert.True(legacy.IsSuccess, legacy.Failure?.ToString());
        Assert.Equal(99, legacy.Data!.FlightData.PassengersIn);
        // The same key with a type is another payload.
        Assert.Equal(RampExecutionWriteFailure.IdempotencyKeyConflict, (await FlightData(legacyKey, narrow, 99)).Failure);

        // An unknown or inactive type is refused with its code, and the replay answers the same code.
        var unknownKey = Guid.NewGuid();
        var refused = await FlightData(unknownKey, wide);
        Assert.Equal(("aircraft_type_unavailable", RampExecutionWriteFailure.Conflict), (refused.Code, refused.Failure));
        Assert.Equal("aircraft_type_unavailable", (await FlightData(unknownKey, wide)).Code);
        var typed = await FlightData(Guid.NewGuid(), narrow);
        Assert.True(typed.IsSuccess, typed.Failure?.ToString());

        // 120 minutes on the ground against the narrow-body's 75: OVERTIME is marked automatically.
        long operationInternalId;
        var blockOn = DateTimeOffset.UtcNow.AddMinutes(-130);
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == operationId, ct);
            operationInternalId = operation.Id;
            Assert.NotNull(await setup.Turnarounds.Where(item => item.Id == operation.TurnaroundId)
                .Select(item => item.AircraftTypeId).SingleAsync(ct));
            foreach (var service in await setup.OperationServices.Where(item => item.GroundOperationId == operation.Id).ToArrayAsync(ct))
            {
                service.CurrentStatus = ServiceExecutionStatus.Completed;
                service.ExecutedQuantity = 1;
            }
            foreach (var (code, at) in new[] { ("BLOCK_ON", blockOn), ("PUSHBACK", blockOn.AddMinutes(120)) })
                setup.Set<OperationMilestone>().Add(new OperationMilestone
                {
                    PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, Code = code, ActualAt = at,
                    Status = MilestoneStatus.Actual, Source = OperationalDataSource.Manual,
                    CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
                });
            await setup.SaveChangesAsync(ct);
        }
        await using (var context = CreateContext(database.ConnectionString))
        {
            Assert.Contains("OVERTIME", await AutomaticSurchargeApplier.ApplyAsync(context, operationInternalId,
                blockOn.AddMinutes(125), ct));
            await context.SaveChangesAsync(ct);
            var evidence = await OperationSubmissionEvidence.CaptureAsync(context, operationInternalId, ct, blockOn.AddMinutes(125));
            Assert.Equal(("Narrowbody", 75), (evidence.Close!.AircraftCategory, evidence.Close.AllowedGroundMinutes));
            var overtime = await (from mark in context.OperationServiceCharges.AsNoTracking()
                                  join charge in context.ChargeDefinitions.AsNoTracking() on mark.ChargeDefinitionId equals charge.Id
                                  join service in context.OperationServices.AsNoTracking() on mark.OperationServiceId equals service.Id
                                  where service.GroundOperationId == operationInternalId && charge.Code == "OVERTIME"
                                  select mark.Source).ToArrayAsync(ct);
            Assert.Equal(ChargeMarkSource.Automatic, Assert.Single(overtime));
        }

        // From the first submission the type is evidence: a change is refused, the same type is not a change.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var checklist = await setup.OperationChecklists.FirstAsync(item => item.GroundOperationId == operationInternalId, ct);
            var riley = await setup.RampAgents.SingleAsync(item => item.EmployeeNumber == "DEV-RA-001", ct);
            setup.OperationSubmissions.Add(new OperationSubmission
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operationInternalId, OperationChecklistId = checklist.Id,
                RevisionNumber = 1, Status = SubmissionStatus.Returned, SubmittedByRampAgentId = riley.Id,
                SubmittedAt = DateTimeOffset.UtcNow.AddMinutes(-3), CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            await setup.SaveChangesAsync(ct);
            await setup.AircraftTypes.Where(item => item.PublicId == wide)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, true), ct);
        }
        Assert.Equal("aircraft_type_locked", (await FlightData(Guid.NewGuid(), wide)).Code);
        Assert.True((await FlightData(Guid.NewGuid(), narrow, 121)).IsSuccess);
    }
}
