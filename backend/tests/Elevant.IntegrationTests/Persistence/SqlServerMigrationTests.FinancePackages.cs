using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinancePackagesFreezeVersionsAndReserveSplitConsumptionExactlyOnce()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var draftStore = scope.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>();
        var definition = await db.ServiceDefinitions.SingleAsync(x => x.Code == "BAGGAGE", ct);
        var create = new SavePackageInput(Guid.NewGuid(), "GPU-QA", "GPU sintético", "USD", 500, "Turnaround", null, null, new(2026,1,1), null, [new(definition.PublicId, "minute", 60, 15, 20)], null);
        Assert.Equal("forbidden", (await packages.SaveAsync(ContractsAccount, null, create, ct)).Code);
        var saved = await packages.SaveAsync(FinanceAccount, null, create, ct); Assert.True(saved.IsSuccess, saved.Code);
        Assert.Equal(saved.Id, (await packages.SaveAsync(FinanceAccount, null, create, ct)).Id);
        Assert.Equal("idempotency_conflict", (await packages.SaveAsync(FinanceAccount, null, create with { BasePrice = 600 }, ct)).Code);
        var draftPackage = Assert.Single((await packages.ListAsync(FinanceAccount, ct))!);
        var publish = new PackageCommandInput(Guid.NewGuid(), draftPackage.Version);
        Assert.True((await packages.PublishAsync(FinanceAccount, draftPackage.Id, publish, ct)).IsSuccess);
        Assert.True((await packages.PublishAsync(FinanceAccount, draftPackage.Id, publish, ct)).IsSuccess);
        Assert.Equal("version_conflict", (await packages.SaveAsync(FinanceAccount, draftPackage.Id, create with { RequestId = Guid.NewGuid(), ExpectedVersion = draftPackage.Version }, ct)).Code);
        var contract = await db.Contracts.SingleAsync(x => x.ContractCode == "DEV-CONTRACT-0001", ct);
        var version = await db.ContractVersions.SingleAsync(x => x.ContractId == contract.Id, ct);
        version.Status = ContractVersionStatus.Draft; await db.SaveChangesAsync(ct);
        var selected = await packages.SetContractPackagesAsync(ContractsAccount, version.PublicId, new(Guid.NewGuid(), Convert.ToBase64String(version.RowVersion), [draftPackage.Id]), ct);
        Assert.True(selected.IsSuccess, selected.Code);
        db.ChangeTracker.Clear();
        version = await db.ContractVersions.SingleAsync(x => x.PublicId == version.PublicId, ct); version.Status = ContractVersionStatus.Approved;
        var tat = await db.Turnarounds.SingleAsync(x => x.OperationCode == "DEV-TAT-0001", ct);
        var op = await db.GroundOperations.SingleAsync(x => x.TurnaroundId == tat.Id, ct); op.CurrentStatus = GroundOperationStatus.Approved;
        var services = await db.OperationServices.Where(x => x.GroundOperationId == op.Id).OrderBy(x => x.LineNumber).Take(2).ToArrayAsync(ct);
        Assert.Equal(2, services.Length);
        var rate = await db.ContractServiceRates.SingleAsync(x => x.ContractVersionId == version.Id && x.ServiceDefinitionId == definition.Id, ct);
        var at = new DateTimeOffset(2026,8,18,12,0,0,TimeSpan.Zero);
        foreach (var service in services)
        {
            service.ServiceDefinitionId = definition.Id; service.ContractServiceRateId = rate.Id; service.CurrentStatus = ServiceExecutionStatus.Completed;
            service.ContractedQuantity = 1; service.ExecutedQuantity = 1; service.UnitPriceSnapshot = 10; service.CurrencyCodeSnapshot = "USD"; service.BillingUnitSnapshot = "minute";
            db.Set<OperationServiceStatusEvent>().Add(new() { OperationServiceId = service.Id, ToStatus = ServiceExecutionStatus.InProgress, OccurredAt = at });
            db.Set<OperationServiceStatusEvent>().Add(new() { OperationServiceId = service.Id, FromStatus = ServiceExecutionStatus.InProgress, ToStatus = ServiceExecutionStatus.Completed, OccurredAt = at.AddMinutes(service == services[0] ? 40 : 43) });
        }
        var checklist = await db.OperationChecklists.FirstAsync(x => x.GroundOperationId == op.Id, ct);
        var agent = await db.RampAgents.SingleAsync(x => x.EmployeeNumber == "DEV-RA-001", ct);
        var submission = new OperationSubmission { PublicId = Guid.NewGuid(), GroundOperationId = op.Id, OperationChecklistId = checklist.Id, RevisionNumber = 1, Status = SubmissionStatus.Approved, SubmittedByRampAgentId = agent.Id, SubmittedAt = at.AddHours(2), CreatedAt = at.AddHours(2), UpdatedAt = at.AddHours(2), EvidenceJson = JsonSerializer.Serialize(new { version = 2, services = services.Select(s => new { id = s.PublicId, code = definition.Code, name = definition.Name, status = "Completed", contractedQuantity = 1m, executedQuantity = 1m, unit = "minute" }), incidents = Array.Empty<object>(), charges = Array.Empty<object>() }) };
        db.OperationSubmissions.Add(submission); await db.SaveChangesAsync(ct);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(db, op.Id, ct, submission.SubmittedAt)).ToJson();
        await db.SaveChangesAsync(ct);
        // Later corrections to live timestamps cannot reprice the OCC-approved evidence.
        await db.Set<OperationServiceStatusEvent>().Where(x => x.OperationServiceId == services[1].Id && x.ToStatus == ServiceExecutionStatus.Completed).ExecuteUpdateAsync(set => set.SetProperty(x => x.OccurredAt, at.AddHours(9)), ct);
        var reviewerId = await db.Users.Where(x => x.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000001")).Select(x => x.Id).SingleAsync(ct);
        db.ReviewDecisions.Add(new() { PublicId = Guid.NewGuid(), OperationSubmissionId = submission.Id, ReviewerAccountId = reviewerId, Outcome = ReviewOutcome.Approved, DecidedAt = at.AddHours(3), CreatedAt = at.AddHours(3), UpdatedAt = at.AddHours(3) });
        await db.SaveChangesAsync(ct);
        var station = await db.Stations.Where(x => x.Id == tat.StationId).Select(x => x.PublicId).SingleAsync(ct);
        var command = new CreatePreinvoiceDraftCommand(FinanceAccount, station, tat.OperationDate, tat.OperationDate, Guid.NewGuid(), services.Select(x => x.PublicId).ToArray());
        var invoiceDraft = await draftStore.CreateAsync(command, ct); Assert.True(invoiceDraft.IsSuccess, invoiceDraft.Reason);
        var detail = (await draftStore.GetAsync(FinanceAccount, invoiceDraft.DraftId!.Value, ct))!;
        Assert.Equal(540, detail.Total);
        Assert.Equal(500, Assert.Single(detail.Lines, x => x.Kind == "Package").Amount);
        Assert.Equal(40, Assert.Single(detail.Lines, x => x.Kind == "Excess").Amount);
        Assert.All(detail.Lines.Where(x => x.Kind == "Service"), x => Assert.Equal(0, x.Amount));
        Assert.Equal(invoiceDraft.DraftId, (await draftStore.CreateAsync(command, ct)).DraftId);
        Assert.Equal(PreinvoiceDraftFailure.Conflict, (await draftStore.CreateAsync(command with { RequestId = Guid.NewGuid() }, ct)).Failure);
        Assert.Equal(2, await db.Set<PackageConsumptionEntry>().CountAsync(ct));
        var review = scope.ServiceProvider.GetRequiredService<IFinancePreinvoiceReviewStore>();
        var cancel = new PreinvoiceReviewInput(Guid.NewGuid(), detail.Version, "Corregir agrupación sintética");
        Assert.True((await review.CancelAsync(FinanceAccount, detail.Id, cancel, ct)).IsSuccess);
        Assert.True((await review.CancelAsync(FinanceAccount, detail.Id, cancel, ct)).IsSuccess);
        async Task<PreinvoiceDraftResult> CompeteAsync()
        {
            await using var contender = provider.CreateAsyncScope();
            return await contender.ServiceProvider.GetRequiredService<IPreinvoiceDraftStore>().CreateAsync(command with { RequestId = Guid.NewGuid() }, ct);
        }
        var race = await Task.WhenAll(CompeteAsync(), CompeteAsync());
        Assert.Single(race, result => result.IsSuccess);
        Assert.Single(race, result => result.Failure == PreinvoiceDraftFailure.Conflict);
        var winner = race.Single(result => result.IsSuccess);
        Assert.Equal(540, (await draftStore.GetAsync(FinanceAccount, winner.DraftId!.Value, ct))!.Total);
        Assert.Equal(4, await db.Set<PackageConsumptionEntry>().CountAsync(ct));
        Assert.Equal(2, await db.PreinvoiceLines.CountAsync(line => line.Kind == PreinvoiceLineKind.Service && line.ReleasedAt == null, ct));
    }
}
