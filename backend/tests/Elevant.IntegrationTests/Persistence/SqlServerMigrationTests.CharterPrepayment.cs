using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>Phase 4, block C (4-N22): the prepayment of a charter, whenever Finance confirms it, settles its invoice once.</summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// 4-N22: a prepayment Finance confirms after the charter was invoiced settles the open invoice at once (the excess
    /// stays as the airline's credit) and Finance and the portal hear it. The same key replays it, another body with the
    /// key is refused, and once applied it is neither corrected nor reopened in place: Finance reverses the receipt in
    /// «Cobros», reopens and confirms again, which posts a new receipt.
    /// </summary>
    [Fact]
    public async Task ACharterPrepaymentConfirmedAfterTheInvoiceSettlesItOnce()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var (charterId, agreementId) = await AddPendingCharterAsync(setup, "DEV-TAT-0002", ct);
        var charters = new CharterCommands(provider, station, charterId, ct);

        // Invoiced while the prepayment is pending: nothing is applied yet.
        var issued = await IssueOperationAsync(provider, station, operation, ct);
        var total = issued.Total!.Value;
        Assert.Equal(0, await CharterReceiptsAsync(setup, agreementId, ct));

        // Confirmed afterwards: one receipt names the charter and settles the invoice; the rest is the airline's credit.
        var key = Guid.NewGuid();
        var seen = await charters.VersionAsync();
        var confirmed = await charters.ConfirmAsync(15000m, "TRF-QA-15000", seen, key);
        Assert.Equal(("Confirmed", (decimal?)15000m), (confirmed.Value!.PrepaymentStatus, confirmed.Value.PrepaymentAmount));
        var receipt = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.CharterAgreementId == agreementId, ct);
        Assert.Equal((15000m, "PREPAGO TRF-QA-15000", PaymentMethod.Transfer), (receipt.Amount, receipt.Reference, receipt.Method));
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        Assert.Equal(total, await AppliedAsync(setup, receipt.Id, ct));
        Assert.Equal(0m, await FinanceTreasuryBalances.BalanceAsync(setup, invoice.Id, invoice.Total, ct));
        Assert.True(await HintAsync(setup, "finance_invoices", invoice.PublicId, ct));
        Assert.True(await HintAsync(setup, "finance_receipts", receipt.PublicId, ct));
        Assert.True(await HintAsync(setup, "airline_treasury", null, ct));
        var audit = await setup.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "finance.charter.prepayment_confirmed" && item.EntityPublicId == charterId, ct);
        using (var metadata = JsonDocument.Parse(audit.MetadataJson!))
            Assert.Equal(invoice.PublicId, metadata.RootElement.GetProperty("appliedToInvoiceId").GetGuid());

        // The same key and body replay the first answer; the key with another body is refused; nothing is posted twice.
        var replayed = await charters.ConfirmAsync(15000m, "TRF-QA-15000", seen, key);
        Assert.True(replayed.Replayed);
        Assert.Equal(confirmed.Value.Version, replayed.Value!.Version);
        Assert.Equal("idempotency_conflict", (await charters.ConfirmAsync(1500m, "TRF-QA-15000",
            confirmed.Value.Version!, key, "Monto mal capturado")).Code);
        Assert.Equal(1, await CharterReceiptsAsync(setup, agreementId, ct));

        // Applied, it is neither corrected nor reopened in place.
        var current = await charters.VersionAsync();
        Assert.Equal(CharterCodes.PrepaymentApplied, (await charters.ConfirmAsync(1500m, "TRF-QA-1500", current,
            Guid.NewGuid(), "Monto mal capturado")).Code);
        Assert.Equal(CharterCodes.PrepaymentApplied, (await charters.ReopenAsync(current, Guid.NewGuid())).Code);

        // Finance reverses the receipt in «Cobros», reopens the prepayment and confirms the right amount: a new receipt.
        await using (var scope = provider.CreateAsyncScope())
        {
            var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
            var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
            var read = (await treasury.GetAsync(FinanceAccount, receipt.PublicId, ct))!;
            var application = Assert.Single(read.Movements, item => item.Kind == "Application");
            var undone = await treasury.ReverseAsync(FinanceAccount, receipt.PublicId, new FinanceTreasuryReverseInput(
                Guid.NewGuid(), read.Version, today, "Prepago mal capturado", application.Id), ct);
            Assert.True(undone.IsSuccess, $"{undone.Failure} {undone.Code}");
            var reversed = await treasury.ReverseAsync(FinanceAccount, receipt.PublicId, new FinanceTreasuryReverseInput(
                Guid.NewGuid(), undone.Version!, today, "Prepago mal capturado"), ct);
            Assert.True(reversed.IsSuccess, $"{reversed.Failure} {reversed.Code}");
        }
        Assert.Equal(total, await FinanceTreasuryBalances.BalanceAsync(setup, invoice.Id, invoice.Total, ct));
        var reopened = await charters.ReopenAsync(await charters.VersionAsync(), Guid.NewGuid());
        Assert.Equal("Pending", reopened.Value!.PrepaymentStatus);
        Assert.Equal("Confirmed", (await charters.ConfirmAsync(1500m, "TRF-QA-1500", reopened.Value.Version!,
            Guid.NewGuid())).Value!.PrepaymentStatus);
        Assert.Equal(2, await CharterReceiptsAsync(setup, agreementId, ct));
        var corrected = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.CharterAgreementId == agreementId && item.Reference == "PREPAGO TRF-QA-1500", ct);
        Assert.Equal(Math.Min(1500m, total), await AppliedAsync(setup, corrected.Id, ct));
        Assert.Equal(Math.Max(0m, total - 1500m), await FinanceTreasuryBalances.BalanceAsync(setup, invoice.Id, invoice.Total, ct));
    }

    /// <summary>
    /// 4-N22: a prepayment captured wrong (15 000 instead of 1 500) is corrected with its reason before it is applied:
    /// the audit keeps the amount before and after, and the issuance applies the corrected amount.
    /// </summary>
    [Fact]
    public async Task ACharterPrepaymentCorrectedBeforeTheInvoiceIsTheOneTheIssuanceApplies()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var (charterId, agreementId) = await AddPendingCharterAsync(setup, "DEV-TAT-0002", ct);
        var charters = new CharterCommands(provider, station, charterId, ct);

        var wrong = await charters.ConfirmAsync(15000m, "TRF-QA-15000", await charters.VersionAsync(), Guid.NewGuid());
        Assert.Equal("Confirmed", wrong.Value!.PrepaymentStatus);
        Assert.Equal(0, await CharterReceiptsAsync(setup, agreementId, ct));
        Assert.Equal("reason_required", (await charters.ConfirmAsync(1500m, "TRF-QA-1500", wrong.Value.Version!,
            Guid.NewGuid())).Code);
        var right = await charters.ConfirmAsync(1500m, "TRF-QA-1500", wrong.Value.Version!, Guid.NewGuid(),
            "Se capturó 15 000 en vez de 1 500");
        Assert.Equal(("Confirmed", (decimal?)1500m, "TRF-QA-1500"), (right.Value!.PrepaymentStatus,
            right.Value.PrepaymentAmount, right.Value.PrepaymentReference));
        var audit = await setup.AuditEntries.AsNoTracking()
            .SingleAsync(item => item.Action == "finance.charter.prepayment_corrected" && item.EntityPublicId == charterId, ct);
        Assert.Equal("Se capturó 15 000 en vez de 1 500", audit.Reason);
        using (var metadata = JsonDocument.Parse(audit.MetadataJson!))
        {
            Assert.Equal(15000m, metadata.RootElement.GetProperty("before").GetProperty("amount").GetDecimal());
            Assert.Equal(1500m, metadata.RootElement.GetProperty("amount").GetDecimal());
        }

        var issued = await IssueOperationAsync(provider, station, operation, ct);
        var receipt = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.CharterAgreementId == agreementId, ct);
        Assert.Equal((1500m, "PREPAGO TRF-QA-1500"), (receipt.Amount, receipt.Reference));
        Assert.Equal(Math.Min(1500m, issued.Total!.Value), await AppliedAsync(setup, receipt.Id, ct));
    }

    /// <summary>
    /// 4-N22: Finance confirms the prepayment while the invoice is being issued: whichever commits first, the
    /// prepayment becomes exactly one receipt on that invoice.
    /// </summary>
    [Fact]
    public async Task ConfirmingAPrepaymentWhileItsInvoiceIsIssuedPostsItOnce()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var (charterId, agreementId) = await AddPendingCharterAsync(setup, "DEV-TAT-0002", ct);
        var charters = new CharterCommands(provider, station, charterId, ct);
        var version = await charters.VersionAsync();

        var confirming = charters.ConfirmAsync(500m, "TRF-QA-500", version, Guid.NewGuid());
        var issuing = IssueOperationAsync(provider, station, operation, ct);
        await Task.WhenAll(confirming, issuing);
        Assert.True((await confirming).Value is not null, (await confirming).Code);
        var issued = await issuing;
        Assert.Equal(1, await CharterReceiptsAsync(setup, agreementId, ct));
        var receipt = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.CharterAgreementId == agreementId, ct);
        Assert.Equal(Math.Min(500m, issued.Total!.Value), await AppliedAsync(setup, receipt.Id, ct));
    }

    /// <summary>
    /// 4-N22: Finance corrects an applied prepayment by reversing its receipt, reopening and confirming it again, as many
    /// times as it needs and with the same bank reference: every confirmation posts a receipt of its own, whose reference
    /// keeps the receipt's id within the column even after the longest bank reference.
    /// </summary>
    [Fact]
    public async Task APrepaymentReversedAndConfirmedAgainWithTheSameReferencePostsEachTime()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var (charterId, agreementId) = await AddPendingCharterAsync(setup, "DEV-TAT-0002", ct);
        var charters = new CharterCommands(provider, station, charterId, ct);
        var issued = await IssueOperationAsync(provider, station, operation, ct);
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        var reference = "TRF-QA-" + new string('7', 73);

        var first = await charters.ConfirmAsync(1500m, reference, await charters.VersionAsync(), Guid.NewGuid());
        Assert.True(first.Value is not null, first.Code);
        for (var cycle = 0; cycle < 2; cycle++)
        {
            var standing = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
                .Where(item => item.CharterAgreementId == agreementId).OrderByDescending(item => item.Id).FirstAsync(ct);
            await ReverseReceiptAsync(provider, standing.PublicId, ct);
            var reopened = await charters.ReopenAsync(await charters.VersionAsync(), Guid.NewGuid());
            Assert.True(reopened.Value is not null, reopened.Code);
            var confirmed = await charters.ConfirmAsync(1500m, reference, reopened.Value!.Version!, Guid.NewGuid());
            Assert.True(confirmed.Value is not null, confirmed.Code);
        }

        var receipts = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .Where(item => item.CharterAgreementId == agreementId).OrderBy(item => item.Id).ToArrayAsync(ct);
        Assert.Equal(3, receipts.Length);
        Assert.Equal($"PREPAGO {reference}", receipts[0].Reference);
        Assert.All(receipts[1..], receipt => Assert.Equal(
            CharterRules.PrepaymentReceiptReference(reference, receipt.PublicId), receipt.Reference));
        Assert.Equal(3, receipts.Select(item => item.Reference).Distinct().Count());
        // Only the last receipt still settles the invoice.
        Assert.Equal(Math.Min(1500m, invoice.Total), await AppliedAsync(setup, receipts[2].Id, ct));
        Assert.Equal(Math.Max(0m, invoice.Total - 1500m),
            await FinanceTreasuryBalances.BalanceAsync(setup, invoice.Id, invoice.Total, ct));
    }

    /// <summary>
    /// 4-N22: a receipt of the airline that takes the prepayment's reference while it is posted is
    /// <c>charter_prepayment_receipt_conflict</c>, not a stale charter: nothing is written, and the same intent (key and
    /// body) confirms the prepayment afterwards.
    /// </summary>
    [Fact]
    public async Task AReceiptThatTakesThePrepaymentReferenceMeanwhileIsExplained()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var (charterId, agreementId) = await AddPendingCharterAsync(setup, "DEV-TAT-0002", ct);
        var charters = new CharterCommands(provider, station, charterId, ct);
        var issued = await IssueOperationAsync(provider, station, operation, ct);
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        // A transfer of the airline Finance recorded in «Cobros».
        var financeId = await setup.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id)
            .SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        setup.Add(new FinanceTreasuryReceipt
        {
            PublicId = Guid.CreateVersion7(), AirlineId = invoice.AirlineId, StationId = invoice.StationId,
            ActorAccountId = financeId, RequestId = Guid.NewGuid(), Reference = "TRF-QA-COBROS",
            CurrencyCode = invoice.CurrencyCode, Method = PaymentMethod.Transfer, ReceivedOn = BusinessCalendar.Today(now),
            Amount = 10m, Reason = "Transferencia registrada en Cobros.", CreatedAt = now, UpdatedAt = now,
        });
        await setup.SaveChangesAsync(ct);
        setup.ChangeTracker.Clear();

        var key = Guid.NewGuid();
        var version = await charters.VersionAsync();
        await using (var racing = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>()
                         .UseSqlServer(database.ConnectionString, ElevantSqlServerOptions.Configure)
                         .AddInterceptors(new TakeReceiptReference("TRF-QA-COBROS")).Options))
        {
            var refused = await new EfCharterStore(racing, TimeProvider.System).ConfirmPrepaymentAsync(FinanceAccount,
                [station], charterId, 500m, "TRF-QA-500", null, version, key, "charter-prepayment-test", ct);
            Assert.Equal((MasterDataFailure.Conflict, CharterCodes.PrepaymentReceiptConflict),
                (refused.Failure, refused.Code));
        }
        // Nothing was written: the prepayment is still pending, without receipt, and the same intent confirms it.
        Assert.Equal(version, await charters.VersionAsync());
        Assert.Equal(0, await CharterReceiptsAsync(setup, agreementId, ct));
        var confirmed = await charters.ConfirmAsync(500m, "TRF-QA-500", version, key);
        Assert.Equal(("Confirmed", false), (confirmed.Value!.PrepaymentStatus, confirmed.Replayed));
        Assert.Equal(1, await CharterReceiptsAsync(setup, agreementId, ct));
    }

    /// <summary>
    /// 4-N22: a charter invoiced before receipts named their charter keeps the receipt its issuance posted then, without
    /// <c>charter_agreement_id</c>. That prepayment is applied: it is neither corrected nor reopened in place, confirming
    /// it again posts no second receipt, and once Finance reverses that receipt it is reopened and confirmed with a
    /// receipt of its own.
    /// </summary>
    [Fact]
    public async Task APrepaymentPostedBeforeReceiptsNamedTheirCharterIsAppliedOnce()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct);
        var (charterId, agreementId) = await AddPendingCharterAsync(setup, "DEV-TAT-0002", ct);
        var charters = new CharterCommands(provider, station, charterId, ct);
        var issued = await IssueOperationAsync(provider, station, operation, ct);
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        var unlinked = await PostUnlinkedPrepaymentAsync(setup, invoice, agreementId, 15000m, "TRF-QA-UNLINKED", ct);
        Assert.Equal(Math.Min(15000m, invoice.Total), await AppliedAsync(setup, unlinked.Id, ct));

        // Applied, it is neither corrected nor reopened in place, and the same prepayment again changes nothing.
        var current = await charters.VersionAsync();
        Assert.Equal(CharterCodes.PrepaymentApplied, (await charters.ConfirmAsync(1500m, "TRF-QA-1500", current,
            Guid.NewGuid(), "Monto mal capturado")).Code);
        Assert.Equal(CharterCodes.PrepaymentApplied, (await charters.ReopenAsync(current, Guid.NewGuid())).Code);
        Assert.Equal(current, (await charters.ConfirmAsync(15000m, "TRF-QA-UNLINKED", current, Guid.NewGuid()))
            .Value!.Version);
        Assert.Equal(1, await PrepaymentReceiptsAsync(setup, invoice.AirlineId, ct));

        // Reopened back then without reversing that receipt: confirming it now posts no second receipt.
        await setup.Set<CharterAgreement>().Where(item => item.Id == agreementId).ExecuteUpdateAsync(set => set
            .SetProperty(item => item.PrepaymentStatus, CharterPrepaymentStatus.Pending)
            .SetProperty(item => item.PrepaymentConfirmedAt, (DateTimeOffset?)null)
            .SetProperty(item => item.PrepaymentConfirmedByAccountId, (long?)null), ct);
        var again = await charters.ConfirmAsync(15000m, "TRF-QA-UNLINKED", await charters.VersionAsync(), Guid.NewGuid());
        Assert.Equal("Confirmed", again.Value!.PrepaymentStatus);
        Assert.Equal(1, await PrepaymentReceiptsAsync(setup, invoice.AirlineId, ct));
        Assert.Equal(Math.Max(0m, invoice.Total - 15000m),
            await FinanceTreasuryBalances.BalanceAsync(setup, invoice.Id, invoice.Total, ct));

        // Finance reverses that receipt in «Cobros», reopens and confirms the right amount: a receipt of its own.
        await ReverseReceiptAsync(provider, unlinked.PublicId, ct);
        var reopened = await charters.ReopenAsync(await charters.VersionAsync(), Guid.NewGuid());
        Assert.True(reopened.Value is not null, reopened.Code);
        var corrected = await charters.ConfirmAsync(1500m, "TRF-QA-UNLINKED", reopened.Value!.Version!, Guid.NewGuid());
        Assert.True(corrected.Value is not null, corrected.Code);
        var own = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.CharterAgreementId == agreementId, ct);
        Assert.Equal((1500m, CharterRules.PrepaymentReceiptReference("TRF-QA-UNLINKED", own.PublicId)),
            (own.Amount, own.Reference));
        Assert.Equal(Math.Min(1500m, invoice.Total), await AppliedAsync(setup, own.Id, ct));
        Assert.Equal(Math.Max(0m, invoice.Total - 1500m),
            await FinanceTreasuryBalances.BalanceAsync(setup, invoice.Id, invoice.Total, ct));
    }

    /// <summary>
    /// What the issuance did before 4-N22 named the charter on its receipt: with the prepayment confirmed, it posted it as
    /// «PREPAGO {reference}» without <c>charter_agreement_id</c>, applied to the charter's invoice.
    /// </summary>
    private static async Task<FinanceTreasuryReceipt> PostUnlinkedPrepaymentAsync(ElevantDbContext context,
        NonFiscalInvoice invoice, long agreementId, decimal amount, string reference, CancellationToken ct)
    {
        context.ChangeTracker.Clear();
        var financeId = await context.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id)
            .SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        await context.Set<CharterAgreement>().Where(item => item.Id == agreementId).ExecuteUpdateAsync(set => set
            .SetProperty(item => item.PrepaymentStatus, CharterPrepaymentStatus.Confirmed)
            .SetProperty(item => item.PrepaymentAmount, amount)
            .SetProperty(item => item.PrepaymentReference, reference)
            .SetProperty(item => item.PrepaymentConfirmedAt, now)
            .SetProperty(item => item.PrepaymentConfirmedByAccountId, financeId), ct);
        var posted = await FinanceTreasuryPosting.ReceiveAndApplyAsync(context, invoice, invoice.IssuedByAccountId,
            PaymentMethod.Transfer, $"PREPAGO {reference}", amount, CharterPrepaymentPosting.Reason, now, ct);
        context.ChangeTracker.Clear();
        return posted.Receipt;
    }

    /// <summary>Finance reverses a receipt in «Cobros»: first its application to the invoice, then the receipt.</summary>
    private static async Task ReverseReceiptAsync(ServiceProvider provider, Guid receiptId, CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var read = (await treasury.GetAsync(FinanceAccount, receiptId, ct))!;
        var application = Assert.Single(read.Movements, item => item.Kind == "Application");
        var undone = await treasury.ReverseAsync(FinanceAccount, receiptId, new FinanceTreasuryReverseInput(
            Guid.NewGuid(), read.Version, today, "Prepago mal capturado", application.Id), ct);
        Assert.True(undone.IsSuccess, $"{undone.Failure} {undone.Code}");
        var reversed = await treasury.ReverseAsync(FinanceAccount, receiptId, new FinanceTreasuryReverseInput(
            Guid.NewGuid(), undone.Version!, today, "Prepago mal capturado"), ct);
        Assert.True(reversed.IsSuccess, $"{reversed.Failure} {reversed.Code}");
    }

    /// <summary>
    /// Gives the receipt a command posts the reference another receipt of the airline holds, as a receipt recorded at the
    /// same moment would.
    /// </summary>
    private sealed class TakeReceiptReference(string reference) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            foreach (var entry in eventData.Context!.ChangeTracker.Entries<FinanceTreasuryReceipt>()
                         .Where(entry => entry.State == EntityState.Added))
                entry.Entity.Reference = reference;
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    /// <summary>The receipts of the airline's charter prepayments, with or without the charter they name.</summary>
    private static Task<int> PrepaymentReceiptsAsync(ElevantDbContext context, long airlineId, CancellationToken ct) =>
        context.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .CountAsync(item => item.AirlineId == airlineId && item.Reason == CharterPrepaymentPosting.Reason, ct);

    /// <summary>The charter commands of Finance's account at one station.</summary>
    private sealed class CharterCommands(ServiceProvider provider, Guid station, Guid charterId, CancellationToken ct)
    {
        public async Task<MasterDataResult<CharterPrepaymentItem>> ConfirmAsync(decimal amount, string reference,
            string version, Guid key, string? reason = null)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<ICharterStore>().ConfirmPrepaymentAsync(FinanceAccount,
                [station], charterId, amount, reference, reason, version, key, "charter-prepayment-test", ct);
        }

        public async Task<MasterDataResult<CharterPrepaymentItem>> ReopenAsync(string version, Guid key)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<ICharterStore>().ReopenPrepaymentAsync(FinanceAccount,
                [station], charterId, "El transportista pidió corregir el prepago", version, key, "charter-prepayment-test", ct);
        }

        public async Task<string> VersionAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return Assert.Single(await scope.ServiceProvider.GetRequiredService<ICharterStore>()
                .ListForFinanceAsync([station], ct), item => item.Id == charterId).Version!;
        }
    }

    /// <summary>The operation's turnaround becomes a charter of its airline whose prepayment is pending.</summary>
    private static async Task<(Guid PublicId, long Id)> AddPendingCharterAsync(ElevantDbContext context, string code,
        CancellationToken ct)
    {
        context.ChangeTracker.Clear();
        var turnaround = await context.Turnarounds.AsNoTracking().SingleAsync(item => item.OperationCode == code, ct);
        var financeId = await context.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id)
            .SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var agreement = new CharterAgreement
        {
            PublicId = Guid.NewGuid(), TurnaroundId = turnaround.Id, AirlineId = turnaround.AirlineId, CurrencyCode = "USD",
            PrepaymentStatus = CharterPrepaymentStatus.Pending, CreatedByAccountId = financeId, CreatedAt = now,
            UpdatedAt = now,
        };
        context.Add(agreement);
        await context.SaveChangesAsync(ct);
        context.ChangeTracker.Clear();
        return (agreement.PublicId, agreement.Id);
    }

    private static Task<int> CharterReceiptsAsync(ElevantDbContext context, long agreementId, CancellationToken ct) =>
        context.Set<FinanceTreasuryReceipt>().AsNoTracking().CountAsync(item => item.CharterAgreementId == agreementId, ct);

    /// <summary>What a receipt still applies to invoices: its applications less their reversals.</summary>
    private static async Task<decimal> AppliedAsync(ElevantDbContext context, long receiptId, CancellationToken ct)
    {
        var moves = await context.Set<FinanceTreasuryMovement>().AsNoTracking().Where(item => item.ReceiptId == receiptId)
            .Select(item => new { item.Kind, item.InvoiceAmount }).ToArrayAsync(ct);
        return moves.Sum(item => item.Kind switch
        {
            FinanceTreasuryMovementKind.Application => item.InvoiceAmount,
            FinanceTreasuryMovementKind.ApplicationReversal => -item.InvoiceAmount,
            _ => 0m,
        });
    }

    /// <summary>Whether a realtime hint of <paramref name="resource"/> (about <paramref name="resourceId"/>) was queued.</summary>
    private static Task<bool> HintAsync(ElevantDbContext context, string resource, Guid? resourceId, CancellationToken ct)
    {
        var name = $"\"resource\":\"{resource}\"";
        var id = resourceId?.ToString("D") ?? string.Empty;
        return context.OutboxMessages.AsNoTracking()
            .AnyAsync(item => item.PayloadJson.Contains(name) && item.PayloadJson.Contains(id), ct);
    }
}
