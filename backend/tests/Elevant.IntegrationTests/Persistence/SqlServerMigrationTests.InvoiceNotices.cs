using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>Phase 4, block C (4-N23): what the airline is told by email about its invoices.</summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid DemoAirlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");

    /// <summary>
    /// 4-N23: «Factura emitida» states the total and the due date but never a balance; a credit note is emailed to the
    /// airline with its PDF (the e-NCF E34), once, a replay of the same note queueing nothing.
    /// </summary>
    [Fact]
    public async Task InvoiceEmailsStateNoBalanceAndANoteIsEmailedOnceWithItsPdf()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var issued = await IssueOperationAsync(provider, station, await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct), ct);

        var invoiceEmails = await setup.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.InvoiceIssued).ToArrayAsync(ct);
        Assert.NotEmpty(invoiceEmails);
        Assert.All(invoiceEmails, email =>
        {
            Assert.DoesNotContain("Saldo", email.TextBody!, StringComparison.Ordinal);
            Assert.Contains("Consulta el saldo vigente", email.TextBody!, StringComparison.Ordinal);
            Assert.Contains(FinanceInvoicePolicy.Disclaimer, email.TextBody!, StringComparison.Ordinal);
        });

        // A credit note: the airline gets its own email with the note's PDF; the same request again queues nothing.
        FinanceTreasuryAdjustmentInput input;
        await using (var scope = provider.CreateAsyncScope())
        {
            var limits = (await scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>()
                .AdjustmentsAsync(FinanceAccount, issued.InvoiceId!.Value, ct))!;
            input = new FinanceTreasuryAdjustmentInput(Guid.NewGuid(), limits.Version,
                BusinessCalendar.Today(DateTimeOffset.UtcNow), "Servicio cobrado de más", "Credit", SmallCredit(limits));
        }
        async Task<FinanceTreasuryResult> IssueAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>()
                .IssueAdjustmentAsync(FinanceAccount, issued.InvoiceId!.Value, input, ct);
        }
        var note = await IssueAsync();
        Assert.True(note.IsSuccess, $"{note.Failure} {note.Code}");
        var noteEmails = await setup.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.AdjustmentNoteIssued).ToArrayAsync(ct);
        Assert.Equal(invoiceEmails.Select(item => item.Recipient).Order(), noteEmails.Select(item => item.Recipient).Order());
        var number = await setup.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
            .Where(item => item.PublicId == note.Id).Select(item => item.Number).SingleAsync(ct);
        Assert.StartsWith(FinanceInvoicePolicy.CreditNoteFiscalPrefix, number, StringComparison.Ordinal);
        Assert.All(noteEmails, email =>
        {
            Assert.Equal($"adjustment-note:{note.Id:D}", email.AttachmentReference);
            Assert.Contains($"Nota de crédito {number}", email.Subject, StringComparison.Ordinal);
            Assert.Contains(issued.FiscalNumber!, email.TextBody!, StringComparison.Ordinal);
            Assert.DoesNotContain("Saldo", email.TextBody!, StringComparison.Ordinal);
            Assert.Contains(FinanceInvoicePolicy.Disclaimer, email.TextBody!, StringComparison.Ordinal);
        });
        Assert.True((await IssueAsync()).Replayed);
        Assert.Equal(noteEmails.Length, await setup.Set<EmailOutboxMessage>()
            .CountAsync(item => item.Purpose == EmailPurpose.AdjustmentNoteIssued, ct));

        // The email's attachment is the note's PDF, rendered when the email is sent.
        var attachment = await new EfAdjustmentNoteAttachmentResolver(setup, new FinancialDocumentPdfRenderer())
            .ResolveAsync(noteEmails[0].AttachmentReference!, ct);
        Assert.NotNull(attachment);
        Assert.Equal(($"nota-{number}.pdf", "application/pdf"), (attachment.FileName, attachment.ContentType));
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(attachment.Content, 0, 5), StringComparison.Ordinal);
        Assert.Null(await new EfAdjustmentNoteAttachmentResolver(setup, new FinancialDocumentPdfRenderer())
            .ResolveAsync($"adjustment-note:{Guid.NewGuid():D}", ct));
    }

    /// <summary>
    /// 4-N23: an invoice past its due date with a balance is notified once, from the first business day of Santo Domingo
    /// after the due date (at 21:00 local of that day it is not overdue yet); a paid one never is, and a second sweep
    /// queues nothing.
    /// </summary>
    [Fact]
    public async Task AnOverdueInvoiceIsNotifiedOnceByTheBusinessDayOfSantoDomingo()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var unpaid = await IssueOperationAsync(provider, station, await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct), ct);
        var paid = await IssueOperationAsync(provider, station, await ApproveForInvoicingAsync(setup, "DEV-TAT-0002", ct), ct);
        await using (var cardContext = CreateContext(database.ConnectionString))
        {
            var payment = await new EfCardPaymentStore(cardContext, TimeProvider.System, new SimulatedCardGateway())
                .PayAsync(new PayInvoiceByCardRequest(DemoAirlineAccount, paid.InvoiceId!.Value, Guid.NewGuid(),
                    "Casey Airline", "4111111111111111", 12, 2030, "123", paid.Total!.Value), ct);
            Assert.Equal("Approved", payment.Attempt!.Status);
        }
        var due = BusinessCalendar.Today(DateTimeOffset.UtcNow).AddDays(-10);
        await setup.NonFiscalInvoices.Where(item => item.PublicId == unpaid.InvoiceId || item.PublicId == paid.InvoiceId)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.DueDate, due), ct);
        var santoDomingo = TimeSpan.FromHours(-4);
        async Task<int> SweepAsync(DateTimeOffset now)
        {
            await using var context = CreateContext(database.ConnectionString);
            return await new EfInvoiceOverdueNoticeStore(context).SweepAsync(now, InvoiceOverdueNotices.BatchSize, ct);
        }
        Task<int> NoticesAsync() => setup.Set<EmailOutboxMessage>().CountAsync(item => item.Purpose == EmailPurpose.InvoiceOverdue, ct);

        // 21:00 in Santo Domingo of the due date is 01:00 UTC of the next day: still not overdue.
        Assert.Equal(0, await SweepAsync(new DateTimeOffset(due.ToDateTime(new TimeOnly(21, 0)), santoDomingo)));
        Assert.Equal(0, await NoticesAsync());
        // The next business day it is: one notice for the unpaid invoice, none for the paid one.
        var nextDay = new DateTimeOffset(due.AddDays(1).ToDateTime(new TimeOnly(0, 30)), santoDomingo);
        Assert.Equal(1, await SweepAsync(nextDay));
        var notices = await setup.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.InvoiceOverdue).ToArrayAsync(ct);
        Assert.NotEmpty(notices);
        Assert.All(notices, email =>
        {
            Assert.Equal($"invoice:{unpaid.InvoiceId:D}", email.AttachmentReference);
            Assert.Contains(unpaid.FiscalNumber!, email.Subject, StringComparison.Ordinal);
            Assert.Contains(due.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture), email.TextBody!,
                StringComparison.Ordinal);
            Assert.DoesNotContain("Saldo", email.TextBody!, StringComparison.Ordinal);
            Assert.Contains(FinanceInvoicePolicy.Disclaimer, email.TextBody!, StringComparison.Ordinal);
        });
        var marks = await setup.AuditEntries.AsNoTracking()
            .Where(item => item.Action == InvoiceOverdueNotices.AuditAction).ToArrayAsync(ct);
        var mark = Assert.Single(marks);
        Assert.Equal((unpaid.InvoiceId, AuditActorType.System, AuditSource.BackgroundJob),
            ((Guid?)mark.EntityPublicId, mark.ActorType, mark.Source));
        Assert.Equal(0, await SweepAsync(nextDay.AddHours(1)));
        Assert.Equal(notices.Length, await NoticesAsync());
    }
}
