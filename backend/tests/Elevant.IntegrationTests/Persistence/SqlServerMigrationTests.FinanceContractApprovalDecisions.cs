using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinanceContractApprovalDecisionsRejectUndefinedValuesWithoutStateMutation()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var airlineId = await db.Contracts.Where(c => c.ContractCode == "DEV-CONTRACT-0001").Select(c => c.AirlineId).SingleAsync(ct);
        var serviceId = await db.ServiceDefinitions.Where(s => s.Code == "BAGGAGE").Select(s => s.Id).SingleAsync(ct);
        var stationId = await db.Stations.Where(s => s.Code == "PUJ").Select(s => s.Id).SingleAsync(ct);

        foreach (var validDecision in new[] { ContractFinanceDecision.Approved, ContractFinanceDecision.Returned })
        {
            var contract = new Contract { PublicId = Guid.NewGuid(), AirlineId = airlineId,
                ContractCode = $"QA-DECISION-{validDecision}", Status = ContractStatus.Draft };
            db.Contracts.Add(contract); await db.SaveChangesAsync(ct);
            var version = new ContractVersion { PublicId = Guid.NewGuid(), ContractId = contract.Id, VersionNumber = 1,
                Status = ContractVersionStatus.PendingFinanceApproval, ValidFrom = new(2026, 9, 1), CurrencyCode = "USD", Terms = "Synthetic approval regression" };
            db.ContractVersions.Add(version); await db.SaveChangesAsync(ct);
            db.ContractServiceRates.Add(new ContractServiceRate { PublicId = Guid.NewGuid(), ContractVersionId = version.Id,
                ServiceDefinitionId = serviceId, BillingUnit = "operation", UnitPrice = 130, MinimumQuantity = 1, IsConfirmed = true });
            db.Set<ContractVersionStation>().Add(new() { ContractVersionId = version.Id, StationId = stationId });
            await db.SaveChangesAsync(ct);

            var expectedVersion = Convert.ToBase64String(version.RowVersion);
            var contractVersion = Convert.ToBase64String(contract.RowVersion);
            var auditCount = await db.AuditEntries.CountAsync(ct);
            var outboxCount = await db.OutboxMessages.CountAsync(ct);
            foreach (var undefined in new[] { "999", "-1", "2147483647" })
            {
                var result = await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
                    new(undefined, "Synthetic undefined decision", expectedVersion), ct);
                Assert.Equal(FinanceCatalogFailure.Invalid, result.Failure);
                Assert.False(result.IsSuccess);
                var unchangedVersion = await db.ContractVersions.AsNoTracking().SingleAsync(v => v.Id == version.Id, ct);
                var unchangedContract = await db.Contracts.AsNoTracking().SingleAsync(c => c.Id == contract.Id, ct);
                Assert.Equal(ContractVersionStatus.PendingFinanceApproval, unchangedVersion.Status);
                Assert.Null(unchangedVersion.ApprovedAt); Assert.Null(unchangedVersion.ApprovedByAccountId);
                Assert.Equal(0, unchangedVersion.PricingPolicyVersion);
                Assert.Equal(expectedVersion, Convert.ToBase64String(unchangedVersion.RowVersion));
                Assert.Equal(ContractStatus.Draft, unchangedContract.Status); Assert.Null(unchangedContract.SignedOn);
                Assert.Equal(contractVersion, Convert.ToBase64String(unchangedContract.RowVersion));
                Assert.False(await db.ContractFinanceReviews.AnyAsync(r => r.ContractVersionId == version.Id, ct));
                Assert.False(await db.ContractChargeRates.AnyAsync(r => r.ContractVersionId == version.Id, ct));
                Assert.False(await db.Set<ContractStatusEvent>().AnyAsync(e => e.ContractId == contract.Id, ct));
                Assert.Equal(auditCount, await db.AuditEntries.CountAsync(ct));
                Assert.Equal(outboxCount, await db.OutboxMessages.CountAsync(ct));
            }

            // The unchanged rowversion remains usable by either explicitly supported transition.
            var decided = await book.DecideContractApprovalAsync(FinanceAccount, version.PublicId,
                new(validDecision.ToString(), "Synthetic valid decision", expectedVersion), ct);
            Assert.True(decided.IsSuccess, decided.Failure?.ToString());
            var finalVersion = await db.ContractVersions.AsNoTracking().SingleAsync(v => v.Id == version.Id, ct);
            var finalContract = await db.Contracts.AsNoTracking().SingleAsync(c => c.Id == contract.Id, ct);
            var review = await db.ContractFinanceReviews.AsNoTracking().SingleAsync(r => r.ContractVersionId == version.Id, ct);
            Assert.Equal(validDecision, review.Decision);
            Assert.Equal(validDecision == ContractFinanceDecision.Approved ? ContractVersionStatus.Approved : ContractVersionStatus.Draft, finalVersion.Status);
            Assert.Equal(validDecision == ContractFinanceDecision.Approved ? ContractStatus.Active : ContractStatus.Draft, finalContract.Status);
            if (validDecision == ContractFinanceDecision.Approved)
            {
                Assert.NotNull(finalVersion.ApprovedAt); Assert.NotNull(finalVersion.ApprovedByAccountId);
                Assert.NotNull(finalContract.SignedOn);
            }
            else
            {
                Assert.Null(finalVersion.ApprovedAt); Assert.Null(finalVersion.ApprovedByAccountId);
                Assert.Null(finalContract.SignedOn);
            }
        }
    }
}
