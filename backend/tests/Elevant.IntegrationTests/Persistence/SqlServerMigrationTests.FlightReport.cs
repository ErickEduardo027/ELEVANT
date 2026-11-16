using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0031: the tablet records the Flight Report once — milestones with a tap, flight data, a
    /// deviation with its IATA code — idempotently per device, and the operation read returns it.
    /// </summary>
    [Fact]
    public async Task FlightReportIsCapturedOnceIdempotentlyAndDeviationsAlertOcc()
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
        var agent = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var station = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installation = Guid.Parse("81000000-0000-7000-8000-000000000071");
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        Assert.True((await Run(services => services.GetRequiredService<IMobileDeviceCommandStore>().RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(agent, installation, MobilePlatform.Android, "1.2.3",
                "Flight Report SQL test tablet", "Android 16"), ct))).IsSuccess);
        var startKey = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        // 3-I, 3-N25: «Iniciar» tapped ten minutes ago opens the window every milestone fits in.
        Assert.True((await Run(services => services.GetRequiredService<IRampOperationsCommandStore>().StartOperationAsync(
            new RampOperationStartWriteRequest(agent, [station], operationId, installation, startKey, startKey, "fr-start",
                now.AddMinutes(-10)), ct))).IsSuccess);

        Task<RampExecutionWriteResult> Milestone(Guid key, string code, DateTimeOffset at) =>
            Run(services => services.GetRequiredService<IRampExecutionCommandStore>().RecordMilestoneAsync(
                new RampMilestoneWriteRequest(agent, [station], operationId, code, at, installation, key, "fr-test"), ct));

        // One tap records Bloqueo; the same key replays, a different payload with that key conflicts.
        var blockKey = Guid.NewGuid();
        var block = await Milestone(blockKey, "BLOCK_ON", now.AddMinutes(-3));
        Assert.True(block.IsSuccess);
        Assert.Equal("BLOCK_ON", Assert.Single(block.Data!.Milestones).Code);
        Assert.Equal(block.CommitReceiptId, (await Milestone(blockKey, "BLOCK_ON", now.AddMinutes(-3))).CommitReceiptId);
        Assert.Equal(RampExecutionWriteFailure.IdempotencyKeyConflict,
            (await Milestone(blockKey, "BLOCK_ON", now.AddMinutes(-2))).Failure);
        // A late correction overwrites the time; a time in the future is rejected.
        Assert.True((await Milestone(Guid.NewGuid(), "BLOCK_ON", now.AddMinutes(-4))).IsSuccess);
        Assert.Equal(RampExecutionWriteFailure.Conflict, (await Milestone(Guid.NewGuid(), "PUSHBACK", now.AddHours(1))).Failure);
        Assert.True((await Milestone(Guid.NewGuid(), "WALKAROUND_START", now.AddMinutes(-2))).IsSuccess);

        // Flight data typed once; the registration correction reaches the turnaround.
        var flight = await Run(services => services.GetRequiredService<IRampExecutionCommandStore>().UpdateFlightDataAsync(
            new RampFlightDataWriteRequest(agent, [station], operationId, 150, 148, 78_000, "HI1099", installation,
                Guid.NewGuid(), "fr-test"), ct));
        Assert.True(flight.IsSuccess);
        Assert.Equal(("HI1099", 150, 148, 78_000), (flight.Data!.AircraftRegistration, flight.Data.FlightData.PassengersIn,
            flight.Data.FlightData.PassengersOut, flight.Data.FlightData.MtowKg));
        Assert.Equal(["BLOCK_ON", "WALKAROUND_START"], flight.Data.Milestones.Select(item => item.Code));

        // The tablet's read returns milestones in the form's order and the flight data.
        var read = await Run(services => services.GetRequiredService<IRampOperationsReadStore>()
            .GetActiveAssignedOperationsAsync(agent, [station], ct));
        var operation = Assert.Single(read.Operations!, item => item.Operation.Id == operationId);
        Assert.Equal(["BLOCK_ON", "WALKAROUND_START"], operation.Milestones!.Select(item => item.Code));
        Assert.Equal(now.AddMinutes(-4).ToUnixTimeMilliseconds(), operation.Milestones![0].ActualAt.ToUnixTimeMilliseconds());
        Assert.Equal((150, 148, 78_000), (operation.Operation.PassengersIn, operation.Operation.PassengersOut,
            operation.Operation.MtowKg));
        Assert.Equal("HI1099", operation.Turnaround.Aircraft?.Registration);

        // A deviation with its IATA delay code is an alert for OCC.
        var deviationKey = Guid.NewGuid();
        var deviation = await Run(services => services.GetRequiredService<IRampIncidentStore>().ReportAsync(
            new RampIncidentWriteRequest(agent, [station], operationId, RampIncidentPolicy.Deviation, IncidentSeverity.Medium,
                "GPU no disponible al bloqueo", DateTimeOffset.UtcNow, installation, deviationKey, deviationKey, "fr-test", "34"), ct));
        Assert.True(deviation.IsSuccess);
        await using var check = CreateContext(database.ConnectionString);
        Assert.Equal("34", (await check.Set<Incident>().SingleAsync(item => item.PublicId == deviationKey, ct)).DelayCode);
        Assert.True(await check.OperationalNotifications.AnyAsync(item => item.Kind == "deviation_reported" &&
            item.SourceId == deviationKey, ct));
        Assert.True(await check.AuditEntries.AnyAsync(entry => entry.Action == "ramp.operation.milestone.recorded", ct));

        // Every operation without a boarding bridge gets the literal Flight Report checklist.
        var template = await check.Set<ChecklistTemplateItem>()
            .Where(item => check.Set<ChecklistTemplateVersion>().Any(version => version.Id == item.ChecklistTemplateVersionId &&
                check.Set<ChecklistTemplate>().Any(entry => entry.Id == version.ChecklistTemplateId &&
                    entry.Code == RampChecklists.FlightReport)))
            .OrderBy(item => item.SortOrder).Select(item => item.Label).ToArrayAsync(ct);
        Assert.Equal(21, template.Length);
        Assert.Equal("Limpieza del área de estacionamiento antes de la llegada de la aeronave", template[0]);
    }
}
