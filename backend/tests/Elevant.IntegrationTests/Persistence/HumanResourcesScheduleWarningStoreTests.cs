using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task HumanResourcesScheduleWarningStoreTestsRecheckScopeAndPagesWithoutHiddenStationEvidence()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection, "Development", cancellationToken);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(cancellationToken);
        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seed = CreateContext(connection))
            await new DevelopmentDataSeeder(seed).SeedAsync(InitialPasswords, cancellationToken);

        var day = new DateOnly(2027, 1, 6);
        var previousDay = day.AddDays(-1);
        var instant = new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        Guid stationId;
        Guid hiddenStationId;
        Guid hiddenShiftId;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var station = await setup.Stations.SingleAsync(item => item.Code == "PUJ",
                cancellationToken);
            var terminal = await setup.Terminals.SingleAsync(item =>
                item.StationId == station.Id && item.Code == "A", cancellationToken);
            var seededAgent = await setup.RampAgents.SingleAsync(item =>
                item.EmployeeNumber == "DEV-RA-001", cancellationToken);
            stationId = station.PublicId;

            var airport = new Airport
            {
                PublicId = Guid.CreateVersion7(), IataCode = "TST", IcaoCode = "MTST",
                Name = "Synthetic schedule test airport", City = "Test",
                CountryCode = "DO", CreatedAt = instant, UpdatedAt = instant,
            };
            setup.Airports.Add(airport);
            await setup.SaveChangesAsync(cancellationToken);
            var hiddenStation = new Station
            {
                PublicId = Guid.CreateVersion7(), AirportId = airport.Id,
                Code = "TST", Name = "Synthetic hidden station",
                IanaTimeZone = "America/New_York", IsActive = true,
                CreatedAt = instant, UpdatedAt = instant,
            };
            setup.Stations.Add(hiddenStation);
            await setup.SaveChangesAsync(cancellationToken);
            var hiddenTerminal = new Terminal
            {
                PublicId = Guid.CreateVersion7(), StationId = hiddenStation.Id,
                Code = "T1", Name = "Synthetic terminal", IsActive = true,
                CreatedAt = instant, UpdatedAt = instant,
            };
            setup.Terminals.Add(hiddenTerminal);
            await setup.SaveChangesAsync(cancellationToken);
            hiddenStationId = hiddenStation.PublicId;
            hiddenShiftId = Guid.CreateVersion7();
            setup.ShiftAssignments.AddRange(
                NewShift(seededAgent.Id, hiddenStation.Id, hiddenTerminal.Id,
                    previousDay, new TimeOnly(20, 0), new TimeOnly(23, 0),
                    hiddenShiftId, instant),
                NewShift(seededAgent.Id, station.Id, terminal.Id, day,
                    new TimeOnly(8, 0), new TimeOnly(16, 0),
                    Guid.CreateVersion7(), instant));

            var persons = Enumerable.Range(1, 100).Select(index => new Person
            {
                PublicId = Guid.CreateVersion7(), FirstName = "Synthetic",
                LastName = $"Schedule{index:000}", IdentificationType = "TEST",
                IdentificationNumber = $"SCHEDULE-{index:000}",
                CreatedAt = instant, UpdatedAt = instant,
            }).ToArray();
            setup.Persons.AddRange(persons);
            await setup.SaveChangesAsync(cancellationToken);
            var agents = persons.Select((person, index) => new RampAgent
            {
                PublicId = Guid.CreateVersion7(), PersonId = person.Id,
                EmployeeNumber = $"DEV-SCHEDULE-{index + 1:000}",
                Category = "Development test", HireDate = new DateOnly(2026, 1, 1),
                IsActive = true, CreatedAt = instant, UpdatedAt = instant,
            }).ToArray();
            setup.RampAgents.AddRange(agents);
            await setup.SaveChangesAsync(cancellationToken);
            setup.ShiftAssignments.AddRange(agents.SelectMany(agent => new[]
            {
                NewShift(agent.Id, station.Id, terminal.Id, previousDay,
                    new TimeOnly(12, 0), new TimeOnly(20, 0),
                    Guid.CreateVersion7(), instant),
                NewShift(agent.Id, station.Id, terminal.Id, day,
                    new TimeOnly(2, 0), new TimeOnly(10, 0),
                    Guid.CreateVersion7(), instant),
            }));
            await setup.SaveChangesAsync(cancellationToken);
        }

        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(TimeProvider.System)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider
            .GetRequiredService<IHumanResourcesScheduleWarningStore>();
        var deniedRole = await store.ListAsync(occId, stationId, day, day, 1, 100,
            cancellationToken);
        Assert.Equal(ScheduleWarningFailure.ForbiddenRole, deniedRole.Failure);
        Assert.Null(deniedRole.Page);
        var wrongStation = await store.ListAsync(hrId, hiddenStationId, day, day,
            1, 100, cancellationToken);
        Assert.Equal(ScheduleWarningFailure.ForbiddenStation, wrongStation.Failure);
        Assert.Null(wrongStation.Page);

        var first = await store.ListAsync(hrId, stationId, day, day, 1, 100,
            cancellationToken);
        Assert.Null(first.Failure);
        Assert.True(first.Page!.HasMore);
        Assert.Equal(100, first.Page.Warnings.Count);
        var second = await store.ListAsync(hrId, stationId, day, day, 2, 100,
            cancellationToken);
        Assert.Null(second.Failure);
        Assert.False(second.Page!.HasMore);
        Assert.Single(second.Page.Warnings);
        var combined = first.Page.Warnings.Concat(second.Page.Warnings).ToArray();
        Assert.Equal(101, combined.Length);
        Assert.Equal(101, combined.Select(item => (item.AnchorShiftId, item.Kind))
            .Distinct().Count());
        var restricted = Assert.Single(combined, item => item.HasRestrictedEvidence);
        Assert.Equal(ScheduleWarningKind.ShortRest, restricted.Kind);
        Assert.Null(restricted.MeasuredMinutes);
        Assert.DoesNotContain(restricted.Evidence, item =>
            item.ShiftId == hiddenShiftId || item.StationId == hiddenStationId ||
            item.StationCode == "TST");

        await using (var revoke = CreateContext(database.ConnectionString))
        {
            var accountKey = await revoke.Users.Where(item => item.PublicId == hrId)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var stationKey = await revoke.Stations.Where(item => item.PublicId == stationId)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            await revoke.AccountStationScopes.Where(item =>
                item.AccountId == accountKey && item.StationId == stationKey)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item =>
                    item.RevokedAt, instant), cancellationToken);
        }
        var revokedStation = await store.ListAsync(hrId, stationId, day, day,
            2, 100, cancellationToken);
        Assert.Equal(ScheduleWarningFailure.ForbiddenStation,
            revokedStation.Failure);
        Assert.Null(revokedStation.Page);
        await using (var revoke = CreateContext(database.ConnectionString))
        {
            var accountKey = await revoke.Users.Where(item => item.PublicId == hrId)
                .Select(item => item.Id).SingleAsync(cancellationToken);
            var roleKey = await revoke.Roles.Where(item =>
                item.NormalizedName == "GESTION_HUMANA")
                .Select(item => item.Id).SingleAsync(cancellationToken);
            await revoke.Set<IdentityUserRole<long>>().Where(item =>
                item.UserId == accountKey && item.RoleId == roleKey)
                .ExecuteDeleteAsync(cancellationToken);
        }
        var revokedRole = await store.ListAsync(hrId, stationId, day, day,
            1, 100, cancellationToken);
        Assert.Equal(ScheduleWarningFailure.ForbiddenRole, revokedRole.Failure);
        Assert.Null(revokedRole.Page);
    }

    private static ShiftAssignment NewShift(long agentKey, long stationKey,
        long terminalKey, DateOnly day, TimeOnly start, TimeOnly end,
        Guid publicId, DateTimeOffset instant) => new()
        {
            PublicId = publicId, RampAgentId = agentKey, StationId = stationKey,
            TerminalId = terminalKey, WorkDate = day, StartsAtLocal = start,
            EndsAtLocal = end, Block = ShiftBlock.Morning,
            CreatedAt = instant, UpdatedAt = instant,
        };
}
