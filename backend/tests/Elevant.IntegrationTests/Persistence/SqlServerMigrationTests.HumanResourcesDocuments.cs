using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid SeededRampAgentProfile = Guid.Parse("50000000-0000-7000-8000-000000000001");
    private static readonly Guid SeededGpuQualification = Guid.Parse("50000000-0000-7000-8000-000000000002");
    private static readonly Guid SeededGpuEquipment = Guid.Parse("20000000-0000-7000-8000-000000000007");

    [Fact]
    public async Task QualificationHistoryFiltersAndSummaryReadTheRecordedLineage()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var reads = scope.ServiceProvider.GetRequiredService<IHumanResourcesQualificationReadStore>();
        var writes = scope.ServiceProvider.GetRequiredService<IHumanResourcesQualificationWriteStore>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Two renewals on top of the seeded cycle; the last one expires in ten days.
        var second = Guid.NewGuid();
        var third = Guid.NewGuid();
        var renewal = new RecordHumanResourcesQualificationInput(SeededRampAgentProfile, SeededGpuEquipment,
            SeededGpuQualification, today.AddDays(-20), today.AddDays(-19), today.AddDays(200),
            "Synthetic Training Center", "Development Instructor", "Second cycle");
        Assert.Null((await writes.RecordAsync(HumanResourcesAccount, second, renewal, cancellationToken)).Failure);
        Assert.Null((await writes.RecordAsync(HumanResourcesAccount, third, renewal with
        {
            ExpectedCurrentId = second, TrainingDate = today.AddDays(-2), ObtainedOn = today.AddDays(-1),
            ExpiresOn = today.AddDays(10), Notes = "Third cycle",
        }, cancellationToken)).Failure);

        var history = await reads.GetHistoryAsync(HumanResourcesAccount, SeededGpuQualification, cancellationToken);
        Assert.False(history.Forbidden);
        Assert.Equal([3, 2, 1], history.Value!.Cycles.Select(cycle => cycle.CycleNumber));
        Assert.Equal(third, history.Value.Cycles[0].Id);
        Assert.True(history.Value.Cycles[0].IsCurrent);
        Assert.All(history.Value.Cycles.Skip(1), cycle => Assert.False(cycle.IsCurrent));
        Assert.Equal("Third cycle", history.Value.Cycles[0].Notes);
        Assert.False(string.IsNullOrWhiteSpace(history.Value.Cycles[0].RecordedByName));
        Assert.Null(history.Value.Cycles[2].RecordedByName);
        Assert.Equal("GPU", history.Value.EquipmentCode);
        Assert.Equal(history.Value.Cycles.Select(cycle => cycle.Id),
            (await reads.GetHistoryAsync(HumanResourcesAccount, third, cancellationToken)).Value!.Cycles
                .Select(cycle => cycle.Id));
        var missing = await reads.GetHistoryAsync(HumanResourcesAccount, Guid.NewGuid(), cancellationToken);
        Assert.False(missing.Forbidden);
        Assert.Null(missing.Value);
        Assert.True((await reads.GetHistoryAsync(OperationsAdministrator, third, cancellationToken)).Forbidden);

        var expiring = await reads.ListCurrentAsync(HumanResourcesAccount, 1, 100,
            new HumanResourcesQualificationQuery(today, Validity: DocumentValidity.ExpiringSoon), cancellationToken);
        var row = Assert.Single(expiring!.Qualifications, item => item.Id == third);
        Assert.Equal("ExpiringSoon", row.Validity);
        Assert.Equal("Third cycle", row.Notes);
        Assert.DoesNotContain((await reads.ListCurrentAsync(HumanResourcesAccount, 1, 100,
            new HumanResourcesQualificationQuery(today, Validity: DocumentValidity.Valid), cancellationToken))!
            .Qualifications, item => item.Id == third);
        Assert.Contains((await reads.ListCurrentAsync(HumanResourcesAccount, 1, 100,
            new HumanResourcesQualificationQuery(today.AddDays(11), Validity: DocumentValidity.Expired),
            cancellationToken))!.Qualifications, item => item.Id == third);
        Assert.Contains((await reads.ListCurrentAsync(HumanResourcesAccount, 1, 100,
            new HumanResourcesQualificationQuery(today, Search: "DEV-RA-001", EquipmentTypeId: SeededGpuEquipment),
            cancellationToken))!.Qualifications, item => item.Id == third);
        Assert.Empty((await reads.ListCurrentAsync(HumanResourcesAccount, 1, 100,
            new HumanResourcesQualificationQuery(today, Search: "no-such-agent"), cancellationToken))!.Qualifications);

        var summary = await reads.SummarizeAsync(HumanResourcesAccount,
            new HumanResourcesQualificationQuery(today, Validity: DocumentValidity.Expired), cancellationToken);
        Assert.NotNull(summary);
        Assert.True(summary.ExpiringSoon >= 1);
        Assert.Equal(summary.Total, summary.Valid + summary.ExpiringSoon + summary.Expired + summary.Upcoming);
        Assert.Null(await reads.SummarizeAsync(OperationsAdministrator,
            new HumanResourcesQualificationQuery(today), cancellationToken));
    }

    [Fact]
    public async Task PermitHistoryAndAvailabilityCancellationKeepTheirTrail()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var masterConnection = ResolveMasterConnection();
        if (masterConnection is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(masterConnection, "Development", cancellationToken);
        await using var provider = await SeededFinanceProviderAsync(database, cancellationToken);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var permits = scope.ServiceProvider.GetRequiredService<IHumanResourcesPermitReadStore>();
        var permitWrites = scope.ServiceProvider.GetRequiredService<IHumanResourcesPermitWriteStore>();
        var availability = scope.ServiceProvider.GetRequiredService<IHumanResourcesAvailabilityWriteStore>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var seeded = Assert.Single((await permits.ListCurrentAsync(HumanResourcesAccount, 1, 10,
            SeededRampAgentProfile, PermitDocumentType.AirportId, cancellationToken))!.Permits);
        var renewed = Guid.NewGuid();
        Assert.Null((await permitWrites.RecordAsync(HumanResourcesAccount, renewed,
            new RecordHumanResourcesPermitInput(SeededRampAgentProfile, "AirportId", seeded.Id, "DEV-AIRPORT-ID-2",
                today, today.AddYears(1)), cancellationToken)).Failure);
        var history = await permits.GetHistoryAsync(HumanResourcesAccount, renewed, cancellationToken);
        Assert.Equal(["DEV-AIRPORT-ID-2", seeded.DocumentNumber],
            history.Value!.Cycles.Select(cycle => cycle.DocumentNumber));
        Assert.Equal("AirportId", history.Value.DocumentType);
        Assert.NotNull(history.Value.Cycles[0].RecordedByName);
        Assert.True((await permits.GetHistoryAsync(OperationsAdministrator, renewed, cancellationToken)).Forbidden);
        Assert.Contains((await permits.ListCurrentAsync(HumanResourcesAccount, 1, 100,
            new HumanResourcesPermitQuery(today, Search: "DEV-AIRPORT-ID-2"), cancellationToken))!.Permits,
            item => item.Id == renewed && item.Validity == "Valid");
        var permitSummary = await permits.SummarizeAsync(HumanResourcesAccount,
            new HumanResourcesPermitQuery(today, DocumentType: PermitDocumentType.AirportId), cancellationToken);
        Assert.Equal(permitSummary!.Total,
            permitSummary.Valid + permitSummary.ExpiringSoon + permitSummary.Expired + permitSummary.Upcoming);

        // Only pending requests can be cancelled; the cancellation replays and is audited once.
        var requestId = Guid.NewGuid();
        var date = new DateOnly(2032, 3, 8);
        Assert.Null((await availability.RecordAsync(HumanResourcesAccount, requestId,
            new RecordHumanResourcesAvailabilityInput(SeededRampAgentProfile, date, date, "DayOff", "Synthetic leave"),
            cancellationToken)).Failure);
        var cancel = new ResolveHumanResourcesAvailabilityInput("Cancel", "Agent withdrew the request");
        Assert.Equal(HumanResourcesAvailabilityWriteFailure.Forbidden,
            (await availability.ResolveAsync(OperationsAdministrator, requestId, cancel, cancellationToken)).Failure);
        var cancelled = await availability.ResolveAsync(HumanResourcesAccount, requestId, cancel, cancellationToken);
        Assert.Null(cancelled.Failure);
        Assert.Equal("Cancelled", cancelled.Request!.Status);
        Assert.Null((await availability.ResolveAsync(HumanResourcesAccount, requestId, cancel, cancellationToken)).Failure);
        Assert.Equal(HumanResourcesAvailabilityWriteFailure.Conflict,
            (await availability.ResolveAsync(HumanResourcesAccount, requestId,
                new ResolveHumanResourcesAvailabilityInput("Approve", null), cancellationToken)).Failure);
        Assert.Equal(1, await context.AuditEntries.CountAsync(entry =>
            entry.Action == "hr.availability.cancelled" && entry.EntityPublicId == requestId, cancellationToken));
        Assert.Equal(AvailabilityRequestStatus.Cancelled, await context.AvailabilityRequests
            .Where(item => item.PublicId == requestId).Select(item => item.Status).SingleAsync(cancellationToken));
    }
}
