using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Elevant.IntegrationTests.Persistence;

public sealed class SqlServerMigrationTests
{
    private const string MasterConnectionEnvironmentVariable = "ELEVANT_TEST_SQLSERVER_MASTER";
    private static readonly DevelopmentAccountPasswords InitialPasswords = new(
        "Synthetic-Admin!234",
        "Synthetic-Ramp!2345",
        "Synthetic-Airline!234");
    private static readonly DevelopmentAccountPasswords RotatedPasswords = new(
        "Rotated-Admin!5678",
        InitialPasswords.RampAgent,
        InitialPasswords.AirlineClient);

    [Fact]
    public void DevelopmentPasswordsRejectSharedOrWeakSecrets()
    {
        Assert.Throws<InvalidOperationException>(() => new DevelopmentAccountPasswords(
            "Synthetic-Shared!234",
            "Synthetic-Shared!234",
            "Synthetic-Airline!234"));
        Assert.Throws<InvalidOperationException>(() => new DevelopmentAccountPasswords(
            "all-lowercase-password",
            "Synthetic-Ramp!2345",
            "Synthetic-Airline!234"));
        Assert.Throws<InvalidOperationException>(() => new DevelopmentAccountPasswords(
            "REPLACE_ME_AdminAccount!2026",
            "Synthetic-Ramp!2345",
            "Synthetic-Airline!234"));
    }

    [Fact]
    public async Task ProductionSchemaStartsWithoutBusinessRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Production", cancellationToken);
        await using var context = CreateContext(database.ConnectionString);

        await context.Database.MigrateAsync(cancellationToken);

