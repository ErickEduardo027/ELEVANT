using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>ADR-0036: the airline pays its own invoice with a simulated card, for the whole balance only.</summary>
    [Fact]
    public async Task CardPaymentPaysTheWholeBalanceKeepsOnlyBrandAndLast4AndIsIdempotent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        IssueInvoiceResult issued;
        await using (var scope = provider.CreateAsyncScope())
            issued = await Handler(scope.ServiceProvider).HandleAsync(
                new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        var total = issued.Total!.Value;
        var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");

        async Task<CardPaymentResult> PayAsync(Guid account, string card, decimal amount, Guid key)
        {
            await using var context = CreateContext(database.ConnectionString);
            var store = new EfCardPaymentStore(context, TimeProvider.System, new SimulatedCardGateway());
            return await store.PayAsync(new PayInvoiceByCardRequest(account, issued.InvoiceId!.Value, key, "Casey Airline",
                card, 12, 2030, "123", amount), ct);
        }

        // Another department never pays an airline invoice.
        Assert.Equal(CardPaymentFailure.Forbidden, (await PayAsync(ContractsAccount, "4111111111111111", total, Guid.NewGuid())).Failure);

        var declinedKey = Guid.NewGuid();
        var declined = await PayAsync(airlineAccount, "4000000000000002", total, declinedKey);
        Assert.True(declined.IsSuccess);
        Assert.Equal(("Declined", "insufficient_funds", "0002"), (declined.Attempt!.Status, declined.Attempt.DeclineCode, declined.Attempt.Last4));
        Assert.Equal(total, declined.InvoiceBalance);
        var replay = await PayAsync(airlineAccount, "4000000000000002", total, declinedKey);
        Assert.True(replay.Replayed);
        Assert.Equal(declined.Attempt.Id, replay.Attempt!.Id);
        var reused = await PayAsync(airlineAccount, "4111111111111111", total, declinedKey);
        Assert.Equal((CardPaymentFailure.Conflict, "idempotency_conflict"), (reused.Failure!.Value, reused.Reasons.Single()));

        var error = await PayAsync(airlineAccount, "4000000000000119", total, Guid.NewGuid());
        Assert.Equal(("Error", "processing_error"), (error.Attempt!.Status, error.Attempt.DeclineCode));
        var partial = await PayAsync(airlineAccount, "4111111111111111", total - 1m, Guid.NewGuid());
        Assert.Equal((CardPaymentFailure.Conflict, "amount_mismatch"), (partial.Failure!.Value, partial.Reasons.Single()));

        var approved = await PayAsync(airlineAccount, "4111 1111 1111 1111", total, Guid.NewGuid());
        Assert.Equal(("Approved", "Visa", "1111"), (approved.Attempt!.Status, approved.Attempt.Brand, approved.Attempt.Last4));
        Assert.Equal(0m, approved.InvoiceBalance);
        Assert.NotNull(approved.Attempt.ReceiptId);
        var again = await PayAsync(airlineAccount, "5555555555554444", total, Guid.NewGuid());
        Assert.Equal((CardPaymentFailure.Conflict, "invoice_paid"), (again.Failure!.Value, again.Reasons.Single()));

        setup.ChangeTracker.Clear();
        var receipt = await setup.Set<FinanceTreasuryReceipt>().AsNoTracking()
            .SingleAsync(item => item.PublicId == approved.Attempt.ReceiptId, ct);
        Assert.Equal((PaymentMethod.Card, total), (receipt.Method, receipt.Amount));
        Assert.Contains("*1111", receipt.Reference, StringComparison.Ordinal);
        Assert.Equal(3, await setup.Set<CardPaymentAttempt>().CountAsync(ct));

        // The card number and the security code are stored nowhere.
        var stored = string.Join("|", await setup.Set<CardPaymentAttempt>().AsNoTracking()
            .Select(item => item.RequestHash + item.Brand + item.Last4 + item.DeclineCode + item.AuthorizationCode).ToArrayAsync(ct));
        stored += string.Join("|", await setup.AuditEntries.AsNoTracking().Where(item => item.Action.StartsWith("finance.card_payment"))
            .Select(item => item.MetadataJson ?? "").ToArrayAsync(ct));
        stored += string.Join("|", await setup.Set<EmailOutboxMessage>().AsNoTracking().Select(item => item.TextBody).ToArrayAsync(ct));
        Assert.DoesNotContain("4111111111111111", stored, StringComparison.Ordinal);
        Assert.DoesNotContain("4000000000000002", stored, StringComparison.Ordinal);
        Assert.Equal(3, await setup.AuditEntries.CountAsync(item => item.Action.StartsWith("finance.card_payment"), ct));

        var email = Assert.Single(await setup.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.PaymentReceived).ToArrayAsync(ct));
        Assert.Equal($"card-receipt:{approved.Attempt.Id:D}", email.AttachmentReference);
        Assert.Contains("1111", email.TextBody, StringComparison.Ordinal);
        Assert.True(await setup.Set<DepartmentNotification>().AnyAsync(item => item.Kind == "invoice_paid", ct));

        await using (var context = CreateContext(database.ConnectionString))
        {
            var store = new EfCardPaymentStore(context, TimeProvider.System, new SimulatedCardGateway());
            var receiptData = await store.AirlineReceiptAsync(airlineAccount, approved.Attempt.Id, ct);
            Assert.Equal(("Visa", "1111", total), (receiptData!.Brand, receiptData.Last4, receiptData.Amount));
            Assert.Null(await store.AirlineReceiptAsync(airlineAccount, declined.Attempt.Id, ct));
            Assert.Equal(3, (await store.FinanceAttemptsAsync(FinanceAccount, issued.InvoiceId!.Value, ct))!.Count);
            Assert.Equal(3, (await store.AirlineAttemptsAsync(airlineAccount, issued.InvoiceId!.Value, ct))!.Count);
            Assert.Null(await store.FinanceAttemptsAsync(airlineAccount, issued.InvoiceId!.Value, ct));
            var pdf = new FinancialDocumentPdfRenderer().RenderCardReceipt(receiptData);
            Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdf, 0, 5));
        }
    }
}
