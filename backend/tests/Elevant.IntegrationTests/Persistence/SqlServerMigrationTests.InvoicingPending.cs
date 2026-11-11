using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>«Por facturar» and the no-charge closure (phase 4, block A: 4-N06, 4-N07, 4-N16, 4-N18).</summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// 4-N16 and 4-N18: one row per pending operation from the oldest, in pages that never split an operation, without
    /// what an invoice holds, and a charge in another currency without that day's rate shows exchange_rate_missing
    /// before anyone issues. 4-N01: an older draft without invoice that holds a service blocks nothing; the issuance
    /// releases it (voided, its lines released, audited) in its own transaction.
    /// </summary>
    [Fact]
    public async Task PendingOperationsListTheOldestFirstAndNameEveryBlock()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var first = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var second = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);

        async Task<FinancePendingOperationsData> PendingAsync(int limit = 50, string? cursor = null, Guid? airline = null)
        {
            await using var scope = provider.CreateAsyncScope();
            var data = await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                new GetFinancePendingOperationsQuery(FinanceAccount, station, null, null, airline, cursor, limit), ct);
            return Assert.IsType<FinancePendingOperationsData>(data);
        }

        // From the oldest (DEV-TAT-0001 on 18/08) to the newest, one operation per page here.
        var page = await PendingAsync(1);
        var only = Assert.Single(page.Operations);
        Assert.Equal((first, 2, true, 2), (only.OperationId, page.TotalPending, only.Ready, only.LineEstimate));
        Assert.Equal(20m, only.EstimatedNet);
        Assert.Equal("USD", only.CurrencyCode);
        Assert.Equal(Convert.ToBase64String((await setup.GroundOperations.AsNoTracking()
            .SingleAsync(item => item.PublicId == first, ct)).RowVersion), only.Version);
        var airline = Assert.Single(page.Airlines);
        Assert.Equal(2, airline.PendingCount);
        Assert.NotNull(page.NextCursor);
        var next = await PendingAsync(1, page.NextCursor);
        Assert.Equal(second, Assert.Single(next.Operations).OperationId);
        Assert.Null(next.NextCursor);
        var otherAirline = await PendingAsync(airline: Guid.NewGuid());
        Assert.Empty(otherAirline.Operations);
        Assert.Equal((0, 2), (otherAirline.TotalPending, Assert.Single(otherAirline.Airlines).PendingCount));
        // Contratos has no «Facturación»: it reads nothing.
        await using (var scope = provider.CreateAsyncScope())
            Assert.Null(await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                new GetFinancePendingOperationsQuery(ContractsAccount, station, null, null, null, null), ct));

        // 4-N18: a charge in DOP whose tariff is only in USD, without that day's rate, blocks the operation by name.
        var secondServices = await (from service in setup.OperationServices
                                    join operation in setup.GroundOperations on service.GroundOperationId equals operation.Id
                                    where operation.PublicId == second
                                    orderby service.LineNumber
                                    select service).ToArrayAsync(ct);
        foreach (var service in secondServices) service.CurrencyCodeSnapshot = "DOP";
        var fee = await setup.ChargeDefinitions.SingleAsync(item => item.Code == "ADMIN-FEE", ct);
        var submission = await setup.OperationSubmissions
            .SingleAsync(item => item.GroundOperationId == secondServices[0].GroundOperationId, ct);
        var agent = await setup.RampAgents.Where(item => item.EmployeeNumber == "DEV-RA-001").Select(item => item.Id).SingleAsync(ct);
        setup.OperationServiceCharges.Add(new OperationServiceCharge
        {
            PublicId = Guid.NewGuid(), OperationServiceId = secondServices[0].Id, ChargeDefinitionId = fee.Id,
            AppliedByRampAgentId = agent, AppliedAt = submission.SubmittedAt.AddMinutes(-10),
            CreatedAt = submission.SubmittedAt.AddMinutes(-10), UpdatedAt = submission.SubmittedAt.AddMinutes(-10),
        });
        await setup.SaveChangesAsync(ct);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(setup, submission.GroundOperationId, ct,
            submission.SubmittedAt)).ToJson();
        await setup.SaveChangesAsync(ct);
        var dopTariffs = setup.ChargeTariffVersions.Where(item => item.CurrencyCode == "DOP").Select(item => item.Id);
        await setup.ChargeRates.Where(item => item.ChargeDefinitionId == fee.Id && dopTariffs.Contains(item.ChargeTariffVersionId))
            .ExecuteDeleteAsync(ct);
        var currentRates = await setup.ExchangeRates.Where(item => item.IsCurrent).Select(item => item.Id).ToArrayAsync(ct);
        await setup.ExchangeRates.Where(item => currentRates.Contains(item.Id))
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.IsCurrent, false), ct);
        var blocked = (await PendingAsync()).Operations.Single(item => item.OperationId == second);
        Assert.False(blocked.Ready);
        Assert.Equal(["exchange_rate_missing"], blocked.BlockingReasons);
        Assert.True((await PendingAsync()).Operations.Single(item => item.OperationId == first).Ready);
        var drafts = await setup.Preinvoices.CountAsync(ct);
        await using (var scope = provider.CreateAsyncScope())
        {
            var refused = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [second], Guid.NewGuid()), ct);
            Assert.Equal((IssueInvoiceFailure.Unprocessable, "exchange_rate_missing"), (refused.Failure!.Value, refused.Reason));
        }
        Assert.Equal(drafts, await setup.Preinvoices.CountAsync(ct));
        await setup.ExchangeRates.Where(item => currentRates.Contains(item.Id))
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.IsCurrent, true), ct);
        var valued = (await PendingAsync()).Operations.Single(item => item.OperationId == second);
        Assert.True(valued.Ready, string.Join(",", valued.BlockingReasons));
        Assert.Equal(("DOP", 3, 897.5m), (valued.CurrencyCode, valued.LineEstimate, valued.EstimatedNet));
        Assert.Equal(1, Assert.Single(valued.Services, item => item.ServiceId == secondServices[0].PublicId).ChargeCount);

        // 4-N01: an older internal draft without invoice (a failed issuance before the fix) still holds a service: the
        // operation is ready all the same, because the issuance releases that draft.
        var firstService = await (from service in setup.OperationServices
                                  join operation in setup.GroundOperations on service.GroundOperationId equals operation.Id
                                  where operation.PublicId == first
                                  orderby service.LineNumber
                                  select service).FirstAsync(ct);
        var held = await HoldInOlderDraftAsync(setup, firstService, ct);
        var waiting = (await PendingAsync()).Operations.Single(item => item.OperationId == first);
        Assert.True(waiting.Ready, string.Join(",", waiting.BlockingReasons));

        // Once invoiced, the operation leaves «Por facturar»; the rest stays. The older draft is voided with every line
        // released and the release audited under the issuance's request id.
        var requestId = Guid.NewGuid();
        await using (var scope = provider.CreateAsyncScope())
        {
            var issued = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [first], requestId), ct);
            Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        }
        setup.ChangeTracker.Clear();
        var released = await setup.Preinvoices.AsNoTracking().SingleAsync(item => item.Id == held, ct);
        Assert.Equal(PreinvoiceStatus.Voided, released.Status);
        Assert.All(await setup.PreinvoiceLines.AsNoTracking().Where(item => item.PreinvoiceId == held).ToArrayAsync(ct),
            line => Assert.NotNull(line.ReleasedAt));
        var releaseAudit = await setup.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "finance.invoicing.stale_draft_released", ct);
        Assert.Equal((released.PublicId, requestId.ToString("D")), (releaseAudit.EntityPublicId, releaseAudit.RequestId));
        using (var metadata = System.Text.Json.JsonDocument.Parse(releaseAudit.MetadataJson!))
        {
            Assert.Equal("Accepted", metadata.RootElement.GetProperty("previousStatus").GetString());
            Assert.Equal(first, Assert.Single(metadata.RootElement.GetProperty("operations").EnumerateArray()).GetGuid());
        }
        var left = await PendingAsync();
        Assert.Equal((1, second), (left.TotalPending, Assert.Single(left.Operations).OperationId));
        await using (var scope = provider.CreateAsyncScope())
            Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>()
                .CountAsync(FinanceAccount, station, ct));
    }

    /// <summary>
    /// 4-N07: operations valued at zero are closed without charge with a reason: no e-NCF, no email, an audit with the
    /// reason, out of «Por facturar», a replay with the same key and body, idempotency_conflict otherwise; an operation
    /// with an amount is operation_has_charge and is invoiced instead.
    /// </summary>
    [Fact]
    public async Task NoChargeClosureTakesZeroOperationsOutOfPendingAndReplays()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var priced = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var free = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        await (from service in setup.OperationServices
               join operation in setup.GroundOperations on service.GroundOperationId equals operation.Id
               where operation.PublicId == free
               select service).ExecuteUpdateAsync(set => set.SetProperty(item => item.UnitPriceSnapshot, 0m), ct);
        string VersionOf(Guid operation) => Convert.ToBase64String(setup.GroundOperations.AsNoTracking()
            .Single(item => item.PublicId == operation).RowVersion);

        async Task<NoChargeClosureResult> CloseAsync(Guid key, string reason, params InvoiceOperationVersion[] operations)
        {
            await using var scope = provider.CreateAsyncScope();
            return await new CloseOperationsWithoutChargeHandler(
                    scope.ServiceProvider.GetRequiredService<IActorContextResolver>(),
                    scope.ServiceProvider.GetRequiredService<IInvoiceIssuanceStore>())
                .HandleAsync(new NoChargeClosureCommand(FinanceAccount, station, operations, reason, key), ct);
        }
        async Task<(int Drafts, int Invoices, int Emails, int Receipts)> WrittenAsync()
        {
            setup.ChangeTracker.Clear();
            return (await setup.Preinvoices.CountAsync(ct), await setup.NonFiscalInvoices.CountAsync(ct),
                await setup.Set<EmailOutboxMessage>().CountAsync(ct), await setup.Set<FinancePricingCommand>().CountAsync(ct));
        }

        // 4-N01: a preinvoice of the retired module, still Submitted, holds a service of the free operation. The refused
        // issuance rolls its release back with everything else; the closure below releases it.
        var freeService = await (from service in setup.OperationServices
                                 join operation in setup.GroundOperations on service.GroundOperationId equals operation.Id
                                 where operation.PublicId == free
                                 orderby service.LineNumber
                                 select service).FirstAsync(ct);
        var retired = await HoldInOlderDraftAsync(setup, freeService, ct, PreinvoiceStatus.Submitted);
        await using (var scope = provider.CreateAsyncScope())
        {
            var zero = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [free], Guid.NewGuid()), ct);
            Assert.Equal((IssueInvoiceFailure.Unprocessable, "zero_total"), (zero.Failure!.Value, zero.Reason));
        }
        setup.ChangeTracker.Clear();
        Assert.Equal(PreinvoiceStatus.Submitted, (await setup.Preinvoices.AsNoTracking().SingleAsync(item => item.Id == retired, ct)).Status);
        Assert.False(await setup.AuditEntries.AnyAsync(item => item.Action == "finance.invoicing.stale_draft_released", ct));

        // An operation with an amount is invoiced, not closed; nothing is written.
        var before = await WrittenAsync();
        var charged = await CloseAsync(Guid.NewGuid(), "Cierre por error", new InvoiceOperationVersion(priced, VersionOf(priced)));
        Assert.Equal((IssueInvoiceFailure.Unprocessable, "operation_has_charge"), (charged.Failure!.Value, charged.Code));
        Assert.Equal(before, await WrittenAsync());
        var stale = await CloseAsync(Guid.NewGuid(), "Servicios sin tarifa", new InvoiceOperationVersion(free, "AAAAAAAAAAE="));
        Assert.Equal((IssueInvoiceFailure.Conflict, "version_conflict"), (stale.Failure!.Value, stale.Code));

        var key = Guid.NewGuid();
        var version = VersionOf(free);
        var closed = await CloseAsync(key, "  Servicios incluidos sin tarifa  ", new InvoiceOperationVersion(free, version));
        Assert.True(closed.IsSuccess, $"{closed.Failure} {closed.Code}");
        Assert.False(closed.Replayed);
        Assert.Equal([free], closed.Closure!.OperationIds);
        var after = await WrittenAsync();
        Assert.Equal((before.Drafts + 1, before.Invoices, before.Emails, before.Receipts + 1), after);
        var draft = await setup.Preinvoices.AsNoTracking().SingleAsync(item => item.PublicId == closed.Closure.ClosureId, ct);
        Assert.Equal((PreinvoiceStatus.NoCharge, 0m, key), (draft.Status, draft.Total, draft.RequestId));
        var audit = await setup.AuditEntries.AsNoTracking().SingleAsync(item => item.Action == "finance.invoicing.closed_no_charge", ct);
        Assert.Equal(("Servicios incluidos sin tarifa", draft.PublicId), (audit.Reason, audit.EntityPublicId));
        Assert.False(await setup.NonFiscalInvoices.AnyAsync(item => item.FiscalNumber != null, ct));
        Assert.Equal(PreinvoiceStatus.Voided, (await setup.Preinvoices.AsNoTracking().SingleAsync(item => item.Id == retired, ct)).Status);
        Assert.Equal(key.ToString("D"), (await setup.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "finance.invoicing.stale_draft_released", ct)).RequestId);

        // The same key and body replay the closure without a second audit; another body with the key is a conflict.
        var replay = await CloseAsync(key, "Servicios incluidos sin tarifa", new InvoiceOperationVersion(free, version));
        Assert.True(replay.Replayed);
        Assert.Equal(closed.Closure.ClosureId, replay.Closure!.ClosureId);
        Assert.Equal(1, await setup.AuditEntries.CountAsync(item => item.Action == "finance.invoicing.closed_no_charge", ct));
        var other = await CloseAsync(key, "Otro motivo distinto", new InvoiceOperationVersion(free, version));
        Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"), (other.Failure!.Value, other.Code));

        // Closed, the operation is no longer pending nor invoiceable; the closure's key is not an invoice key.
        await using (var scope = provider.CreateAsyncScope())
        {
            var pending = await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                new GetFinancePendingOperationsQuery(FinanceAccount, station, null, null, null, null), ct);
            Assert.Equal(priced, Assert.Single(pending!.Operations).OperationId);
            var again = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [free], Guid.NewGuid()), ct);
            Assert.Equal((IssueInvoiceFailure.Conflict, "already_invoiced"), (again.Failure!.Value, again.Reason));
            var reusedKey = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [priced], key), ct);
            Assert.Equal((IssueInvoiceFailure.Conflict, "idempotency_conflict"), (reusedKey.Failure!.Value, reusedKey.Reason));
        }
        var closeAgain = await CloseAsync(Guid.NewGuid(), "Segundo cierre", new InvoiceOperationVersion(free, VersionOf(free)));
        Assert.Equal((IssueInvoiceFailure.Conflict, "already_invoiced"), (closeAgain.Failure!.Value, closeAgain.Code));
    }

    /// <summary>
    /// 4-N07: a no-charge closure is final like an invoice, so it never blocks the package with
    /// package_scope_has_unissued_preinvoice and its consumption counts: in one yearly period, 30 minutes invoiced with
    /// the base, 20 closed without charge, and the next 20 minutes go 10 minutes over the 60 included, one block of 20.
    /// </summary>
    [Fact]
    public async Task NoChargeClosureKeepsThePackageConsumptionForTheNextInvoice()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        PackageReviewFixture fixture;
        await using (var scope = provider.CreateAsyncScope())
            fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        await using var setup = CreateContext(database.ConnectionString);
        // One consumption scope for the year: the fixture's package covers a turnaround, this one a 365-day period.
        var bound = setup.Set<ContractServicePackage>().Where(item => item.ContractVersionId == fixture.VersionKey)
            .Select(item => item.PackageVersionId);
        await setup.Set<ServicePackageVersion>().Where(item => bound.Contains(item.Id)).ExecuteUpdateAsync(set => set
            .SetProperty(item => item.Scope, PackageConsumptionScope.Period).SetProperty(item => item.PeriodDays, 365), ct);
        // The fixture's service ran 60 minutes; it runs 30 here.
        var started = await setup.Set<OperationServiceStatusEvent>()
            .SingleAsync(item => item.OperationServiceId == fixture.ServiceKey && item.ToStatus == ServiceExecutionStatus.InProgress, ct);
        started.OccurredAt = PackageReviewSubmittedAt.AddMinutes(-30);
        await setup.SaveChangesAsync(ct);
        var firstSubmission = await setup.OperationSubmissions.SingleAsync(item => item.Id == fixture.SubmissionKey, ct);
        firstSubmission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(setup, fixture.OperationKey, ct,
            firstSubmission.SubmittedAt)).ToJson();
        await setup.SaveChangesAsync(ct);
        var firstOperation = await setup.GroundOperations.Where(item => item.Id == fixture.OperationKey)
            .Select(item => item.PublicId).SingleAsync(ct);

        async Task<IssueInvoiceResult> IssueAsync(Guid operation)
        {
            await using var scope = provider.CreateAsyncScope();
            return await Handler(scope.ServiceProvider).HandleAsync(
                new IssueInvoiceRequest(FinanceAccount, fixture.StationId, [operation], Guid.NewGuid()), ct);
        }

        var base30 = await IssueAsync(firstOperation);
        Assert.True(base30.IsSuccess, $"{base30.Failure} {base30.Reason}");
        Assert.Equal(590m, base30.Total);

        var second = await CoveredOperationAsync(setup, fixture, 20, ct);
        var zero = await IssueAsync(second);
        Assert.Equal((IssueInvoiceFailure.Unprocessable, "zero_total"), (zero.Failure!.Value, zero.Reason));
        await using (var scope = provider.CreateAsyncScope())
        {
            var version = Convert.ToBase64String((await setup.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.PublicId == second, ct)).RowVersion);
            var closed = await new CloseOperationsWithoutChargeHandler(
                    scope.ServiceProvider.GetRequiredService<IActorContextResolver>(),
                    scope.ServiceProvider.GetRequiredService<IInvoiceIssuanceStore>())
                .HandleAsync(new NoChargeClosureCommand(FinanceAccount, fixture.StationId,
                    [new InvoiceOperationVersion(second, version)], "Dentro de los 60 minutos del paquete", Guid.NewGuid()), ct);
            Assert.True(closed.IsSuccess, $"{closed.Failure} {closed.Code}");
        }

        var third = await CoveredOperationAsync(setup, fixture, 20, ct);
        var excess = await IssueAsync(third);
        Assert.True(excess.IsSuccess, $"{excess.Failure} {excess.Reason}");
        Assert.Equal(23.60m, excess.Total);
        Assert.Equal(3, await setup.Set<PackageConsumptionEntry>().CountAsync(ct));
    }

    /// <summary>
    /// 4-N06: the line estimate of «Por facturar» counts what a package adds, as the draft writes it: a covered service
    /// that runs 90 minutes of a 60-minute package is its line, the package's base and its excess. The invoice has
    /// those three lines and the estimate is never below them.
    /// </summary>
    [Fact]
    public async Task PendingLineEstimateCountsThePackageLines()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        PackageReviewFixture fixture;
        await using (var scope = provider.CreateAsyncScope())
            fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var covered = await CoveredOperationAsync(setup, fixture, 90, ct);

        FinancePendingOperationData pending;
        await using (var scope = provider.CreateAsyncScope())
            pending = (await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                    new GetFinancePendingOperationsQuery(FinanceAccount, fixture.StationId, null, null, null, null, 100), ct))!
                .Operations.Single(item => item.OperationId == covered);
        Assert.Equal((1, 3), (pending.ServiceCount, pending.LineEstimate));

        IssueInvoiceResult issued;
        await using (var scope = provider.CreateAsyncScope())
            issued = await Handler(scope.ServiceProvider).HandleAsync(
                new IssueInvoiceRequest(FinanceAccount, fixture.StationId, [covered], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        setup.ChangeTracker.Clear();
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        var kinds = await setup.NonFiscalInvoiceLines.AsNoTracking().Where(item => item.InvoiceId == invoice.Id)
            .OrderBy(item => item.LineNumber).Select(item => item.Kind).ToArrayAsync(ct);
        Assert.Equal([PreinvoiceLineKind.Service, PreinvoiceLineKind.Package, PreinvoiceLineKind.Excess], kinds);
        Assert.True(pending.LineEstimate >= kinds.Length);
    }

    /// <summary>
    /// 4-N01: an older draft without invoice that holds the consumption of a package scope (a 365-day period here) would
    /// refuse every later operation of that period with package_scope_has_unissued_preinvoice. The issuance of any of
    /// them releases it instead: the period starts again with its base, the operation that draft held is ready in «Por
    /// facturar», and it is invoiced next with the base already taken.
    /// </summary>
    [Fact]
    public async Task IssuanceReleasesAnOlderDraftHoldingThePackageScope()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        PackageReviewFixture fixture;
        await using (var scope = provider.CreateAsyncScope())
            fixture = await PackageReviewFixtureAsync(scope.ServiceProvider, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var bound = setup.Set<ContractServicePackage>().Where(item => item.ContractVersionId == fixture.VersionKey)
            .Select(item => item.PackageVersionId);
        await setup.Set<ServicePackageVersion>().Where(item => bound.Contains(item.Id)).ExecuteUpdateAsync(set => set
            .SetProperty(item => item.Scope, PackageConsumptionScope.Period).SetProperty(item => item.PeriodDays, 365), ct);
        var firstOperation = await setup.GroundOperations.Where(item => item.Id == fixture.OperationKey)
            .Select(item => item.PublicId).SingleAsync(ct);

        // The older draft: the fixture's valuation committed on its own, as a failed issuance left it before 4-N01's fix.
        PreinvoiceDraftResult older;
        await using (var scope = provider.CreateAsyncScope())
            older = await ValuationDraftAsync(scope.ServiceProvider, PackageReviewCommand(fixture), ct);
        Assert.True(older.IsSuccess, $"{older.Failure} {older.Reason}");
        await using (var scope = provider.CreateAsyncScope())
        {
            var listed = (await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                    new GetFinancePendingOperationsQuery(FinanceAccount, fixture.StationId, null, null, null, null, 100), ct))!
                .Operations.Single(item => item.OperationId == firstOperation);
            Assert.DoesNotContain(InvoicingCodes.PendingPreinvoice, listed.BlockingReasons);
        }

        async Task<IssueInvoiceResult> IssueAsync(Guid operation)
        {
            await using var scope = provider.CreateAsyncScope();
            return await Handler(scope.ServiceProvider).HandleAsync(
                new IssueInvoiceRequest(FinanceAccount, fixture.StationId, [operation], Guid.NewGuid()), ct);
        }
        var second = await CoveredOperationAsync(setup, fixture, 20, ct);
        var issued = await IssueAsync(second);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        Assert.Equal(590m, issued.Total);
        setup.ChangeTracker.Clear();
        Assert.Equal(PreinvoiceStatus.Voided,
            (await setup.Preinvoices.AsNoTracking().SingleAsync(item => item.PublicId == older.DraftId, ct)).Status);
        Assert.Single(await setup.AuditEntries.AsNoTracking().Where(item =>
            item.Action == "finance.invoicing.stale_draft_released" && item.EntityPublicId == older.DraftId).ToArrayAsync(ct));

        var next = await IssueAsync(firstOperation);
        Assert.True(next.IsSuccess, $"{next.Failure} {next.Reason}");
        setup.ChangeTracker.Clear();
        var nextInvoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == next.InvoiceId, ct);
        Assert.DoesNotContain(PreinvoiceLineKind.Package, await setup.NonFiscalInvoiceLines.AsNoTracking()
            .Where(item => item.InvoiceId == nextInvoice.Id).Select(item => item.Kind).ToArrayAsync(ct));
    }

    /// <summary>
    /// 4-N26: OCC's approval of an operation with billable services alerts Finance once per airline, station and business
    /// day: only Finance accounts with «Notificaciones» and «Facturación» on the station receive it, and the next approval
    /// of that day marks the same alert unread again instead of adding another.
    /// </summary>
    [Fact]
    public async Task OccApprovalAlertsFinanceOncePerAirlineStationAndDay()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000e4", ct);
        var blockOn = new DateTimeOffset(2026, 8, 18, 12, 10, 0, TimeSpan.FromHours(-4)).ToUniversalTime();
        await using (var setup = CreateContext(database.ConnectionString))
            await PrepareReviewOperationAsync(setup, blockOn, 2m, ct);
        await SignServiceOrderAsync(provider, TimingAgent, TimingStation, TimingOperation, installation, ct);
        var handOffKey = Guid.NewGuid();
        Assert.True((await Run(services => services.GetRequiredService<Elevant.Application.Abstractions.Operations.IRampOperationSubmissionStore>()
            .SubmitAsync(new Elevant.Application.Operations.RampOperationSubmissionWriteRequest(TimingAgent, [TimingStation],
                TimingOperation, installation, handOffKey, null, Guid.NewGuid(), "alert-handoff"), ct))).IsSuccess);
        Task<Elevant.Application.Operations.OccReviewDetailData> DetailAsync() => Run(async services =>
            (await services.GetRequiredService<Elevant.Application.Abstractions.Operations.IOccReviewStore>()
                .GetDetailAsync(TimingOperation, [TimingStation], ct))!);
        Task<Elevant.Application.Operations.OccReviewDecisionWriteResult> ApproveAsync(Guid submission, string token) =>
            Run(services => services.GetRequiredService<Elevant.Application.Abstractions.Operations.IOccReviewStore>()
                .DecideAsync(new Elevant.Application.Operations.OccReviewDecisionWriteRequest(TimingOcc, [TimingStation],
                    TimingOperation, submission, token, "Approved", null, Guid.NewGuid(), "alert-decide", Guid.NewGuid()), ct));

        var approved = await ApproveAsync(handOffKey, (await DetailAsync()).ConcurrencyToken);
        Assert.True(approved.IsSuccess, approved.Code);
        await using var check = CreateContext(database.ConnectionString);
        var finance = await check.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id).SingleAsync(ct);
        var station = await check.Stations.Where(item => item.PublicId == TimingStation).Select(item => item.Id).SingleAsync(ct);
        var airline = await (from operation in check.GroundOperations
                             join turnaround in check.Turnarounds on operation.TurnaroundId equals turnaround.Id
                             join carrier in check.Airlines on turnaround.AirlineId equals carrier.Id
                             where operation.PublicId == TimingOperation
                             select carrier.Name).SingleAsync(ct);
        var alert = Assert.Single(await check.DepartmentNotifications.AsNoTracking()
            .Where(item => item.Kind == "operation_ready_to_invoice").ToArrayAsync(ct));
        Assert.Equal((finance, Department.Finance, (long?)station, airline, (DateTimeOffset?)null),
            (alert.RecipientAccountId, alert.Department, alert.StationId, alert.Subject, alert.ReadAt));

        // Read, then OCC reopens the approval and approves it again the same day: the same alert, unread again.
        await check.DepartmentNotifications.Where(item => item.Id == alert.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.ReadAt, DateTimeOffset.UtcNow), ct);
        var token = (await DetailAsync()).ConcurrencyToken;
        var reopened = await Run(services => services.GetRequiredService<Elevant.Application.Abstractions.Operations.IOccReviewStore>()
            .ReopenAsync(new Elevant.Application.Operations.OccReviewReopenRequest(TimingOcc, [TimingStation], TimingOperation,
                handOffKey, token, "Revisar el servicio de equipaje", Guid.NewGuid(), Guid.NewGuid(), "alert-reopen"), ct));
        Assert.True(reopened.IsSuccess, reopened.Code);
        Assert.True((await ApproveAsync(reopened.Data!.SubmissionId, (await DetailAsync()).ConcurrencyToken)).IsSuccess);
        var again = Assert.Single(await check.DepartmentNotifications.AsNoTracking()
            .Where(item => item.Kind == "operation_ready_to_invoice").ToArrayAsync(ct));
        Assert.Equal((alert.Id, (DateTimeOffset?)null), (again.Id, again.ReadAt));
    }

    /// <summary>
    /// Holds <paramref name="service"/> in an older draft without invoice: an internal draft a failed issuance left before
    /// 4-N01's fix (Accepted) or a preinvoice of the retired module.
    /// </summary>
    private static async Task<long> HoldInOlderDraftAsync(ElevantDbContext db, OperationService service, CancellationToken ct,
        PreinvoiceStatus status = PreinvoiceStatus.Accepted)
    {
        var operation = await db.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == service.GroundOperationId, ct);
        var turnaround = await db.Turnarounds.AsNoTracking().SingleAsync(item => item.Id == operation.TurnaroundId, ct);
        var submission = await db.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == operation.Id).OrderByDescending(item => item.RevisionNumber).FirstAsync(ct);
        var account = await db.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id).SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var draft = new Preinvoice
        {
            PublicId = Guid.NewGuid(), AirlineId = turnaround.AirlineId, StationId = turnaround.StationId,
            CreatedByAccountId = account, RequestId = Guid.NewGuid(), PayloadHash = new string('A', 64),
            From = turnaround.OperationDate, To = turnaround.OperationDate, CurrencyCode = "USD", Total = 10m,
            Status = status, CreatedAt = now, UpdatedAt = now,
        };
        db.Preinvoices.Add(draft);
        await db.SaveChangesAsync(ct);
        db.PreinvoiceLines.Add(new PreinvoiceLine
        {
            PublicId = Guid.NewGuid(), PreinvoiceId = draft.Id, OperationServiceId = service.Id,
            ApprovedSubmissionId = submission.Id, LineNumber = 1, OperationCode = turnaround.OperationCode,
            OperationDate = turnaround.OperationDate, ServiceCode = "BAGGAGE", ServiceName = "Baggage", ExecutedQuantity = 1m,
            BillingUnit = "minute", UnitPrice = 10m, CurrencyCode = "USD", Amount = 10m, ComputedQuantity = 1m,
            ComputedAmount = 10m, CreatedAt = now, UpdatedAt = now,
        });
        await db.SaveChangesAsync(ct);
        return draft.Id;
    }

    /// <summary>
    /// Another turnaround of the package fixture's airline, station and day, with one BAGGAGE service covered by the
    /// package that ran <paramref name="minutes"/> minutes, handed off and approved by OCC.
    /// </summary>
    private static async Task<Guid> CoveredOperationAsync(ElevantDbContext db, PackageReviewFixture fixture, int minutes,
        CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var template = await db.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == fixture.OperationKey, ct);
        var original = await db.Turnarounds.AsNoTracking().SingleAsync(item => item.Id == template.TurnaroundId, ct);
        var source = await db.OperationServices.AsNoTracking().SingleAsync(item => item.Id == fixture.ServiceKey, ct);
        var sequence = await db.Turnarounds.CountAsync(item => item.OperationCode.StartsWith("DEV-TAT-PKG-"), ct) + 1;
        var at = PackageReviewSubmittedAt.AddHours(sequence);
        var turnaround = new Turnaround
        {
            PublicId = Guid.NewGuid(), OperationCode = $"DEV-TAT-PKG-{sequence}", AirlineId = original.AirlineId,
            StationId = original.StationId, OperationDate = original.OperationDate, AircraftTypeId = original.AircraftTypeId,
            AircraftRegistration = $"HI-PK{sequence}", CurrentStatus = original.CurrentStatus, Source = original.Source,
            CreatedAt = at, UpdatedAt = at,
        };
        db.Turnarounds.Add(turnaround);
        await db.SaveChangesAsync(ct);
        var operation = new GroundOperation
        {
            PublicId = Guid.NewGuid(), TurnaroundId = turnaround.Id, CurrentStatus = GroundOperationStatus.Approved,
            CreatedAt = at, UpdatedAt = at,
        };
        db.GroundOperations.Add(operation);
        await db.SaveChangesAsync(ct);
        var service = new OperationService
        {
            PublicId = Guid.NewGuid(), GroundOperationId = operation.Id, LineNumber = 1,
            ServiceDefinitionId = source.ServiceDefinitionId, ContractServiceRateId = source.ContractServiceRateId,
            ContractedQuantity = 1m, ExecutedQuantity = 1m, BillingUnitSnapshot = "minute", UnitPriceSnapshot = 0m,
            CurrencyCodeSnapshot = "USD", CurrentStatus = ServiceExecutionStatus.Completed, CreatedAt = at, UpdatedAt = at,
        };
        db.OperationServices.Add(service);
        await db.SaveChangesAsync(ct);
        db.Set<OperationServiceStatusEvent>().AddRange(
            new() { OperationServiceId = service.Id, ToStatus = ServiceExecutionStatus.InProgress, OccurredAt = at.AddMinutes(-minutes) },
            new() { OperationServiceId = service.Id, FromStatus = ServiceExecutionStatus.InProgress,
                ToStatus = ServiceExecutionStatus.Completed, OccurredAt = at });
        var checklistTemplate = await db.OperationChecklists.AsNoTracking().Select(item => item.ChecklistTemplateVersionId).FirstAsync(ct);
        var agent = await db.RampAgents.SingleAsync(item => item.EmployeeNumber == "DEV-RA-001", ct);
        var checklist = new OperationChecklist
        {
            PublicId = Guid.NewGuid(), GroundOperationId = operation.Id, ChecklistTemplateVersionId = checklistTemplate,
            RevisionNumber = 1, Status = ChecklistStatus.Submitted, StartedAt = at.AddMinutes(-minutes), SubmittedAt = at,
            SubmittedByRampAgentId = agent.Id, CreatedAt = at, UpdatedAt = at,
        };
        db.OperationChecklists.Add(checklist);
        await db.SaveChangesAsync(ct);
        var submission = new OperationSubmission
        {
            PublicId = Guid.NewGuid(), GroundOperationId = operation.Id, OperationChecklistId = checklist.Id, RevisionNumber = 1,
            Status = SubmissionStatus.Approved, SubmittedByRampAgentId = agent.Id, SubmittedAt = at, CreatedAt = at, UpdatedAt = at,
        };
        db.OperationSubmissions.Add(submission);
        await db.SaveChangesAsync(ct);
        submission.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(db, operation.Id, ct, at)).ToJson();
        var reviewer = await db.Users.Where(item => item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000001"))
            .Select(item => item.Id).SingleAsync(ct);
        db.ReviewDecisions.Add(new() { PublicId = Guid.NewGuid(), OperationSubmissionId = submission.Id, ReviewerAccountId = reviewer,
            Outcome = ReviewOutcome.Approved, DecidedAt = at.AddMinutes(1), CreatedAt = at, UpdatedAt = at });
        await db.SaveChangesAsync(ct);
        return operation.PublicId;
    }
}
