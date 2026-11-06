using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Theory]
    [InlineData(ChargeCalculationMethod.FixedAmount, ChargeCalculationMethod.PercentOfService, false, true, 525)]
    [InlineData(ChargeCalculationMethod.PercentOfService, ChargeCalculationMethod.FixedAmount, false, false, 0)]
    [InlineData(ChargeCalculationMethod.PercentOfService, ChargeCalculationMethod.PercentOfService, true, true, 500)]
    public async Task FinancePackageReviewUsesFrozenChargeMethodAndExclusion(ChargeCalculationMethod frozenMethod,
        ChargeCalculationMethod liveMethod, bool excluded, bool expectedSuccess, int expectedTotal)
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        var charge = await db.ChargeDefinitions.SingleAsync(c => c.Code == "NIGHT", ct);
        var frozen = new ContractChargePolicySnapshot(charge.Code, charge.Name, charge.BillingUnit, frozenMethod,
            ChargeQuantityRule.One, 0, 0);
        var rate = await db.ContractChargeRates.SingleOrDefaultAsync(r => r.ContractVersionId == fixture.VersionKey && r.ChargeDefinitionId == charge.Id, ct);
        if (rate is null)
        {
            rate = new ContractChargeRate { PublicId = Guid.NewGuid(), ContractVersionId = fixture.VersionKey,
                ChargeDefinitionId = charge.Id, CreatedAt = PackageReviewSubmittedAt, UpdatedAt = PackageReviewSubmittedAt };
            db.ContractChargeRates.Add(rate);
        }
        rate.Value = excluded ? null : 25m; rate.MinimumAmount = 0m; rate.IsExcluded = excluded;
        rate.DefinitionSnapshotJson = JsonSerializer.Serialize(frozen);
        var agent = await db.RampAgents.SingleAsync(a => a.EmployeeNumber == "DEV-RA-001", ct);
        db.OperationServiceCharges.Add(new OperationServiceCharge { PublicId = Guid.NewGuid(), OperationServiceId = fixture.ServiceKey,
            ChargeDefinitionId = charge.Id, AppliedByRampAgentId = agent.Id, AppliedAt = PackageReviewSubmittedAt.AddMinutes(-30),
            CreatedAt = PackageReviewSubmittedAt.AddMinutes(-30), UpdatedAt = PackageReviewSubmittedAt.AddMinutes(-30) });
        await db.SaveChangesAsync(ct);
        var submission = await db.OperationSubmissions.SingleAsync(s => s.Id == fixture.SubmissionKey, ct);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(db, fixture.OperationKey, ct, submission.SubmittedAt)).ToJson();
        await db.SaveChangesAsync(ct);
        // Only the catalog is edited after approval. The contract and approved charge mark remain unchanged.
        charge.Method = liveMethod; await db.SaveChangesAsync(ct);
        var drafts = scope.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>();
        var command = PackageReviewCommand(fixture);
        var result = await drafts.CreateAsync(command, ct);
        Assert.Equal(expectedSuccess, result.IsSuccess);
        if (expectedSuccess)
        {
            var detail = (await drafts.GetAsync(FinanceAccount, result.DraftId!.Value, ct))!;
            Assert.Equal(expectedTotal, detail.Total);
            var line = Assert.Single(detail.Lines, l => l.Kind == "Charge");
            Assert.Equal(excluded ? 0m : 25m, line.Amount);
            Assert.Equal(excluded, line.IsExcluded);
            Assert.True((await drafts.CreateAsync(command, ct)).Replayed);
            Assert.Equal(1, await db.Set<PackageConsumptionEntry>().CountAsync(ct));
        }
        else
        {
            Assert.Equal("package_percentage_basis_required", result.Reason);
            // Rejecting the frozen percentage basis must not leave a package or source reservation behind.
            Assert.Equal(0, await db.Preinvoices.CountAsync(ct));
            Assert.Equal(0, await db.Set<PackageConsumption>().CountAsync(ct));
            Assert.Equal(0, await db.Set<PackageConsumptionEntry>().CountAsync(ct));
        }
    }

    [Theory]
    [InlineData(false, false, true)]
    [InlineData(true, false, true)]
    [InlineData(true, true, false)]
    public async Task FinancePackageReviewPreservesExecutionBeforeBackdatedAmendment(
        bool submittedAfterAmendment, bool executedAfterAmendment, bool expectedSuccess)
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var original = await db.ContractVersions.SingleAsync(v => v.Id == fixture.VersionKey, ct);
        var amendment = await packages.CreateAmendmentAsync(ContractsAccount, original.PublicId,
            new(Guid.NewGuid(), Convert.ToBase64String(original.RowVersion)), ct);
        Assert.True(amendment.IsSuccess, amendment.Code);
        var next = await db.ContractVersions.SingleAsync(v => v.PublicId == amendment.Id, ct);
        next.ValidFrom = new DateOnly(2026, 8, 15); next.Status = ContractVersionStatus.PendingFinanceApproval;
        await db.SaveChangesAsync(ct);
        var approval = await scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>().DecideContractApprovalAsync(
            FinanceAccount, next.PublicId, new("Approved", "Synthetic backdated amendment", Convert.ToBase64String(next.RowVersion)), null, ct);
        Assert.True(approval.IsSuccess);
        db.ChangeTracker.Clear();
        original = await db.ContractVersions.SingleAsync(v => v.Id == fixture.VersionKey, ct);
        next = await db.ContractVersions.SingleAsync(v => v.PublicId == amendment.Id, ct);
        Assert.Equal(ContractVersionStatus.Superseded, original.Status);
        Assert.Equal(new DateOnly(2026, 8, 14), original.ValidTo);
        if (submittedAfterAmendment)
        {
            var submission = await db.OperationSubmissions.SingleAsync(s => s.Id == fixture.SubmissionKey, ct);
            submission.SubmittedAt = next.ApprovedAt!.Value.AddHours(3);
            if (executedAfterAmendment)
            {
                // A newly executed stale binding cannot gain eligibility merely from Superseded status.
                var events = await db.Set<OperationServiceStatusEvent>().Where(e => e.OperationServiceId == fixture.ServiceKey).ToArrayAsync(ct);
                foreach (var item in events)
                    item.OccurredAt = next.ApprovedAt.Value.AddHours(item.ToStatus == ServiceExecutionStatus.InProgress ? 1 : 2);
            }
            await db.SaveChangesAsync(ct);
        }
        var drafts = scope.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>();
        var command = PackageReviewCommand(fixture);
        var result = await drafts.CreateAsync(command, ct);
        Assert.Equal(expectedSuccess, result.IsSuccess);
        if (!expectedSuccess)
        {
            Assert.Equal("package_contract_mismatch", result.Reason);
            Assert.Equal(0, await db.Set<PackageConsumptionEntry>().CountAsync(ct));
        }
        else
        {
            Assert.Equal(500m, (await drafts.GetAsync(FinanceAccount, result.DraftId!.Value, ct))!.Total);
            Assert.True((await drafts.CreateAsync(command, ct)).Replayed);
            var entry = await db.Set<PackageConsumptionEntry>().SingleAsync(ct);
            using var calculation = JsonDocument.Parse(entry.CalculationJson);
            Assert.Equal(fixture.PackageId, calculation.RootElement.GetProperty("package").GetGuid());
            Assert.Equal(1, calculation.RootElement.GetProperty("VersionNumber").GetInt32());
            Assert.Equal(fixture.ServiceKey, entry.OperationServiceId);
        }
    }

    [Fact]
    public async Task FinancePackageReviewRejectsOriginalExpiryWithoutAReplacement()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        var original = await db.ContractVersions.SingleAsync(v => v.Id == fixture.VersionKey, ct);
        original.ValidTo = fixture.OperationDate.AddDays(-1); await db.SaveChangesAsync(ct);
        var result = await scope.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>().CreateAsync(PackageReviewCommand(fixture), ct);
        Assert.False(result.IsSuccess); Assert.Equal("package_contract_mismatch", result.Reason);
        Assert.Equal(0, await db.Set<PackageConsumptionEntry>().CountAsync(ct));
    }

    [Theory]
    [InlineData(-1, 1, true)]
    [InlineData(-1, 2, false)]
    [InlineData(0, 1, false)]
    [InlineData(0, 2, true)]
    [InlineData(1, 1, false)]
    [InlineData(1, 2, true)]
    public async Task FinancePackageReviewSelectsEffectivePublishedHistory(int daysFromReplacement, int selectedVersion, bool expectedSuccess)
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var replacementDate = new DateOnly(2027, 1, 1);
        var create = new SavePackageInput(Guid.NewGuid(), "REVIEW-PACKAGE", "Future revised coverage", "USD", 700m,
            "Turnaround", null, null, replacementDate, null, [new(fixture.DefinitionId, "minute", 60m, 15m, 20m)], null);
        var next = await packages.SaveAsync(FinanceAccount, null, create, ct); Assert.True(next.IsSuccess, next.Code);
        var nextData = (await packages.ListAsync(FinanceAccount, ct))!.Single(p => p.Id == next.Id);
        Assert.True((await packages.PublishAsync(FinanceAccount, nextData.Id, new(Guid.NewGuid(), nextData.Version), ct)).IsSuccess);
        var originalPackage = await db.Set<ServicePackageVersion>().AsNoTracking().SingleAsync(p => p.PublicId == fixture.PackageId, ct);
        Assert.Equal(TariffVersionStatus.Superseded, originalPackage.Status);
        Assert.Null(originalPackage.ValidTo); Assert.Equal(500m, originalPackage.BasePrice);
        var contract = await db.ContractVersions.SingleAsync(v => v.Id == fixture.VersionKey, ct);
        contract.Status = ContractVersionStatus.Draft; contract.ValidFrom = replacementDate.AddDays(daysFromReplacement);
        await db.SaveChangesAsync(ct);
        var selected = selectedVersion == 1 ? fixture.PackageId : nextData.Id;
        var command = new SetContractPackagesInput(Guid.NewGuid(), Convert.ToBase64String(contract.RowVersion), [selected]);
        var result = await packages.SetContractPackagesAsync(ContractsAccount, contract.PublicId, command, ct);
        Assert.Equal(expectedSuccess, result.IsSuccess);
        if (expectedSuccess)
        {
            Assert.True((await packages.SetContractPackagesAsync(ContractsAccount, contract.PublicId, command, ct)).IsSuccess);
            Assert.Equal(selected, Assert.Single((await packages.ListForContractAsync(ContractsAccount, contract.PublicId, ct))!).Id);
        }
        else Assert.Equal("package_not_eligible", result.Code);
    }

    private static readonly DateTimeOffset PackageReviewSubmittedAt = new(2026, 8, 18, 14, 0, 0, TimeSpan.Zero);
    private sealed record PackageReviewFixture(long VersionKey, long ServiceKey, Guid ServiceId, long OperationKey,
        long SubmissionKey, Guid StationId, DateOnly OperationDate, Guid PackageId, Guid DefinitionId);
    private static CreatePreinvoiceDraftCommand PackageReviewCommand(PackageReviewFixture fixture) => new(FinanceAccount,
        fixture.StationId, fixture.OperationDate, fixture.OperationDate, Guid.NewGuid(), [fixture.ServiceId]);
    private static async Task<PackageReviewFixture> PackageReviewFixtureAsync(IServiceProvider provider, CancellationToken ct)
    {
        var db = provider.GetRequiredService<ElevantDbContext>(); var packages = provider.GetRequiredService<IFinancePackageStore>();
        var definition = await db.ServiceDefinitions.SingleAsync(x => x.Code == "BAGGAGE", ct);
        var saved = await packages.SaveAsync(FinanceAccount, null, new(Guid.NewGuid(), "REVIEW-PACKAGE", "Frozen coverage", "USD", 500m,
            "Turnaround", null, null, new DateOnly(2026, 1, 1), null, [new(definition.PublicId, "minute", 60m, 15m, 20m)], null), ct);
        Assert.True(saved.IsSuccess, saved.Code);
        var package = (await packages.ListAsync(FinanceAccount, ct))!.Single(p => p.Id == saved.Id);
        Assert.True((await packages.PublishAsync(FinanceAccount, package.Id, new(Guid.NewGuid(), package.Version), ct)).IsSuccess);
        var contract = await db.Contracts.SingleAsync(c => c.ContractCode == "DEV-CONTRACT-0001", ct);
        var version = await db.ContractVersions.SingleAsync(v => v.ContractId == contract.Id, ct);
        var versionId = version.PublicId;
        version.Status = ContractVersionStatus.Draft; version.ValidFrom = new(2026, 1, 1); version.ValidTo = null;
        await db.SaveChangesAsync(ct);
        var selected = await packages.SetContractPackagesAsync(ContractsAccount, versionId,
            new(Guid.NewGuid(), Convert.ToBase64String(version.RowVersion), [package.Id]), ct);
        Assert.True(selected.IsSuccess, selected.Code);
        version = await db.ContractVersions.SingleAsync(v => v.PublicId == versionId, ct);
        version.Status = ContractVersionStatus.Approved; version.PricingPolicyVersion = 1;
        version.ApprovedAt = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var tat = await db.Turnarounds.SingleAsync(t => t.OperationCode == "DEV-TAT-0001", ct);
        var operation = await db.GroundOperations.SingleAsync(o => o.TurnaroundId == tat.Id, ct);
        operation.CurrentStatus = GroundOperationStatus.Approved;
        var service = await db.OperationServices.Where(s => s.GroundOperationId == operation.Id).OrderBy(s => s.LineNumber).FirstAsync(ct);
        var rate = await db.ContractServiceRates.SingleAsync(r => r.ContractVersionId == version.Id && r.ServiceDefinitionId == definition.Id, ct);
        service.ServiceDefinitionId = definition.Id; service.ContractServiceRateId = rate.Id; service.CurrentStatus = ServiceExecutionStatus.Completed;
        service.ExecutedQuantity = 1m; service.ContractedQuantity = 1m; service.UnitPriceSnapshot = 0m;
        service.CurrencyCodeSnapshot = "USD"; service.BillingUnitSnapshot = "minute";
        var start = PackageReviewSubmittedAt.AddHours(-1);
        db.Set<OperationServiceStatusEvent>().AddRange(
            new() { OperationServiceId = service.Id, ToStatus = ServiceExecutionStatus.InProgress, OccurredAt = start },
            new() { OperationServiceId = service.Id, FromStatus = ServiceExecutionStatus.InProgress, ToStatus = ServiceExecutionStatus.Completed, OccurredAt = PackageReviewSubmittedAt });
        var checklist = await db.OperationChecklists.FirstAsync(c => c.GroundOperationId == operation.Id, ct);
        var agent = await db.RampAgents.SingleAsync(a => a.EmployeeNumber == "DEV-RA-001", ct);
        var revision = (await db.OperationSubmissions.Where(s => s.GroundOperationId == operation.Id).MaxAsync(s => (int?)s.RevisionNumber, ct) ?? 0) + 1;
        var submission = new OperationSubmission { PublicId = Guid.NewGuid(), GroundOperationId = operation.Id,
            OperationChecklistId = checklist.Id, RevisionNumber = revision, Status = SubmissionStatus.Approved,
            SubmittedByRampAgentId = agent.Id, SubmittedAt = PackageReviewSubmittedAt, CreatedAt = PackageReviewSubmittedAt, UpdatedAt = PackageReviewSubmittedAt };
        db.Add(submission); await db.SaveChangesAsync(ct);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(db, operation.Id, ct, submission.SubmittedAt)).ToJson();
        var reviewer = await db.Users.Where(u => u.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000001")).Select(u => u.Id).SingleAsync(ct);
        db.ReviewDecisions.Add(new() { PublicId = Guid.NewGuid(), OperationSubmissionId = submission.Id, ReviewerAccountId = reviewer,
            Outcome = ReviewOutcome.Approved, DecidedAt = PackageReviewSubmittedAt.AddMinutes(1), CreatedAt = PackageReviewSubmittedAt, UpdatedAt = PackageReviewSubmittedAt });
        await db.SaveChangesAsync(ct);
        var station = await db.Stations.Where(s => s.Id == tat.StationId).Select(s => s.PublicId).SingleAsync(ct);
        return new(version.Id, service.Id, service.PublicId, operation.Id, submission.Id, station, tat.OperationDate, package.Id, definition.PublicId);
    }
}