        Assert.Empty(await context.Organizations.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Empty(await context.Users.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Empty(await context.Turnarounds.AsNoTracking().ToListAsync(cancellationToken));
        Assert.Equal(6, (await context.Database.GetAppliedMigrationsAsync(cancellationToken)).Count());

        var productionCredentialMutation = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52100, productionCredentialMutation.Number);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new DevelopmentDataSeeder(context).SeedAsync(InitialPasswords, cancellationToken));
        Assert.Empty(await context.Organizations.AsNoTracking().ToListAsync(cancellationToken));
    }

    [Fact]
    public async Task DevelopmentSeederIsIdempotentAndPreservesExistingRows()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
        await using var context = CreateContext(seederConnection);

        var missingSyntheticAccount = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52103, missingSyntheticAccount.Number);
        Assert.Empty(await context.Users.AsNoTracking().ToListAsync(cancellationToken));

        var seeder = new DevelopmentDataSeeder(context);
        await seeder.SeedAsync(InitialPasswords, cancellationToken);

        var legacyTurnaround = await context.Turnarounds
            .AsNoTracking()
            .SingleAsync(item => item.OperationCode == "DEV-TAT-0001", cancellationToken);
        var planningTurnaround = await context.Turnarounds
            .AsNoTracking()
            .SingleAsync(item => item.OperationCode == "DEV-TAT-0002", cancellationToken);
        Assert.Equal(new DateOnly(2026, 8, 18), legacyTurnaround.OperationDate);
        Assert.Equal(new DateOnly(2026, 8, 19), planningTurnaround.OperationDate);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000012"),
            planningTurnaround.PublicId);

        var legacyLegDates = await context.FlightLegs
            .AsNoTracking()
            .Where(leg => leg.TurnaroundId == legacyTurnaround.Id)
            .Select(leg => DateOnly.FromDateTime(leg.ScheduledAt.UtcDateTime))
            .ToArrayAsync(cancellationToken);
        Assert.Equal(2, legacyLegDates.Length);
        Assert.All(legacyLegDates, date => Assert.Equal(new DateOnly(2026, 8, 17), date));

        var planningLegs = await context.FlightLegs
            .AsNoTracking()
            .Where(leg => leg.TurnaroundId == planningTurnaround.Id)
            .OrderBy(leg => leg.Direction)
            .Select(leg => new { leg.PublicId, leg.Direction, leg.FlightNumber, leg.ScheduledAt })
            .ToArrayAsync(cancellationToken);
        Assert.Collection(
            planningLegs,
            arrival =>
            {
                Assert.Equal(FlightDirection.Arrival, arrival.Direction);
                Assert.Equal(
                    Guid.Parse("70000000-0000-7000-8000-000000000013"),
                    arrival.PublicId);
                Assert.Equal("ZZ102", arrival.FlightNumber);
                Assert.Equal(
                    new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero),
                    arrival.ScheduledAt);
            },
            departure =>
            {
                Assert.Equal(FlightDirection.Departure, departure.Direction);
                Assert.Equal(
                    Guid.Parse("70000000-0000-7000-8000-000000000014"),
                    departure.PublicId);
                Assert.Equal("ZZ103", departure.FlightNumber);
                Assert.Equal(
                    new DateTimeOffset(2026, 8, 19, 15, 0, 0, TimeSpan.Zero),
                    departure.ScheduledAt);
            });

        var planningOperation = await context.GroundOperations
            .AsNoTracking()
            .SingleAsync(item => item.TurnaroundId == planningTurnaround.Id, cancellationToken);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000016"),
            planningOperation.PublicId);
        Assert.Equal(
            new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero),
            planningOperation.PlannedStartAt);
        Assert.Equal(
            new DateTimeOffset(2026, 8, 19, 14, 30, 0, TimeSpan.Zero),
            planningOperation.PlannedEndAt);
        Assert.False(await context.OperationAgentAssignments.AsNoTracking().AnyAsync(
            item => item.GroundOperationId == planningOperation.Id,
            cancellationToken));
        var planningService = await context.OperationServices
            .AsNoTracking()
            .SingleAsync(
                item => item.GroundOperationId == planningOperation.Id,
                cancellationToken);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000017"),
            planningService.PublicId);

        var planningStand = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                where assignment.TurnaroundId == planningTurnaround.Id && assignment.AssignedTo == null
                select new
                {
                    AssignmentInternalId = assignment.Id,
                    StandInternalId = stand.Id,
                    AssignmentId = assignment.PublicId,
                    StandId = stand.PublicId,
                    stand.Code,
                })
            .SingleAsync(cancellationToken);
        Assert.Equal("A02", planningStand.Code);
        Assert.Equal(
            Guid.Parse("70000000-0000-7000-8000-000000000015"),
            planningStand.AssignmentId);
        Assert.Equal(
            Guid.Parse("20000000-0000-7000-8000-000000000011"),
            planningStand.StandId);

        var riley = await context.RampAgents
            .AsNoTracking()
            .SingleAsync(agent => agent.EmployeeNumber == "DEV-RA-001", cancellationToken);
        var planningShift = await context.ShiftAssignments
            .AsNoTracking()
            .SingleAsync(
                shift => shift.RampAgentId == riley.Id &&
                    shift.WorkDate == new DateOnly(2026, 8, 19),
                cancellationToken);
        Assert.Equal(new TimeOnly(6, 0), planningShift.StartsAtLocal);
        Assert.Equal(new TimeOnly(14, 0), planningShift.EndsAtLocal);
        Assert.Equal(
            Guid.Parse("50000000-0000-7000-8000-000000000006"),
            planningShift.PublicId);

        var station = await context.Stations
            .SingleAsync(item => item.Code == "PUJ", cancellationToken);
        var terminal = await context.Terminals
            .SingleAsync(item => item.StationId == station.Id && item.Code == "A", cancellationToken);
        var testInstant = new DateTimeOffset(2026, 8, 19, 0, 0, 0, TimeSpan.Zero);
        var otherTerminal = new Terminal
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000030"),
            StationId = station.Id,
            Code = "B",
            Name = "Development terminal B",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Terminals.Add(otherTerminal);
        await context.SaveChangesAsync(cancellationToken);
        var mia = await context.Airports
            .SingleAsync(item => item.IataCode == "MIA", cancellationToken);
        var crossStation = new Station
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000031"),
            AirportId = mia.Id,
            Code = "MIA",
            Name = "Cross-station isolation fixture",
            IanaTimeZone = "America/New_York",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Stations.Add(crossStation);
        await context.SaveChangesAsync(cancellationToken);
        var crossTerminal = new Terminal
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000032"),
            StationId = crossStation.Id,
            Code = "X",
            Name = "Cross-station terminal",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Terminals.Add(crossTerminal);
        await context.SaveChangesAsync(cancellationToken);
        var crossStand = new Stand
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000033"),
            StationId = crossStation.Id,
            TerminalId = crossTerminal.Id,
            Code = "X99",
            StandType = "Isolation fixture",
            IsActive = true,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Stands.Add(crossStand);
        await context.SaveChangesAsync(cancellationToken);
        var position = await context.OperationalPositions
            .SingleAsync(item => item.Code == "RAMP-AGENT", cancellationToken);
        var expiredPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000001"),
            FirstName = "Expired",
            LastName = "Scope",
            PrimaryEmail = "expired.scope@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-EXPIRED-SCOPE",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var futurePerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000002"),
            FirstName = "Future",
            LastName = "Scope",
            PrimaryEmail = "future.scope@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-FUTURE-SCOPE",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var shiftOnlyPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000003"),
            FirstName = "Shift",
            LastName = "Only",
            PrimaryEmail = "shift.only@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-SHIFT-ONLY",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var wrongTerminalPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000004"),
            FirstName = "Wrong",
            LastName = "Terminal",
            PrimaryEmail = "wrong.terminal@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-WRONG-TERMINAL",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var wrongTimePerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000005"),
            FirstName = "Wrong",
            LastName = "Time",
            PrimaryEmail = "wrong.time@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-WRONG-TIME",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        var equalShiftPerson = new Person
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000006"),
            FirstName = "Equal",
            LastName = "Shift",
            PrimaryEmail = "equal.shift@dev.elevant.test",
            IdentificationType = "Synthetic",
            IdentificationNumber = "DEV-EQUAL-SHIFT",
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        };
        context.Persons.AddRange(
            expiredPerson,
            futurePerson,
            shiftOnlyPerson,
            wrongTerminalPerson,
            wrongTimePerson,
            equalShiftPerson);
        await context.SaveChangesAsync(cancellationToken);

        var expiredAgent = NewTestAgent(
            expiredPerson.Id,
            "DEV-RA-EXPIRED",
            "90000000-0000-7000-8000-000000000011",
            testInstant);
        var futureAgent = NewTestAgent(
            futurePerson.Id,
            "DEV-RA-FUTURE",
            "90000000-0000-7000-8000-000000000012",
            testInstant);
        var shiftOnlyAgent = NewTestAgent(
            shiftOnlyPerson.Id,
            "DEV-RA-SHIFT-ONLY",
            "90000000-0000-7000-8000-000000000013",
            testInstant);
        var wrongTerminalAgent = NewTestAgent(
            wrongTerminalPerson.Id,
            "DEV-RA-WRONG-TERMINAL",
            "90000000-0000-7000-8000-000000000014",
            testInstant);
        var wrongTimeAgent = NewTestAgent(
            wrongTimePerson.Id,
            "DEV-RA-WRONG-TIME",
            "90000000-0000-7000-8000-000000000015",
            testInstant);
        var equalShiftAgent = NewTestAgent(
            equalShiftPerson.Id,
            "DEV-RA-EQUAL-SHIFT",
            "90000000-0000-7000-8000-000000000016",
            testInstant);
        context.RampAgents.AddRange(
            expiredAgent,
            futureAgent,
            shiftOnlyAgent,
            wrongTerminalAgent,
            wrongTimeAgent,
            equalShiftAgent);
        await context.SaveChangesAsync(cancellationToken);

        context.Set<RampAgentStationScope>().AddRange(
            new RampAgentStationScope
            {
                RampAgentId = expiredAgent.Id,
                StationId = station.Id,
                ValidFrom = new DateOnly(2026, 1, 1),
                ValidTo = new DateOnly(2026, 8, 18),
            },
            new RampAgentStationScope
            {
                RampAgentId = futureAgent.Id,
                StationId = station.Id,
                ValidFrom = new DateOnly(2026, 8, 20),
            });
        context.Set<RampAgentTerminalScope>().Add(new RampAgentTerminalScope
        {
            RampAgentId = shiftOnlyAgent.Id,
            TerminalId = terminal.Id,
            ValidFrom = new DateOnly(2026, 1, 1),
        });
        context.ShiftAssignments.Add(new ShiftAssignment
        {
            PublicId = Guid.Parse("90000000-0000-7000-8000-000000000021"),
            RampAgentId = shiftOnlyAgent.Id,
            StationId = station.Id,
            TerminalId = terminal.Id,
            OperationalPositionId = position.Id,
            WorkDate = new DateOnly(2026, 8, 19),
            StartsAtLocal = new TimeOnly(6, 0),
            EndsAtLocal = new TimeOnly(14, 0),
            Block = ShiftBlock.Morning,
            CreatedAt = testInstant,
            UpdatedAt = testInstant,
        });
        context.ShiftAssignments.AddRange(
            new ShiftAssignment
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000022"),
                RampAgentId = wrongTerminalAgent.Id,
                StationId = station.Id,
                TerminalId = otherTerminal.Id,
                OperationalPositionId = position.Id,
                WorkDate = new DateOnly(2026, 8, 19),
                StartsAtLocal = new TimeOnly(6, 0),
                EndsAtLocal = new TimeOnly(14, 0),
                Block = ShiftBlock.Morning,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            },
            new ShiftAssignment
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000023"),
                RampAgentId = wrongTimeAgent.Id,
                StationId = station.Id,
                TerminalId = terminal.Id,
                OperationalPositionId = position.Id,
                WorkDate = new DateOnly(2026, 8, 19),
                StartsAtLocal = new TimeOnly(15, 0),
                EndsAtLocal = new TimeOnly(18, 0),
                Block = ShiftBlock.Afternoon,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            },
            new ShiftAssignment
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000024"),
                RampAgentId = equalShiftAgent.Id,
                StationId = station.Id,
                TerminalId = terminal.Id,
                OperationalPositionId = position.Id,
                WorkDate = new DateOnly(2026, 8, 19),
                StartsAtLocal = new TimeOnly(8, 0),
                EndsAtLocal = new TimeOnly(8, 0),
                Block = ShiftBlock.Morning,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            });
        await context.SaveChangesAsync(cancellationToken);

        await using (var planningProvider = CreateAuthenticationProvider(
            database.ConnectionString,
            new PasswordHashCounter()))
        using (var planningScope = planningProvider.CreateScope())
        {
            var readStore = planningScope.ServiceProvider.GetRequiredService<IOccPlanningReadStore>();
            var stationPublicId = Guid.Parse("20000000-0000-7000-8000-000000000003");
            Assert.Equal(
                new DateOnly(2026, 8, 19),
                await readStore.GetLatestOperationDateAsync(stationPublicId, cancellationToken));

            var snapshot = await readStore.GetSnapshotAsync(
                stationPublicId,
                new DateOnly(2026, 8, 19),
                cancellationToken);
            Assert.NotNull(snapshot);
            var planningItem = Assert.Single(snapshot.Turnarounds);
            Assert.Equal("DEV-TAT-0002", planningItem.OperationCode);
            Assert.Equal("A02", planningItem.Stand?.Code);
            Assert.Equal("ZZ102", planningItem.Arrival?.FlightNumber);
            Assert.Equal("ZZ103", planningItem.Departure?.FlightNumber);
            Assert.Empty(planningItem.Agents);
            Assert.Equal("BAGGAGE", Assert.Single(planningItem.Services).Code);

            var optionsResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                Guid.Parse("70000000-0000-7000-8000-000000000012"),
                cancellationToken);
            Assert.True(optionsResult.IsSuccess);
            var options = Assert.IsType<OccPlanningOptionsSourceData>(optionsResult.Options);
            Assert.Equal("DEV-CONTRACT-0001", options.Contract?.Code);
            Assert.Equal("BAGGAGE", Assert.Single(options.Services).Code);
            Assert.DoesNotContain(options.AgentCandidates, candidate =>
                candidate.EmployeeNumber is
                    "DEV-RA-EXPIRED" or
                    "DEV-RA-FUTURE" or
                    "DEV-RA-WRONG-TERMINAL" or
                    "DEV-RA-WRONG-TIME" or
                    "DEV-RA-EQUAL-SHIFT" ||
                candidate.DisplayName is
                    "Expired Scope" or
                    "Future Scope" or
                    "Wrong Terminal" or
                    "Wrong Time" or
                    "Equal Shift");
            var rileyCandidate = Assert.Single(
                options.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.True(rileyCandidate.IsActive);
            Assert.True(rileyCandidate.HasMobileAccount);
            Assert.True(rileyCandidate.HasStationScope);
            Assert.True(rileyCandidate.HasTerminalScope);
            Assert.True(rileyCandidate.HasCurrentQualification);
            Assert.True(rileyCandidate.HasCurrentAirportId);
            Assert.True(rileyCandidate.HasCurrentRampDriverLicense);
            Assert.True(rileyCandidate.HasCompatibleShift);

            var shiftOnlyCandidate = Assert.Single(
                options.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-SHIFT-ONLY");
            Assert.False(shiftOnlyCandidate.HasStationScope);
            Assert.True(shiftOnlyCandidate.HasTerminalScope);
            Assert.True(shiftOnlyCandidate.HasCompatibleShift);
            var shiftOnlyEligibility = OccAgentEligibilityPolicy.Evaluate(shiftOnlyCandidate);
            Assert.False(shiftOnlyEligibility.Eligible);
            Assert.Contains("station_scope_missing", shiftOnlyEligibility.EligibilityReasons);
            Assert.DoesNotContain("shift_not_compatible", shiftOnlyEligibility.EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.Set<StandAssignment>()
                    .Where(assignment => assignment.Id == planningStand.AssignmentInternalId)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            assignment => assignment.StandId,
                            crossStand.Id),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var crossStationSnapshot = await readStore.GetSnapshotAsync(
                stationPublicId,
                new DateOnly(2026, 8, 19),
                cancellationToken);
            var crossStationPlanningItem = Assert.Single(
                Assert.IsType<OccPlanningSnapshotData>(crossStationSnapshot).Turnarounds);
            Assert.Null(crossStationPlanningItem.Stand);

            var crossStationOptionsResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var crossStationOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                crossStationOptionsResult.Options);
            Assert.Null(crossStationOptions.Turnaround.Stand);
            var crossStationRiley = Assert.Single(crossStationOptions.AgentCandidates);
            Assert.Equal("DEV-RA-001", crossStationRiley.EmployeeNumber);
            Assert.True(crossStationRiley.HasStationScope);
            Assert.False(crossStationRiley.HasTerminalScope);
            Assert.False(crossStationRiley.HasCompatibleShift);
            var crossStationEligibility = OccAgentEligibilityPolicy.Evaluate(crossStationRiley);
            Assert.Contains("terminal_scope_missing", crossStationEligibility.EligibilityReasons);
            Assert.Contains("shift_not_compatible", crossStationEligibility.EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                var changed = await administratorContext.Set<StandAssignment>()
                    .Where(assignment => assignment.Id == planningStand.AssignmentInternalId)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            assignment => assignment.StandId,
                            planningStand.StandInternalId),
                        cancellationToken);
                Assert.Equal(1, changed);
            }

            var outOfScope = await readStore.GetOptionsAsync(
                [Guid.NewGuid()],
                Guid.Parse("70000000-0000-7000-8000-000000000012"),
                cancellationToken);
            Assert.False(outOfScope.IsSuccess);
            Assert.Equal(OccPlanningOptionsReadFailure.NotFound, outOfScope.Failure);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                await administratorContext.Users
                    .Where(account => account.NormalizedEmail == "RAMP.AGENT@DEV.ELEVANT.TEST")
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            account => account.LockoutEnd,
                            new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero)),
                        cancellationToken);
            }

            var lockedResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var lockedOptions = Assert.IsType<OccPlanningOptionsSourceData>(lockedResult.Options);
            var lockedRiley = Assert.Single(
                lockedOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.False(lockedRiley.HasMobileAccount);
            Assert.Contains(
                "mobile_account_unavailable",
                OccAgentEligibilityPolicy.Evaluate(lockedRiley).EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                await administratorContext.Users
                    .Where(account => account.NormalizedEmail == "RAMP.AGENT@DEV.ELEVANT.TEST")
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            account => account.LockoutEnd,
                            (DateTimeOffset?)null),
                        cancellationToken);
                await administratorContext.AirportPermitCycles
                    .Where(permit =>
                        permit.PublicId == Guid.Parse("50000000-0000-7000-8000-000000000003"))
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            permit => permit.ExpiresOn,
                            new DateOnly(2026, 8, 18)),
                        cancellationToken);
            }

            var expiredPermitResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            var expiredPermitOptions = Assert.IsType<OccPlanningOptionsSourceData>(
                expiredPermitResult.Options);
            var expiredPermitRiley = Assert.Single(
                expiredPermitOptions.AgentCandidates,
                candidate => candidate.EmployeeNumber == "DEV-RA-001");
            Assert.False(expiredPermitRiley.HasCurrentAirportId);
            Assert.Contains(
                "airport_id_not_current",
                OccAgentEligibilityPolicy.Evaluate(expiredPermitRiley).EligibilityReasons);

            await using (var administratorContext = CreateContext(database.ConnectionString))
            {
                await administratorContext.AirportPermitCycles
                    .Where(permit =>
                        permit.PublicId == Guid.Parse("50000000-0000-7000-8000-000000000003"))
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            permit => permit.ExpiresOn,
                            new DateOnly(2099, 12, 31)),
                        cancellationToken);
            }

            var noTimeTurnaround = new Turnaround
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000101"),
                OperationCode = "DEV-TAT-NO-TIME",
                AirlineId = planningTurnaround.AirlineId,
                StationId = planningTurnaround.StationId,
                OperationDate = new DateOnly(2026, 8, 19),
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.Turnarounds.Add(noTimeTurnaround);
            await context.SaveChangesAsync(cancellationToken);

            var noTimeResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                noTimeTurnaround.PublicId,
                cancellationToken);
            var noTimeOptions = Assert.IsType<OccPlanningOptionsSourceData>(noTimeResult.Options);
            Assert.Equal(
                new DateTimeOffset(2026, 8, 19, 4, 0, 0, TimeSpan.Zero),
                noTimeOptions.Turnaround.ReferenceTime);

            var conflictingContract = new Contract
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000201"),
                AirlineId = planningTurnaround.AirlineId,
                ContractCode = "DEV-CONTRACT-OVERLAP",
                Status = ContractStatus.Active,
                SignedOn = new DateOnly(2026, 1, 1),
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.Contracts.Add(conflictingContract);
            await context.SaveChangesAsync(cancellationToken);
            var conflictingVersion = new ContractVersion
            {
                PublicId = Guid.Parse("90000000-0000-7000-8000-000000000202"),
                ContractId = conflictingContract.Id,
                VersionNumber = 1,
                Status = ContractVersionStatus.Approved,
                ValidFrom = new DateOnly(2026, 1, 1),
                ValidTo = new DateOnly(2099, 12, 31),
                CurrencyCode = "USD",
                ApprovedAt = testInstant,
                CreatedAt = testInstant,
                UpdatedAt = testInstant,
            };
            context.ContractVersions.Add(conflictingVersion);
            await context.SaveChangesAsync(cancellationToken);
            context.Set<ContractVersionStation>().Add(new ContractVersionStation
            {
                ContractVersionId = conflictingVersion.Id,
                StationId = station.Id,
            });
            await context.SaveChangesAsync(cancellationToken);

            var conflictResult = await readStore.GetOptionsAsync(
                [stationPublicId],
                planningTurnaround.PublicId,
                cancellationToken);
            Assert.False(conflictResult.IsSuccess);
            Assert.Null(conflictResult.Options);
            Assert.Equal(OccPlanningOptionsReadFailure.ContractConflict, conflictResult.Failure);
        }

        var initialAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.All(initialAccounts.Values, account => Assert.True(account.LockoutEnabled));
        AssertPasswordSet(initialAccounts, InitialPasswords);
        var initialCredentialState = initialAccounts.ToDictionary(
            pair => pair.Key,
            pair => (pair.Value.PasswordHash, pair.Value.SecurityStamp),
            StringComparer.Ordinal);

        var driftedPublicId = Guid.CreateVersion7();
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [public_id] = {driftedPublicId}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        context.ChangeTracker.Clear();
        var identityDrift = await Assert.ThrowsAsync<InvalidOperationException>(
            () => seeder.SeedAsync(RotatedPasswords, cancellationToken));
        Assert.Contains("identity drift", identityDrift.Message, StringComparison.OrdinalIgnoreCase);
        context.ChangeTracker.Clear();
        var driftedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.Equal(driftedPublicId, driftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PublicId);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            driftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp,
            driftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp);

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlRawAsync(
                "UPDATE [iam].[accounts] SET [public_id] = '40000000-0000-7000-8000-000000000001' WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';",
                cancellationToken);
        }
        context.ChangeTracker.Clear();

        long driftPersonId;
        var expectedAdminPersonId = initialAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PersonId;
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            var driftPerson = new Person
            {
                PublicId = Guid.CreateVersion7(),
                FirstName = "Identity",
                LastName = "Drift",
                PrimaryEmail = "identity.drift@dev.elevant.test",
                IdentificationType = "Synthetic",
                IdentificationNumber = "DEV-DRIFT-001",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            administratorContext.Persons.Add(driftPerson);
            await administratorContext.SaveChangesAsync(cancellationToken);
            driftPersonId = driftPerson.Id;
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [person_id] = {driftPersonId}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        var procedurePersonDrift = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52103, procedurePersonDrift.Number);
        var accountPersonDrift = await Assert.ThrowsAsync<InvalidOperationException>(
            () => seeder.SeedAsync(RotatedPasswords, cancellationToken));
        Assert.Contains("identity drift", accountPersonDrift.Message, StringComparison.OrdinalIgnoreCase);
        context.ChangeTracker.Clear();
        var personDriftedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.Equal(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            personDriftedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [person_id] = {expectedAdminPersonId}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                DELETE FROM [iam].[persons] WHERE [id] = {driftPersonId};
                """,
                cancellationToken);
        }
        context.ChangeTracker.Clear();

        var organizationCount = await context.Organizations.CountAsync(cancellationToken);
        var accountCount = await context.Users.CountAsync(cancellationToken);
        var turnaroundCount = await context.Turnarounds.CountAsync(cancellationToken);

        context.ServiceDefinitions.Add(new ServiceDefinition
        {
            PublicId = Guid.CreateVersion7(),
            Code = "USER-SENTINEL",
            Name = "Existing row preserved by seed",
            DefaultBillingUnit = "test",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync(cancellationToken);

        var preservedLockoutEnd = new DateTimeOffset(2099, 12, 30, 12, 34, 56, TimeSpan.Zero);
        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [lockout_enabled] = {false},
                    [access_failed_count] = {4},
                    [lockout_end] = {preservedLockoutEnd}
                WHERE [normalized_email] = {"ADMIN.OCC@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        context.ChangeTracker.Clear();
        await seeder.SeedAsync(InitialPasswords, cancellationToken);

        Assert.Equal(organizationCount, await context.Organizations.CountAsync(cancellationToken));
        Assert.Equal(accountCount, await context.Users.CountAsync(cancellationToken));
        Assert.Equal(turnaroundCount, await context.Turnarounds.CountAsync(cancellationToken));
        Assert.True(await context.ServiceDefinitions.AnyAsync(
            item => item.Code == "USER-SENTINEL",
            cancellationToken));

        context.ChangeTracker.Clear();
        var repeatedAccounts = await LoadAccountsAsync(context, cancellationToken);
        AssertPasswordSet(repeatedAccounts, InitialPasswords);
        Assert.All(initialCredentialState, pair =>
        {
            Assert.Equal(pair.Value.PasswordHash, repeatedAccounts[pair.Key].PasswordHash);
            Assert.Equal(pair.Value.SecurityStamp, repeatedAccounts[pair.Key].SecurityStamp);
        });
        Assert.Equal(4, repeatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].AccessFailedCount);
        Assert.Equal(preservedLockoutEnd, repeatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].LockoutEnd);

        await seeder.SeedAsync(RotatedPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var rotatedAccounts = await LoadAccountsAsync(context, cancellationToken);
        AssertPasswordSet(rotatedAccounts, RotatedPasswords);
        Assert.NotEqual(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.NotEqual(
            initialCredentialState["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp,
            rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(
            initialCredentialState["RAMP.AGENT@DEV.ELEVANT.TEST"].PasswordHash,
            rotatedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["RAMP.AGENT@DEV.ELEVANT.TEST"].SecurityStamp,
            rotatedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(
            initialCredentialState["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash,
            rotatedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            initialCredentialState["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].SecurityStamp,
            rotatedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(4, rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].AccessFailedCount);
        Assert.Equal(preservedLockoutEnd, rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].LockoutEnd);

        var legacyRampAccount = rotatedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"];
        var legacyHasher = new PasswordHasher<ApplicationUser>(Options.Create(new PasswordHasherOptions
        {
            CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV2,
        }));
        var legacyHash = legacyHasher.HashPassword(legacyRampAccount, RotatedPasswords.RampAgent);
        var legacySecurityStamp = Guid.NewGuid().ToString("D");
        var runtimeHasher = new PasswordHasher<ApplicationUser>();
        Assert.Equal(
            PasswordVerificationResult.SuccessRehashNeeded,
            runtimeHasher.VerifyHashedPassword(legacyRampAccount, legacyHash, RotatedPasswords.RampAgent));

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            await administratorContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE [iam].[accounts]
                SET [password_hash] = {legacyHash},
                    [security_stamp] = {legacySecurityStamp}
                WHERE [normalized_email] = {"RAMP.AGENT@DEV.ELEVANT.TEST"};
                """,
                cancellationToken);
        }

        context.ChangeTracker.Clear();
        await seeder.SeedAsync(RotatedPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var rehashedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.NotEqual(legacyHash, rehashedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.NotEqual(legacySecurityStamp, rehashedAccounts["RAMP.AGENT@DEV.ELEVANT.TEST"].SecurityStamp);
        Assert.Equal(
            rotatedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash,
            rehashedAccounts["ADMIN.OCC@DEV.ELEVANT.TEST"].PasswordHash);
        Assert.Equal(
            rotatedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash,
            rehashedAccounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"].PasswordHash);

        var rehashedCredentialState = rehashedAccounts.ToDictionary(
            pair => pair.Key,
            pair => (pair.Value.PasswordHash, pair.Value.SecurityStamp),
            StringComparer.Ordinal);
        await seeder.SeedAsync(RotatedPasswords, cancellationToken);
        context.ChangeTracker.Clear();
        var repeatedRehashedAccounts = await LoadAccountsAsync(context, cancellationToken);
        Assert.All(rehashedCredentialState, pair =>
        {
            Assert.Equal(pair.Value.PasswordHash, repeatedRehashedAccounts[pair.Key].PasswordHash);
            Assert.Equal(pair.Value.SecurityStamp, repeatedRehashedAccounts[pair.Key].SecurityStamp);
        });

        var unauthorizedAccount = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'OUTSIDER@DEV.ELEVANT.TEST', '49999999-0000-7000-8000-000000000999', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52101, unauthorizedAccount.Number);

        var mismatchedPublicId = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '49999999-0000-7000-8000-000000000999', NULL, NULL;",
                cancellationToken));
        Assert.Equal(52101, mismatchedPublicId.Number);

        var directUpdate = await Assert.ThrowsAsync<SqlException>(() =>
            context.Database.ExecuteSqlRawAsync(
                "UPDATE [iam].[accounts] SET [lockout_enabled] = 0 WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';",
                cancellationToken));
        Assert.Equal(229, directUpdate.Number);

        await using (var appConnection = await database.OpenAsDevelopmentAppAsync(cancellationToken))
        await using (var appContext = CreateContext(appConnection))
        {
            var appProcedureAccess = await Assert.ThrowsAsync<SqlException>(() =>
                appContext.Database.ExecuteSqlRawAsync(
                    "EXEC [iam].[set_development_account_credential] N'ADMIN.OCC@DEV.ELEVANT.TEST', '40000000-0000-7000-8000-000000000001', NULL, NULL;",
                    cancellationToken));
            Assert.Equal(229, appProcedureAccess.Number);
        }

        await using (var administratorContext = CreateContext(database.ConnectionString))
        {
            var duplicateNormalizedEmail = await Assert.ThrowsAsync<SqlException>(() =>
                administratorContext.Database.ExecuteSqlRawAsync(
                    "UPDATE [iam].[accounts] SET [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST' WHERE [normalized_email] = N'RAMP.AGENT@DEV.ELEVANT.TEST';",
                    cancellationToken));
            Assert.True(duplicateNormalizedEmail.Number is 2601 or 2627);
        }
    }

    [Fact]
    public async Task AuthenticationAdaptersEnforceLockoutIdentityCasAndEffectiveScopes()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null)
        {
            return;
        }

        await using var database = await TemporaryDatabase.CreateAsync(
            masterConnection,
            "Development",
            cancellationToken);
        await using (var migrationContext = CreateContext(database.ConnectionString))
        {
            await migrationContext.Database.MigrateAsync(cancellationToken);
        }

        await database.ConfigureDevelopmentSeederPermissionsAsync(cancellationToken);
        await using (var seederConnection = await database.OpenAsDevelopmentSeederAsync(cancellationToken))
        await using (var seederContext = CreateContext(seederConnection))
        {
            await new DevelopmentDataSeeder(seederContext).SeedAsync(
                InitialPasswords,
                cancellationToken);
        }

        var passwordCounter = new PasswordHashCounter();
        await using var provider = CreateAuthenticationProvider(
            database.ConnectionString,
            passwordCounter);
        var adminPublicId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        const string adminEmail = "admin.occ@dev.elevant.test";

        var verifications = passwordCounter.VerificationCount;
        Assert.Null(await VerifyAsync(
            provider,
            "unknown@dev.elevant.test",
            InitialPasswords.AdminOcc,
            cancellationToken));
        Assert.Equal(verifications + 1, passwordCounter.VerificationCount);

        verifications = passwordCounter.VerificationCount;
        var credential = await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken);
        Assert.NotNull(credential);
        Assert.Equal(adminPublicId, credential.AccountId);
        Assert.Equal(verifications + 1, passwordCounter.VerificationCount);

        var actor = await ResolveActorAsync(provider, adminPublicId, cancellationToken);
        Assert.NotNull(actor);
        Assert.NotEmpty(actor.Roles);
        Assert.NotEmpty(actor.Memberships);
        Assert.NotEmpty(actor.StationScopes);

        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => VerifyAsync(
            provider,
            adminEmail,
            "Wrong-DevelopmentPassword!2026",
            cancellationToken)));

        await using (var lockedContext = CreateContext(database.ConnectionString))
        {
            var locked = await lockedContext.Users
                .AsNoTracking()
                .SingleAsync(account => account.PublicId == adminPublicId, cancellationToken);
            Assert.NotNull(locked.LockoutEnd);
            Assert.True(locked.LockoutEnd > TimeProvider.System.GetUtcNow());
            Assert.Equal(0, locked.AccessFailedCount);
        }

        Assert.Null(await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken));

        await using (var expirationContext = CreateContext(database.ConnectionString))
        {
            var expiredAt = TimeProvider.System.GetUtcNow().AddMinutes(-1);
            await expirationContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(account => account.LockoutEnd, expiredAt)
                        .SetProperty(account => account.AccessFailedCount, 3),
                    cancellationToken);
        }

        Assert.NotNull(await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken));
        await using (var resetContext = CreateContext(database.ConnectionString))
        {
            var reset = await resetContext.Users
                .AsNoTracking()
                .SingleAsync(account => account.PublicId == adminPublicId, cancellationToken);
            Assert.Null(reset.LockoutEnd);
            Assert.Equal(0, reset.AccessFailedCount);
            Assert.NotNull(reset.LastLoginAt);
        }

        var driftedPublicId = Guid.CreateVersion7();
        using var verificationGate = passwordCounter.PauseOnceAfterVerification();
        var verificationTask = Task.Run(
            () => VerifyAsync(
                provider,
                adminEmail,
                InitialPasswords.AdminOcc,
                cancellationToken),
            cancellationToken);
        var observation = await verificationGate.Reached.WaitAsync(
            TimeSpan.FromSeconds(10),
            cancellationToken);
        Assert.NotEqual(PasswordVerificationResult.Failed, observation.Result);
        try
        {
            await UpdateAccountPublicIdAsync(
                database.ConnectionString,
                observation.AccountId,
                driftedPublicId,
                cancellationToken);
        }
        finally
        {
            verificationGate.Release();
        }

        Assert.Null(await verificationTask);
        await UpdateAccountPublicIdAsync(
            database.ConnectionString,
            accountId: null,
            adminPublicId,
            cancellationToken);

        await using (var secondFactorContext = CreateContext(database.ConnectionString))
        {
            await secondFactorContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(account => account.TwoFactorEnabled, true),
                    cancellationToken);
        }

        Assert.Null(await VerifyAsync(
            provider,
            adminEmail,
            InitialPasswords.AdminOcc,
            cancellationToken));
        Assert.Null(await ResolveActorAsync(provider, adminPublicId, cancellationToken));

        await using (var scopeContext = CreateContext(database.ConnectionString))
        {
            await scopeContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(account => account.TwoFactorEnabled, false),
                    cancellationToken);
            var adminId = await scopeContext.Users
                .Where(account => account.PublicId == adminPublicId)
                .Select(account => account.Id)
                .SingleAsync(cancellationToken);
            await scopeContext.OrganizationMemberships
                .Where(membership => membership.AccountId == adminId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        membership => membership.Status,
                        MembershipStatus.Suspended),
                    cancellationToken);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var resolver = scope.ServiceProvider.GetRequiredService<IActorContextResolver>();
            var currentSession = await new GetCurrentSessionHandler(resolver).HandleAsync(
                new GetCurrentSessionQuery(adminPublicId),
                cancellationToken);
            Assert.False(currentSession.IsSuccess);
        }
    }

    private static ServiceProvider CreateAuthenticationProvider(
        string connectionString,
        PasswordHashCounter passwordCounter)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ElevantDatabase"] = connectionString,
            })
            .Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddPersistence(configuration);
        services.AddSingleton(passwordCounter);
        services.AddScoped<IPasswordHasher<ApplicationUser>>(_ =>
            new CountingPasswordHasher(passwordCounter));
        return services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateOnBuild = true,
            ValidateScopes = true,
        });
    }

    private static async Task<VerifiedCredential?> VerifyAsync(
        ServiceProvider provider,
        string email,
        string password,
        CancellationToken cancellationToken)
    {
        await using var scope = provider.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<ICredentialVerifier>()
            .VerifyAsync(email, password, cancellationToken);
    }

    private static async Task<ActorContext?> ResolveActorAsync(
        ServiceProvider provider,
        Guid accountId,
        CancellationToken cancellationToken)
    {
        await using var scope = provider.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IActorContextResolver>()
            .ResolveAsync(accountId, cancellationToken);
    }

    private static async Task UpdateAccountPublicIdAsync(
        string connectionString,
        long? accountId,
        Guid publicId,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = accountId is null
            ? "UPDATE [iam].[accounts] SET [public_id] = @publicId WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';"
            : "UPDATE [iam].[accounts] SET [public_id] = @publicId WHERE [id] = @accountId;";
        command.Parameters.AddWithValue("@publicId", publicId);
        if (accountId is not null)
        {
            command.Parameters.AddWithValue("@accountId", accountId.Value);
        }

        Assert.Equal(1, await command.ExecuteNonQueryAsync(cancellationToken));
    }

    private sealed class PasswordHashCounter
    {
        private PasswordVerificationGate? verificationGate;
        private int verificationCount;

        public int VerificationCount => Volatile.Read(ref verificationCount);

        public void Count() => Interlocked.Increment(ref verificationCount);

        public PasswordVerificationGate PauseOnceAfterVerification()
        {
            var gate = new PasswordVerificationGate();
            if (Interlocked.CompareExchange(ref verificationGate, gate, null) is not null)
            {
                gate.Dispose();
                throw new InvalidOperationException("A password verification gate is already armed.");
            }

            return gate;
        }

        public void CompleteVerification(
            ApplicationUser user,
            PasswordVerificationResult result) =>
            Interlocked.Exchange(ref verificationGate, null)?.Pause(user.Id, result);
    }

    private sealed class PasswordVerificationGate : IDisposable
    {
        private readonly TaskCompletionSource<PasswordVerificationObservation> reached = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly ManualResetEventSlim release = new(initialState: false);

        public Task<PasswordVerificationObservation> Reached => reached.Task;

        public void Release() => release.Set();

        public void Dispose()
        {
            release.Set();
            release.Dispose();
        }

        public void Pause(long accountId, PasswordVerificationResult result)
        {
            reached.TrySetResult(new PasswordVerificationObservation(accountId, result));
            release.Wait();
        }
    }

    private sealed record PasswordVerificationObservation(
        long AccountId,
        PasswordVerificationResult Result);

    private sealed class CountingPasswordHasher(PasswordHashCounter counter)
        : IPasswordHasher<ApplicationUser>
    {
        private readonly PasswordHasher<ApplicationUser> inner = new();

        public string HashPassword(ApplicationUser user, string password) =>
            inner.HashPassword(user, password);

        public PasswordVerificationResult VerifyHashedPassword(
            ApplicationUser user,
            string hashedPassword,
            string providedPassword)
        {
            counter.Count();
            var result = inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
            counter.CompleteVerification(user, result);
            return result;
        }
    }

    private static async Task<Dictionary<string, ApplicationUser>> LoadAccountsAsync(
        ElevantDbContext context,
        CancellationToken cancellationToken) => await context.Users
        .AsNoTracking()
        .Where(account => account.NormalizedEmail != null)
        .ToDictionaryAsync(
            account => account.NormalizedEmail!,
            StringComparer.Ordinal,
            cancellationToken);

    private static void AssertPasswordSet(
        Dictionary<string, ApplicationUser> accounts,
        DevelopmentAccountPasswords passwords)
    {
        Assert.Equal(3, accounts.Count);
        AssertPassword(
            accounts["ADMIN.OCC@DEV.ELEVANT.TEST"],
            passwords.AdminOcc,
            passwords.RampAgent,
            passwords.AirlineClient);
        AssertPassword(
            accounts["RAMP.AGENT@DEV.ELEVANT.TEST"],
            passwords.RampAgent,
            passwords.AdminOcc,
            passwords.AirlineClient);
        AssertPassword(
            accounts["AIRLINE.CLIENT@DEV.ELEVANT.TEST"],
            passwords.AirlineClient,
            passwords.AdminOcc,
            passwords.RampAgent);
    }

    private static void AssertPassword(
        ApplicationUser account,
        string expected,
        params string[] rejected)
    {
        Assert.True(account.LockoutEnabled);
        Assert.False(string.IsNullOrWhiteSpace(account.PasswordHash));
        var hasher = new PasswordHasher<ApplicationUser>();
        Assert.NotEqual(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(account, account.PasswordHash!, expected));
        Assert.All(rejected, candidate => Assert.Equal(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(account, account.PasswordHash!, candidate)));
    }

    private static ElevantDbContext CreateContext(string connectionString)
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connectionString, ElevantSqlServerOptions.Configure)
            .Options;
        return new ElevantDbContext(options);
    }

    private static RampAgent NewTestAgent(
        long personId,
        string employeeNumber,
        string publicId,
        DateTimeOffset instant) => new()
        {
            PublicId = Guid.Parse(publicId),
            PersonId = personId,
            EmployeeNumber = employeeNumber,
            Category = "Development test",
            HireDate = new DateOnly(2026, 1, 1),
            IsActive = true,
            CreatedAt = instant,
            UpdatedAt = instant,
        };

    private static ElevantDbContext CreateContext(SqlConnection connection)
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connection, ElevantSqlServerOptions.Configure)
            .Options;
        return new ElevantDbContext(options);
    }

    private static string? ResolveMasterConnection()
    {
        var configured = Environment.GetEnvironmentVariable(MasterConnectionEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        return OperatingSystem.IsWindows()
            ? "Server=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=30"
            : null;
    }

    private sealed class TemporaryDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _databaseName;

        private TemporaryDatabase(string masterConnectionString, string databaseName, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _databaseName = databaseName;
            ConnectionString = connectionString;
        }

        public string ConnectionString { get; }

        public async Task ConfigureDevelopmentSeederPermissionsAsync(CancellationToken cancellationToken)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                GRANT SELECT, INSERT ON SCHEMA::[iam] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[ref] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[hr] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[commercial] TO [elevant_seeder_role];
                GRANT SELECT, INSERT ON SCHEMA::[ops] TO [elevant_seeder_role];
                REVOKE UPDATE, DELETE, EXECUTE ON SCHEMA::[iam] FROM [elevant_seeder_role];
                GRANT SELECT ON OBJECT::[infra].[database_instances] TO [elevant_test_seeder];
                GRANT EXECUTE ON SCHEMA::[iam] TO [elevant_app_role];
                """;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        public Task<SqlConnection> OpenAsDevelopmentSeederAsync(CancellationToken cancellationToken) =>
            OpenAsUserAsync("elevant_test_seeder", cancellationToken);

        public Task<SqlConnection> OpenAsDevelopmentAppAsync(CancellationToken cancellationToken) =>
            OpenAsUserAsync("elevant_test_app", cancellationToken);

        private async Task<SqlConnection> OpenAsUserAsync(
            string userName,
            CancellationToken cancellationToken)
        {
            var impersonatedConnectionString = new SqlConnectionStringBuilder(ConnectionString)
            {
                Pooling = false,
            }.ConnectionString;
            var connection = new SqlConnection(impersonatedConnectionString);
            try
            {
                await connection.OpenAsync(cancellationToken);
                await using var command = connection.CreateCommand();
                command.CommandText = $"EXECUTE AS USER = N'{userName}';";
                await command.ExecuteNonQueryAsync(cancellationToken);
                return connection;
            }
            catch
            {
                await connection.DisposeAsync();
                throw;
            }
        }

        public static async Task<TemporaryDatabase> CreateAsync(
            string masterConnectionString,
            string environmentName,
            CancellationToken cancellationToken)
        {
            var databaseName = $"ElevantDbV1Test_{Guid.NewGuid():N}";
            var quotedName = QuoteIdentifier(databaseName);

            await using (var master = new SqlConnection(masterConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var create = master.CreateCommand();
                create.CommandText = $"CREATE DATABASE {quotedName};";
                await create.ExecuteNonQueryAsync(cancellationToken);
            }

            try
            {
                var databaseBuilder = new SqlConnectionStringBuilder(masterConnectionString)
                {
                    InitialCatalog = databaseName,
                };

                await using (var database = new SqlConnection(databaseBuilder.ConnectionString))
                {
                    await database.OpenAsync(cancellationToken);
                    await using (var createSchema = database.CreateCommand())
                    {
                        createSchema.CommandText = "CREATE SCHEMA [infra];";
                        await createSchema.ExecuteNonQueryAsync(cancellationToken);
                    }

                    await using var bootstrap = database.CreateCommand();
                    bootstrap.CommandText = """
                        CREATE TABLE [infra].[database_instances]
                        (
                            [id] tinyint NOT NULL CONSTRAINT [pk_database_instances] PRIMARY KEY,
                            [instance_id] uniqueidentifier NOT NULL,
                            [environment_name] nvarchar(32) NOT NULL,
                            [created_at] datetimeoffset(3) NOT NULL,
                            CONSTRAINT [ck_database_instances_singleton] CHECK ([id] = 1),
                            CONSTRAINT [ck_database_instances_environment] CHECK ([environment_name] IN (N'Development', N'Production'))
                        );
                        INSERT INTO [infra].[database_instances] ([id], [instance_id], [environment_name], [created_at])
                        VALUES (1, @instanceId, @environmentName, SYSUTCDATETIME());
                        """;
                    bootstrap.Parameters.AddWithValue("@instanceId", Guid.NewGuid());
                    bootstrap.Parameters.AddWithValue("@environmentName", environmentName);
                    await bootstrap.ExecuteNonQueryAsync(cancellationToken);

                    if (string.Equals(environmentName, "Development", StringComparison.Ordinal))
                    {
                        await using var createSeeder = database.CreateCommand();
                        createSeeder.CommandText = """
                            CREATE ROLE [elevant_seeder_role] AUTHORIZATION [dbo];
                            CREATE ROLE [elevant_app_role] AUTHORIZATION [dbo];
                            CREATE USER [elevant_test_seeder] WITHOUT LOGIN;
                            CREATE USER [elevant_test_app] WITHOUT LOGIN;
                            ALTER ROLE [elevant_seeder_role] ADD MEMBER [elevant_test_seeder];
                            ALTER ROLE [elevant_app_role] ADD MEMBER [elevant_test_app];
                            """;
                        await createSeeder.ExecuteNonQueryAsync(cancellationToken);
                    }
                }

                return new TemporaryDatabase(masterConnectionString, databaseName, databaseBuilder.ConnectionString);
            }
            catch
            {
                await DropDatabaseAsync(masterConnectionString, databaseName);
                throw;
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (!_databaseName.StartsWith("ElevantDbV1Test_", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Refusing to remove a database outside the test namespace.");
            }

            await DropDatabaseAsync(_masterConnectionString, _databaseName);
        }

        private static async Task DropDatabaseAsync(string masterConnectionString, string databaseName)
        {
            if (!databaseName.StartsWith("ElevantDbV1Test_", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Refusing to remove a database outside the test namespace.");
            }

            SqlConnection.ClearAllPools();
            await using var master = new SqlConnection(masterConnectionString);
            await master.OpenAsync();
            await using var drop = master.CreateCommand();
            var quotedName = QuoteIdentifier(databaseName);
            drop.CommandText = $"IF DB_ID(@databaseName) IS NOT NULL BEGIN ALTER DATABASE {quotedName} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE {quotedName}; END";
            drop.Parameters.AddWithValue("@databaseName", databaseName);
            await drop.ExecuteNonQueryAsync();
        }

        private static string QuoteIdentifier(string value) => $"[{value.Replace("]", "]]", StringComparison.Ordinal)}]";
    }
}
