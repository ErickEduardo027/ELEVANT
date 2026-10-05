using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
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
    public async Task HumanResourcesExpirationsRequireLiveRoleAndStationGrant()
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
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(
                InitialPasswords.AdminOcc, InitialPasswords.RampAgent,
                InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance,
                "Synthetic-SuperAdmin!234"), cancellationToken);

        var clock = new SteppingReportTimeProvider();
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton<TimeProvider>(clock)
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<IHumanResourcesReportStore>();
        var stationId = await context.Stations.Where(item => item.Code == "PUJ")
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        var from = new DateOnly(2099, 12, 2);
        var to = new DateOnly(2099, 12, 31);
        var hrId = Guid.Parse("40000000-0000-7000-8000-000000000004");
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");

        var own = await store.ListExpirationsAsync(hrId, stationId, from, to,
            1, 20, cancellationToken: cancellationToken);
        Assert.Null(own.Failure);
        Assert.Equal(3, own.Page!.Rows.Count);
        Assert.All(own.Page.Rows, row => Assert.Equal(new DateOnly(2099, 12, 31), row.ExpiresOn));
        var qualifications = await store.ListExpirationsAsync(hrId, stationId,
            from, to, 1, 20, "Qualification", cancellationToken: cancellationToken);
        Assert.Equal(own.Page.Rows.Count(row => row.Kind == "Qualification"),
            qualifications.Page!.Rows.Count);
        Assert.All(qualifications.Page.Rows, row => Assert.Equal("Qualification", row.Kind));
        var permits = await store.ListExpirationsAsync(hrId, stationId,
            from, to, 1, 20, "Permit", cancellationToken: cancellationToken);
        Assert.Equal(own.Page.Rows.Count(row => row.Kind == "Permit"),
            permits.Page!.Rows.Count);
        var expired = await store.ListExpirationsAsync(hrId, stationId,
            from, to, 1, 20, validity: "Expired", cancellationToken: cancellationToken);
        Assert.Empty(expired.Page!.Rows);

        var wrongStation = await store.ListExpirationsAsync(hrId, Guid.NewGuid(),
            from, to, 1, 20, cancellationToken: cancellationToken);
        Assert.Equal(HumanResourcesReportFailure.ForbiddenStation, wrongStation.Failure);
        var wrongRole = await store.ListExpirationsAsync(occId, stationId,
            from, to, 1, 20, cancellationToken: cancellationToken);
        Assert.Equal(HumanResourcesReportFailure.ForbiddenRole, wrongRole.Failure);

        var shifts = await store.ListStaffDistributionAsync(hrId, stationId,
            new DateOnly(2026, 8, 18), new DateOnly(2026, 8, 19),
            1, 1, cancellationToken);
        Assert.Null(shifts.Failure);
        Assert.True(shifts.Page!.HasMore);
        Assert.Single(shifts.Page.Rows);
        Assert.Equal(new DateOnly(2026, 8, 18), shifts.Page.Rows[0].WorkDate);
        var secondShift = await store.ListStaffDistributionAsync(hrId, stationId,
            new DateOnly(2026, 8, 18), new DateOnly(2026, 8, 19),
            2, 1, cancellationToken);
        Assert.False(secondShift.Page!.HasMore);
        Assert.Equal(new DateOnly(2026, 8, 19), Assert.Single(secondShift.Page.Rows).WorkDate);

        var coverage = await store.ListQualificationCoverageAsync(hrId, stationId,
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 5),
            1, 20, cancellationToken);
        Assert.Null(coverage.Failure);
        Assert.Equal(new DateOnly(2026, 10, 1), coverage.Page!.From);
        Assert.Equal(new DateOnly(2026, 10, 5), coverage.Page.To);
        var gpu = Assert.Single(coverage.Page!.Rows);
        Assert.Equal("GPU", gpu.EquipmentCode);
        Assert.Equal(1, gpu.EligibleAgents);
        Assert.Equal(1, gpu.QualifiedAgents);

        var stationInternalId = await context.Stations.Where(item => item.PublicId == stationId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var agentAccountId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        context.AuditEntries.AddRange(
            new AuditEntry
            {
                PublicId = Guid.CreateVersion7(),
                OccurredAt = new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero),
                ActorType = AuditActorType.Account,
                Action = "governance.user.created", EntityType = "iam.accounts",
                EntityPublicId = agentAccountId, StationId = stationInternalId,
                Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            },
            new AuditEntry
            {
                PublicId = Guid.CreateVersion7(),
                OccurredAt = new DateTimeOffset(2026, 10, 5, 13, 0, 0, TimeSpan.Zero),
                ActorType = AuditActorType.Account,
                Action = "governance.user.password_reset", EntityType = "iam.accounts",
                EntityPublicId = agentAccountId, StationId = stationInternalId,
                Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            });
        await context.SaveChangesAsync(cancellationToken);

        var movements = await store.ListAccountMovementsAsync(hrId, stationId,
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 30),
            1, 20, cancellationToken);
        Assert.Null(movements.Failure);
        var movement = Assert.Single(movements.Page!.Rows);
        Assert.Equal(agentAccountId, movement.AccountId);
        Assert.Equal("Created", movement.Kind);
        var finalCalendarDay = await store.ListAccountMovementsAsync(hrId, stationId,
            DateOnly.MaxValue, DateOnly.MaxValue, 1, 20, cancellationToken);
        Assert.Empty(finalCalendarDay.Page!.Rows);

        var agentInternalId = await context.RampAgents.Where(item =>
            item.PublicId == Guid.Parse("50000000-0000-7000-8000-000000000001"))
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var createdAt = DateTimeOffset.UtcNow;
        var equipmentTypes = Enumerable.Range(0, 99).Select(index => new EquipmentType
        {
            PublicId = Guid.CreateVersion7(), Code = $"REP-{index:000}",
            Name = $"Synthetic report equipment {index:000}",
            RequiresQualification = true, IsActive = true,
            CreatedAt = createdAt, UpdatedAt = createdAt,
        }).ToArray();
        context.EquipmentTypes.AddRange(equipmentTypes);
        await context.SaveChangesAsync(cancellationToken);
        context.QualificationCycles.AddRange(equipmentTypes.Select(equipment =>
            new QualificationCycle
            {
                PublicId = Guid.CreateVersion7(), RampAgentId = agentInternalId,
                EquipmentTypeId = equipment.Id, CycleNumber = 1,
                TrainingDate = new DateOnly(2026, 1, 1),
                ObtainedOn = new DateOnly(2026, 1, 2),
                ExpiresOn = new DateOnly(2099, 12, 31),
                CertifyingEntity = "Synthetic Testing", InstructorName = "Test Instructor",
                IsCurrent = true, CreatedAt = createdAt, UpdatedAt = createdAt,
            }));
        await context.SaveChangesAsync(cancellationToken);
        var firstHundred = await store.ListExpirationsAsync(hrId, stationId,
            from, to, 1, 100, cancellationToken: cancellationToken);
        var remainder = await store.ListExpirationsAsync(hrId, stationId,
            from, to, 2, 100, cancellationToken: cancellationToken);
        Assert.True(firstHundred.Page!.HasMore);
        Assert.Equal(100, firstHundred.Page.Rows.Count);
        Assert.False(remainder.Page!.HasMore);
        Assert.Equal(2, remainder.Page.Rows.Count);
        Assert.Equal(102, firstHundred.Page.Rows.Concat(remainder.Page.Rows)
            .Select(item => item.Id).Distinct().Count());
        var snapshot = await store.ReadSnapshotAsync(hrId, stationId,
            HumanResourcesReportKind.Expirations, from, to, 5000,
            cancellationToken: cancellationToken);
        Assert.Null(snapshot.Failure);
        Assert.Equal(102, snapshot.Snapshot!.Rows.Count);
        Assert.Equal(102, snapshot.Snapshot.RowCount);
        Assert.Equal("PUJ", snapshot.Snapshot.StationCode);
        var filteredSnapshot = await store.ReadSnapshotAsync(hrId, stationId,
            HumanResourcesReportKind.Expirations, from, to, 5000,
            "Qualification", "Current", cancellationToken);
        Assert.Null(filteredSnapshot.Failure);
        Assert.Equal(equipmentTypes.Length + qualifications.Page.Rows.Count,
            filteredSnapshot.Snapshot!.RowCount);
        Assert.Equal("Qualification", filteredSnapshot.Snapshot.DocumentKind);
        Assert.Equal("Current", filteredSnapshot.Snapshot.Validity);
        var stationZone = await context.Stations.Where(item => item.PublicId == stationId)
            .Select(item => item.IanaTimeZone).SingleAsync(cancellationToken);
        var beforeMidnight = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(
            new DateTime(2099, 12, 31, 23, 59, 0, DateTimeKind.Unspecified),
            TimeZoneInfo.FindSystemTimeZoneById(stationZone)), TimeSpan.Zero);
        clock.Step(beforeMidnight, beforeMidnight.AddMinutes(2));
        var midnightSnapshot = await store.ReadSnapshotAsync(hrId, stationId,
            HumanResourcesReportKind.Expirations, from, to, 5000,
            validity: "Current", cancellationToken: cancellationToken);
        Assert.Null(midnightSnapshot.Failure);
        Assert.Equal(102, midnightSnapshot.Snapshot!.RowCount);
        var overLimit = await store.ReadSnapshotAsync(hrId, stationId,
            HumanResourcesReportKind.Expirations, from, to, 100,
            cancellationToken: cancellationToken);
        Assert.Equal(HumanResourcesReportFailure.TooLarge, overLimit.Failure);
        Assert.Null(overLimit.Snapshot);

        Assert.Null(await store.RecordExportAsync(hrId, stationId,
            HumanResourcesReportKind.Expirations, from, to, "pdf",
            filteredSnapshot.Snapshot.RowCount, "Qualification", "Current",
            cancellationToken: cancellationToken));
        var exportAudit = await context.AuditEntries.AsNoTracking().SingleAsync(item =>
            item.Action == "human-resources.report.exported", cancellationToken);
        Assert.Equal(stationInternalId, exportAudit.StationId);
        Assert.Contains($"\"RowCount\":{filteredSnapshot.Snapshot.RowCount}",
            exportAudit.MetadataJson, StringComparison.Ordinal);
        Assert.Contains("\"DocumentKind\":\"Qualification\"", exportAudit.MetadataJson,
            StringComparison.Ordinal);
        Assert.Contains("\"Validity\":\"Current\"", exportAudit.MetadataJson,
            StringComparison.Ordinal);
        Assert.DoesNotContain("Agente", exportAudit.MetadataJson, StringComparison.Ordinal);

        var hrInternalId = await context.Users.Where(item => item.PublicId == hrId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var hrRoleId = await context.Roles.Where(item => item.NormalizedName == "GESTION_HUMANA")
            .Select(item => item.Id).SingleAsync(cancellationToken);
        await context.Set<IdentityUserRole<long>>().Where(item =>
            item.UserId == hrInternalId && item.RoleId == hrRoleId)
            .ExecuteDeleteAsync(cancellationToken);
        var revoked = await store.ListExpirationsAsync(hrId, stationId,
            from, to, 1, 20, cancellationToken: cancellationToken);
        Assert.Equal(HumanResourcesReportFailure.ForbiddenRole, revoked.Failure);
        Assert.Equal(HumanResourcesReportFailure.ForbiddenRole,
            await store.RecordExportAsync(hrId, stationId,
                HumanResourcesReportKind.Expirations, from, to, "pdf", 102,
                cancellationToken: cancellationToken));
    }

    private sealed class SteppingReportTimeProvider : TimeProvider
    {
        private DateTimeOffset? first;
        private DateTimeOffset? later;
        private int calls;

        public void Step(DateTimeOffset before, DateTimeOffset after)
        {
            first = before;
            later = after;
            calls = 0;
        }

        public override DateTimeOffset GetUtcNow() => first is null
            ? TimeProvider.System.GetUtcNow()
            : Interlocked.Increment(ref calls) == 1 ? first.Value : later!.Value;
    }
}
