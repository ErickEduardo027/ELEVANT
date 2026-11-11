using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// Records money received for an airline and applies it to one of its invoices in the same
/// transaction (ADR-0035): a charter's confirmed prepayment when its invoice is issued, and the
/// simulated card payment of the airline portal. What exceeds the invoice balance stays as an
/// unapplied receipt (a credit of the airline).
/// </summary>
internal static class FinanceTreasuryPosting
{
    public sealed record Posted(FinanceTreasuryReceipt Receipt, decimal Applied);

    public static Task<Posted> ReceiveAndApplyAsync(ElevantDbContext context, NonFiscalInvoice invoice,
        long actorAccountId, PaymentMethod method, string reference, decimal amount, string reason, DateTimeOffset now,
        CancellationToken cancellationToken) => ReceiveAndApplyAsync(context, invoice, actorAccountId, method, reference,
        amount, reason, now, null, Guid.CreateVersion7(), cancellationToken);

    /// <summary>
    /// Receives <paramref name="amount"/> as the receipt <paramref name="receiptId"/> and applies it up to the invoice
    /// balance; <paramref name="charterAgreementId"/> names the charter whose prepayment the receipt is (4-N22).
    /// </summary>
    public static async Task<Posted> ReceiveAndApplyAsync(ElevantDbContext context, NonFiscalInvoice invoice,
        long actorAccountId, PaymentMethod method, string reference, decimal amount, string reason, DateTimeOffset now,
        long? charterAgreementId, Guid receiptId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        // 4-N10: a card payment or a prepayment of 21:30 in Santo Domingo is received that business day.
        var today = BusinessCalendar.Today(now);
        var receipt = new FinanceTreasuryReceipt
        {
            PublicId = receiptId, AirlineId = invoice.AirlineId, StationId = invoice.StationId,
            ActorAccountId = actorAccountId, RequestId = Guid.CreateVersion7(), Reference = reference,
            CurrencyCode = invoice.CurrencyCode, Method = method, ReceivedOn = today, Amount = amount,
            Reason = reason, CharterAgreementId = charterAgreementId, CreatedAt = now, UpdatedAt = now,
        };
        context.Add(receipt);
        await context.SaveChangesAsync(cancellationToken);
        var balance = await FinanceTreasuryBalances.BalanceAsync(context, invoice.Id, invoice.Total, cancellationToken);
        var applied = Math.Min(amount, balance);
        if (applied > 0)
        {
            context.Add(new FinanceTreasuryMovement
            {
                PublicId = Guid.CreateVersion7(), ReceiptId = receipt.Id, InvoiceId = invoice.Id,
                ActorAccountId = actorAccountId, RequestId = Guid.CreateVersion7(),
                Kind = FinanceTreasuryMovementKind.Application, EffectiveOn = today, ReceiptAmount = applied,
                InvoiceAmount = applied, ReceiptCurrency = receipt.CurrencyCode, InvoiceCurrency = invoice.CurrencyCode,
                ExchangeRate = 1m, ExchangeRateOn = today, Reference = reference, Reason = reason,
                CreatedAt = now, UpdatedAt = now,
            });
            var account = await context.Set<FinanceTreasuryInvoiceAccount>()
                .SingleOrDefaultAsync(item => item.InvoiceId == invoice.Id, cancellationToken);
            if (account is null)
                context.Add(new FinanceTreasuryInvoiceAccount
                {
                    PublicId = Guid.CreateVersion7(), InvoiceId = invoice.Id, CreatedAt = now, UpdatedAt = now,
                });
            else
                account.UpdatedAt = now;
            await context.SaveChangesAsync(cancellationToken);
        }
        return new Posted(receipt, applied);
    }
}
