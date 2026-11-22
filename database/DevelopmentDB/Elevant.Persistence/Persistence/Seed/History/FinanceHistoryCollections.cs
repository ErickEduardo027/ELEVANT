using System.Globalization;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// What the airlines did with the invoices of a finance chunk, by payer profile (good, average, slow): paid on time,
/// late, partially, nothing (overdue once the due date passed) or after a credit note E34. A payment is a treasury
/// receipt with its application, the shape of <c>FinanceTreasuryPosting.ReceiveAndApplyAsync</c> (a card payment also
/// keeps its approved attempt, as the portal does); a credit note freezes the ITBIS of its line with
/// <see cref="FinanceInvoicePolicy.AdjustmentTax"/> and takes the next E34 read like <c>NoteNumberAsync</c>. Insert-only:
/// each invoice's treasury account is written in its final state (updated at its last movement). Nothing happens
/// after the end of the window.
/// </summary>
internal static class FinanceHistoryCollections
{
    private enum Outcome { OnTime, Late, Partial, Unpaid, Credit }

    private enum Payer { Good, Average, Slow }

    // Weights of OnTime, Late, Partial, Unpaid, Credit: the plan's mix (55/15/12/13/5) for the average payer.
    private static readonly Dictionary<Payer, double[]> Weights = new Dictionary<Payer, double[]>
    {
        [Payer.Good] = [72, 8, 7, 8, 5],
        [Payer.Average] = [55, 15, 12, 13, 5],
        [Payer.Slow] = [38, 22, 17, 18, 5],
    };

    private sealed record Payment(DateOnly Day, DateTimeOffset At, decimal Amount, decimal Extra, PaymentMethod Method);

