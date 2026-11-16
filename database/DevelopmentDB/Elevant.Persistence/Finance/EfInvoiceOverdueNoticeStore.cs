using System.Data;
using System.Text.Json;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>
/// 4-N23: the overdue notice of the e-CF invoices (the ones with an e-NCF; the legacy invoices of before ADR-0035 get
/// none). A candidate is due before AVIAM's business day, still has a balance and carries no notice mark; each one is
/// checked again, emailed, marked in the audit and announced to the portal in its own serializable transaction.
/// </summary>
internal sealed class EfInvoiceOverdueNoticeStore(ElevantDbContext context) : IInvoiceOverdueNoticeStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<int> SweepAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        var today = BusinessCalendar.Today(now);
        var candidates = await Overdue(today).OrderBy(invoice => invoice.DueDate).ThenBy(invoice => invoice.Id)
            .Select(invoice => invoice.Id).Take(limit).ToArrayAsync(cancellationToken);
        var notified = 0;
        foreach (var invoiceId in candidates)
            if (await NotifyAsync(invoiceId, now, today, cancellationToken)) notified++;
        return notified;
    }

    /// <summary>
    /// The e-CF invoices due before <paramref name="today"/>, with a balance and no notice yet. The balance is the one of
    /// <see cref="FinanceTreasuryBalances"/>: total and debit notes, less legacy payments and credit notes, what the
    /// receipts still apply and the credit notes.
    /// </summary>
    private IQueryable<NonFiscalInvoice> Overdue(DateOnly today) =>
        from invoice in context.NonFiscalInvoices.AsNoTracking()
        where invoice.FiscalNumber != null && invoice.DueDate != null && invoice.DueDate < today &&
              !context.AuditEntries.Any(entry => entry.Action == InvoiceOverdueNotices.AuditAction &&
                  entry.EntityType == nameof(NonFiscalInvoice) && entry.EntityPublicId == invoice.PublicId)
        let applied = context.Set<FinanceTreasuryMovement>()
            .Where(movement => movement.InvoiceId == invoice.Id && movement.Kind == FinanceTreasuryMovementKind.Application)
            .Sum(movement => (decimal?)movement.InvoiceAmount) ?? 0m
        let unapplied = context.Set<FinanceTreasuryMovement>()
            .Where(movement => movement.InvoiceId == invoice.Id &&
                movement.Kind == FinanceTreasuryMovementKind.ApplicationReversal)
            .Sum(movement => (decimal?)movement.InvoiceAmount) ?? 0m
        let credited = context.Set<FinanceTreasuryAdjustmentNote>()
            .Where(note => note.InvoiceId == invoice.Id && note.Kind == FinanceTreasuryAdjustmentKind.Credit)
            .Sum(note => (decimal?)note.Amount) ?? 0m
        let debited = context.Set<FinanceTreasuryAdjustmentNote>()
            .Where(note => note.InvoiceId == invoice.Id && note.Kind == FinanceTreasuryAdjustmentKind.Debit)
            .Sum(note => (decimal?)note.Amount) ?? 0m
        let legacyPaid = context.NonFiscalPayments.Where(payment => payment.InvoiceId == invoice.Id)
            .Sum(payment => (decimal?)payment.Amount) ?? 0m
        let legacyCredited = context.NonFiscalCreditNotes.Where(note => note.InvoiceId == invoice.Id)
            .Sum(note => (decimal?)note.Amount) ?? 0m
        where invoice.Total + debited - legacyPaid - legacyCredited - (applied - unapplied) - credited > 0m
        select invoice;

    private async Task<bool> NotifyAsync(long invoiceId, DateTimeOffset now, DateOnly today, CancellationToken ct)
    {
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                // Checked again inside the transaction: another host, a payment or a note may have come first.
                var invoice = await Overdue(today).SingleOrDefaultAsync(item => item.Id == invoiceId, ct);
                if (invoice is null)
                {
                    await transaction.RollbackAsync(ct);
                    return false;
                }
                var recipients = await InvoiceEmails.QueueOverdueAsync(context, invoice, now, ct);
                var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == invoice.AirlineId)
                    .Select(item => new { item.OrganizationId, item.PublicId }).SingleAsync(ct);
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.System,
                    ActorDisplay = "Sistema", Action = InvoiceOverdueNotices.AuditAction,
                    EntityType = nameof(NonFiscalInvoice), EntityPublicId = invoice.PublicId,
                    OrganizationId = airline.OrganizationId, StationId = invoice.StationId,
                    Source = AuditSource.BackgroundJob, CorrelationId = Guid.CreateVersion7(),
                    Reason = "Aviso único de factura vencida a la aerolínea.",
                    MetadataJson = JsonSerializer.Serialize(new
                    {
                        fiscalNumber = invoice.FiscalNumber, dueDate = invoice.DueDate, businessDay = today, recipients,
                    }, Json),
                });
                await AirlineOperationChangeWriter.AddTreasuryAsync(context, airline.OrganizationId, airline.PublicId, now, ct);
                await context.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return true;
            });
        }
        catch (Exception exception) when (exception is DbUpdateException or RetryLimitExceededException &&
            exception.GetBaseException() is SqlException { Number: 1205 or 2601 or 2627 or 3960 })
        {
            // A concurrent sweep or command won: the next hourly sweep checks this invoice again.
            context.ChangeTracker.Clear();
            return false;
        }
    }
}
