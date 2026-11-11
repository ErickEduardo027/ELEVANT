using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// The confirmed prepayment of a charter (ADR-0033) becomes one receipt, named by its charter, applied to the charter's
/// invoice up to its balance; the excess stays as an unapplied receipt (the airline's credit). It is posted when the
/// invoice is issued with the prepayment already confirmed, or when Finance confirms it after the invoice (4-N22). A
/// charter with a receipt that was not reversed is never posted again, so the prepayment is applied once.
/// </summary>
internal static class CharterPrepaymentPosting
{
    public const string Reason = "Prepago del charter confirmado por Finanzas.";

    /// <summary>
    /// Whether the charter's prepayment already became a receipt; with <paramref name="includeReversed"/> a receipt that
    /// Finance reversed counts too. A receipt the issuance posted before receipts named their charter (no
    /// <c>charter_agreement_id</c>) is the charter's when it carries the prepayment's reason and the issuance applied it,
    /// with that reason, to the invoice of the charter's operation; an application Finance made later in «Cobros» carries
    /// its own reason, so a credit applied to that invoice never counts as its prepayment. On an invoice of several
    /// charters such a receipt counts for each of them: a prepayment is never applied twice.
    /// </summary>
    public static async Task<bool> HasReceiptAsync(ElevantDbContext context, CharterAgreement agreement,
        bool includeReversed, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(agreement);
        var receipts = context.Set<FinanceTreasuryReceipt>().AsNoTracking();
        var movements = context.Set<FinanceTreasuryMovement>().AsNoTracking();
        IQueryable<FinanceTreasuryReceipt> Counted(IQueryable<FinanceTreasuryReceipt> found) => includeReversed
            ? found
            : found.Where(receipt => !movements.Any(movement => movement.ReceiptId == receipt.Id &&
                movement.Kind == FinanceTreasuryMovementKind.ReceiptReversal));
        if (await Counted(receipts.Where(receipt => receipt.CharterAgreementId == agreement.Id)).AnyAsync(cancellationToken))
            return true;
        var invoices = InvoicesOf(context, agreement.TurnaroundId).Select(invoice => (long?)invoice.Id);
        var unlinked = from movement in movements
                       join receipt in receipts on movement.ReceiptId equals receipt.Id
                       where movement.Kind == FinanceTreasuryMovementKind.Application && movement.Reason == Reason &&
                             invoices.Contains(movement.InvoiceId) && receipt.CharterAgreementId == null &&
                             receipt.AirlineId == agreement.AirlineId && receipt.Reason == Reason
                       select receipt;
        return await Counted(unlinked).AnyAsync(cancellationToken);
    }

    /// <summary>
    /// Receives the charter's confirmed prepayment and applies it to <paramref name="invoice"/>; nothing when it is not
    /// confirmed, has no amount, is in another currency or was already posted. Returns the receipt and what it applied.
    /// </summary>
    public static async Task<FinanceTreasuryPosting.Posted?> PostAsync(ElevantDbContext context, NonFiscalInvoice invoice,
        CharterAgreement agreement, long actorAccountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        ArgumentNullException.ThrowIfNull(agreement);
        if (agreement.PrepaymentStatus != CharterPrepaymentStatus.Confirmed || agreement.PrepaymentAmount is not > 0m ||
            agreement.CurrencyCode != invoice.CurrencyCode ||
            await HasReceiptAsync(context, agreement, false, cancellationToken))
            return null;
        var receiptId = Guid.CreateVersion7();
        var reference = CharterRules.PrepaymentReceiptReference(agreement.PrepaymentReference);
        // One transfer that paid two charters of the airline, or a prepayment Finance reversed and confirmed again with
        // the same bank reference: the receipt's own id keeps its reference apart from every receipt the airline has.
        if (await context.Set<FinanceTreasuryReceipt>().AnyAsync(receipt => receipt.AirlineId == invoice.AirlineId &&
                receipt.Reference == reference, cancellationToken))
            reference = CharterRules.PrepaymentReceiptReference(agreement.PrepaymentReference, receiptId);
        return await FinanceTreasuryPosting.ReceiveAndApplyAsync(context, invoice, actorAccountId, PaymentMethod.Transfer,
            reference, agreement.PrepaymentAmount.Value, Reason, now, agreement.Id, receiptId, cancellationToken);
    }

    /// <summary>
    /// 4-N22: a prepayment Finance confirms after the charter was invoiced settles that invoice in the same transaction,
    /// and Finance («Cobros», «Por facturar», «Facturas») and the airline's portal hear it. Nothing when the charter's
    /// operation has no invoice yet: the issuance applies it then.
    /// </summary>
    public static async Task<(Guid InvoiceId, decimal Applied)?> ApplyToIssuedInvoiceAsync(ElevantDbContext context,
        CharterAgreement agreement, long actorAccountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var invoice = await InvoicesOf(context, agreement.TurnaroundId).OrderBy(issued => issued.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (invoice is null) return null;
        var posted = await PostAsync(context, invoice, agreement, actorAccountId, now, cancellationToken);
        if (posted is null) return null;
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == invoice.AirlineId)
            .Select(item => new { item.OrganizationId, item.PublicId }).SingleAsync(cancellationToken);
        await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId, posted.Receipt.PublicId, now,
            "finance_receipts", cancellationToken);
        await FinanceApprovedServiceChangeWriter.AddInvoicesAsync(context, invoice.StationId, [invoice.PublicId], now,
            cancellationToken);
        await AirlineOperationChangeWriter.AddTreasuryAsync(context, airline.OrganizationId, airline.PublicId, now,
            cancellationToken);
        return (invoice.PublicId, posted.Applied);
    }

    /// <summary>The invoices issued from the charter's operation: its service lines on an internal draft it invoiced.</summary>
    private static IQueryable<NonFiscalInvoice> InvoicesOf(ElevantDbContext context, long turnaroundId) =>
        from operation in context.GroundOperations.AsNoTracking()
        join service in context.OperationServices.AsNoTracking() on operation.Id equals service.GroundOperationId
        join line in context.PreinvoiceLines.AsNoTracking() on service.Id equals line.OperationServiceId
        join draft in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals draft.Id
        join issued in context.NonFiscalInvoices.AsNoTracking() on draft.Id equals issued.PreinvoiceId
        where operation.TurnaroundId == turnaroundId && line.Kind == PreinvoiceLineKind.Service &&
              line.ReleasedAt == null && draft.Status == PreinvoiceStatus.Invoiced
        select issued;
}