    public static async Task InsertAsync(HistoryChunkContext chunk, HistoryPeriod period, IReadOnlyList<FinanceHistory.Issue> issues,
        bool firstOfChunk, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var clock = chunk.Clock;
        var finance = chunk.Anchors.Finance.Id;
        var lastDay = chunk.Options.WindowEnd;
        var cap = clock.ToUtc(lastDay, HistoryClock.DayEnd);
        // The first invoicing of the first finance chunk keeps two receipts larger than their invoice: a credit of the
        // airline.
        var withRemainder = firstOfChunk && string.Equals(FinanceHistory.Chunks(chunk.Options).First().Name,
            chunk.ChunkName, StringComparison.Ordinal) ? 2 : 0;

        var highestNote = await db.Set<FinanceTreasuryAdjustmentNote>()
            .FromSqlRaw("SELECT * FROM [commercial].[finance_treasury_adjustment_notes] WITH (UPDLOCK, HOLDLOCK)")
            .Where(note => note.Number.StartsWith(FinanceInvoicePolicy.CreditNoteFiscalPrefix))
            .Select(note => note.Number).MaxAsync(cancellationToken);

        var receipts = new List<(FinanceTreasuryReceipt Receipt, FinanceHistory.Issue Issue, Payment Payment, string Key)>();
        var notes = new List<(FinanceTreasuryAdjustmentNote Note, FinanceTreasuryAdjustmentLine Line)>();
        var accounts = new List<FinanceTreasuryInvoiceAccount>();
        var cards = new List<(CardPaymentAttempt Attempt, int Receipt)>();
        foreach (var issue in issues.OrderBy(item => item.IssuedAt).ThenBy(item => item.Key, StringComparer.Ordinal))
        {
            var invoice = issue.Invoice;
            var random = HistoryRandom.For(issue.Key + ":collection");
            var isDemo = !issue.Airline.IsHistory;
            var payer = isDemo ? Payer.Good : (Payer)HistoryRandom.For("finance:payer:" + issue.Airline.Designator).Next(3);
            var outcome = (Outcome)random.Weighted(Weights[payer]);
            var issueDay = BusinessCalendar.Today(invoice.CreatedAt);
            var due = invoice.DueDate!.Value;
            // Demo Airlines is the portal tenant: it never keeps an overdue invoice (no overdue notice to its account).
            if (isDemo && outcome is Outcome.Unpaid or Outcome.Late or Outcome.Partial) outcome = Outcome.OnTime;

            DateOnly? PayDay(DateOnly earliest, DateOnly wanted)
            {
                var day = wanted.DayOfWeek switch
                {
                    DayOfWeek.Saturday => wanted.AddDays(2),
                    DayOfWeek.Sunday => wanted.AddDays(1),
                    _ => wanted,
                };
                if (day > lastDay) day = lastDay;
                while (day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) day = day.AddDays(-1);
                return day < earliest ? null : day;
            }
            DateOnly? OnTimeDay(DateOnly after)
            {
                var latest = due.AddDays(-1) < lastDay ? due.AddDays(-1) : lastDay;
                if (latest <= after) return PayDay(after.AddDays(1), after.AddDays(1));
                return PayDay(after.AddDays(1), after.AddDays(random.Between(1, latest.DayNumber - after.DayNumber)));
            }
            DateTimeOffset At(DateOnly day) => clock.At(day, new TimeOnly(9, 0).AddMinutes(random.Between(0, 480)));
            PaymentMethod Method(decimal amount, decimal balance) =>
                issue.Airline.SignerAccountId is not null && amount == balance && random.Chance(0.08)
                    ? PaymentMethod.Card
                    : random.Chance(0.12) ? PaymentMethod.Check : PaymentMethod.Transfer;

            var payments = new List<Payment>();
            var balance = invoice.Total;
            DateTimeOffset last = invoice.CreatedAt;
            switch (outcome)
            {
                case Outcome.OnTime:
                case Outcome.Partial:
                {
                    if (OnTimeDay(issueDay) is not { } day) break;
                    var amount = outcome == Outcome.Partial
                        ? decimal.Round(balance * random.Decimal(0.40m, 0.80m), 2, MidpointRounding.AwayFromZero)
                        : balance;
                    payments.Add(new Payment(day, At(day), amount, 0m, Method(amount, balance)));
                    break;
                }
                case Outcome.Late:
                {
                    var wanted = due.AddDays(random.Between(3, 25));
                    if (wanted > lastDay) break;
                    if (PayDay(due.AddDays(1), wanted) is { } day)
                        payments.Add(new Payment(day, At(day), balance, 0m, Method(balance, balance)));
                    break;
                }
                case Outcome.Credit:
                {
                    var noteDay = issueDay.AddDays(random.Between(2, 10));
                    if (noteDay > lastDay) break;
                    var note = CreditNote(issue, random, noteDay, clock, finance, ref highestNote);
                    notes.Add(note);
                    last = note.Note.CreatedAt;
                    balance -= note.Note.Amount;
                    if (OnTimeDay(noteDay) is { } day && balance > 0)
                        payments.Add(new Payment(day, At(day), balance, 0m, Method(balance, balance)));
                    break;
                }
            }

            foreach (var (planned, index) in payments.Select((item, index) => (item, index)))
            {
                if (planned.At > cap || planned.At <= invoice.CreatedAt) continue;
                var payment = planned;
                if (withRemainder > 0 && payment.Method == PaymentMethod.Transfer && payment.Amount == balance)
                {
                    payment = payment with { Extra = random.Decimal(75m, 400m) };
                    withRemainder--;
                }
                var key = $"{issue.Key}:receipt:{index + 1}";
                var reference = payment.Method switch
                {
                    PaymentMethod.Check => $"CHQ-{invoice.FiscalNumber}",
                    PaymentMethod.Card => CardReference(random),
                    _ => $"TRF-{invoice.FiscalNumber}",
                };
                var receipt = HistoryChunkContext.Stamp(new FinanceTreasuryReceipt
                {
                    AirlineId = invoice.AirlineId, StationId = invoice.StationId,
                    ActorAccountId = payment.Method == PaymentMethod.Card ? issue.Airline.SignerAccountId!.Value : finance,
                    RequestId = HistoryKeys.Key(key + ":request"), Reference = reference + (index > 0 ? $"-{index + 1}" : ""),
                    CurrencyCode = invoice.CurrencyCode, Method = payment.Method,
                    ReceivedOn = BusinessCalendar.Today(payment.At), Amount = payment.Amount + payment.Extra,
                    Reason = payment.Method == PaymentMethod.Card
                        ? "Pago con tarjeta desde el portal de la aerolínea (simulado)."
                        : payment.Extra > 0
                            ? "Transferencia recibida por un monto mayor al saldo de la factura; el excedente queda a favor de la aerolínea."
                            : "Cobro registrado por Finanzas.",
                }, key, payment.At);
                receipts.Add((receipt, issue, payment, key));
                if (payment.Method == PaymentMethod.Card)
                {
                    var last4 = receipt.Reference.Split('*')[1][..4];
                    cards.Add((HistoryChunkContext.Stamp(new CardPaymentAttempt
                    {
                        InvoiceId = invoice.Id, AirlineId = invoice.AirlineId, AccountId = receipt.ActorAccountId,
                        IdempotencyKey = HistoryKeys.Key(key + ":card"),
                        RequestHash = CardPaymentPolicy.RequestHash(invoice.PublicId, payment.Amount, "Visa", last4),
                        Amount = payment.Amount, CurrencyCode = invoice.CurrencyCode, Brand = "Visa", Last4 = last4,
                        Status = CardPaymentStatus.Approved, AuthorizationCode = receipt.Reference[^6..],
                    }, key + ":card", payment.At), receipts.Count - 1));
                }
                last = payment.At > last ? payment.At : last;
            }
            accounts.Add(HistoryChunkContext.Stamp(new FinanceTreasuryInvoiceAccount { InvoiceId = invoice.Id },
                issue.Key + ":treasury-account", invoice.CreatedAt, last));
        }

        await chunk.InsertAsync(receipts.Select(item => (object)item.Receipt).Concat(notes.Select(item => item.Note))
            .Concat(accounts), cancellationToken);
        var layer = new List<object>();
        foreach (var (receipt, issue, payment, key) in receipts)
            layer.Add(HistoryChunkContext.Stamp(new FinanceTreasuryMovement
            {
                ReceiptId = receipt.Id, InvoiceId = issue.Invoice.Id, ActorAccountId = receipt.ActorAccountId,
                RequestId = HistoryKeys.Key(key + ":application"), Kind = FinanceTreasuryMovementKind.Application,
                EffectiveOn = receipt.ReceivedOn, ReceiptAmount = payment.Amount, InvoiceAmount = payment.Amount,
                ReceiptCurrency = receipt.CurrencyCode, InvoiceCurrency = issue.Invoice.CurrencyCode, ExchangeRate = 1m,
                ExchangeRateOn = receipt.ReceivedOn, Reference = receipt.Reference, Reason = receipt.Reason,
            }, key + ":application", receipt.CreatedAt));
        foreach (var (note, line) in notes)
        {
            line.NoteId = note.Id;
            layer.Add(line);
        }
        foreach (var (attempt, index) in cards)
        {
            attempt.ReceiptId = receipts[index].Receipt.Id;
            layer.Add(attempt);
        }
        await chunk.InsertAsync(layer, cancellationToken);
    }

    private static string CardReference(HistoryRandom random)
    {
        var last4 = random.Between(0, 9999).ToString("D4", CultureInfo.InvariantCulture);
        var authorization = random.Between(0, 999_999).ToString("D6", CultureInfo.InvariantCulture);
        return $"TARJETA VISA *{last4} AUT {authorization}";
    }

    /// <summary>
    /// A credit note E34 on one service line of the invoice: the whole line when the invoice has others, half of it
    /// otherwise; its ITBIS frozen from the line's snapshot like <c>FinanceTreasuryStore.BreakdownAsync</c>.
    /// </summary>
    private static (FinanceTreasuryAdjustmentNote Note, FinanceTreasuryAdjustmentLine Line) CreditNote(
        FinanceHistory.Issue issue, HistoryRandom random, DateOnly day, HistoryClock clock, long finance,
        ref string? highest)
    {
        var services = issue.InvoiceLines.Where(line => line.Kind == PreinvoiceLineKind.Service).ToArray();
        var line = random.Pick(services);
        var whole = issue.InvoiceLines.Count > 1;
        var gross = line.GrossAmount ?? line.Amount;
        var amount = whole ? gross : decimal.Round(gross / 2m, 2, MidpointRounding.AwayFromZero);
        var quantity = whole ? line.ExecutedQuantity : decimal.Round(line.ExecutedQuantity / 2m, 4, MidpointRounding.AwayFromZero);
        if (quantity <= 0m) quantity = line.ExecutedQuantity;
        var breakdown = FinanceInvoicePolicy.AdjustmentTax(gross, line.TaxAmount ?? 0m, 0m, 0m, amount);
        highest = FinanceInvoicePolicy.NextFiscalNumber(FinanceInvoicePolicy.CreditNoteFiscalPrefix, highest);
        var at = clock.At(day, new TimeOnly(10, 0).AddMinutes(random.Between(0, 300)));
        var key = issue.Key + ":credit-note";
        var note = HistoryChunkContext.Stamp(new FinanceTreasuryAdjustmentNote
        {
            InvoiceId = issue.Invoice.Id, ActorAccountId = finance, RequestId = HistoryKeys.Key(key + ":request"),
            Number = highest, Kind = FinanceTreasuryAdjustmentKind.Credit, EffectiveOn = day,
            CurrencyCode = issue.Invoice.CurrencyCode, Amount = amount,
            Reason = $"Nota de crédito por servicio {line.ServiceCode} de la operación {line.OperationCode} reclamado por la aerolínea.",
        }, key, at);
        var entry = HistoryChunkContext.Stamp(new FinanceTreasuryAdjustmentLine
        {
            InvoiceLineId = line.Id, Quantity = quantity, Amount = amount,
            NetAmount = line.TaxAmount is null ? null : breakdown.Net,
            TaxAmount = line.TaxAmount is null ? null : breakdown.Tax, TaxRate = line.TaxRate,
        }, key + ":line", at);
        return (note, entry);
    }
}
