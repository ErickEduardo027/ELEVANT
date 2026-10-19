using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;
internal sealed partial class FinanceTreasuryStore
{
    public async Task<FinanceTreasuryAdjustmentsData?> AdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "finance.adjustments.read", cancellationToken);
        if (actor is null) return null;
        var scope = await Invoices(actor).AsNoTracking().SingleOrDefaultAsync(i => i.Invoice.PublicId == invoiceId, cancellationToken);
        return scope is null ? null : await AdjustmentDataAsync(scope.Invoice, cancellationToken);
    }
    private async Task<FinanceTreasuryAdjustmentsData> AdjustmentDataAsync(NonFiscalInvoice invoice, CancellationToken ct)
    {
        var lines = await context.Set<NonFiscalInvoiceLine>().AsNoTracking().Where(l => l.InvoiceId == invoice.Id).OrderBy(l => l.LineNumber).ToArrayAsync(ct);
        var notes = await context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(n => n.InvoiceId == invoice.Id).OrderBy(n => n.CreatedAt).ToArrayAsync(ct);
        var ids = notes.Select(n => n.Id).ToArray();
        var entries = await context.Set<FinanceTreasuryAdjustmentLine>().AsNoTracking().Where(l => ids.Contains(l.NoteId)).ToArrayAsync(ct);
        var actorIds = notes.Select(n => n.ActorAccountId).ToArray();
        var users = await context.Users.AsNoTracking().Where(u => actorIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.PublicId, ct);
        var legacy = await context.NonFiscalCreditNotes.AsNoTracking().Where(n => n.InvoiceId == invoice.Id).SumAsync(n => (decimal?)n.Amount, ct) ?? 0m;
        var account = await InvoiceAccountAsync(invoice.Id, ct);
        var globalCreditRemaining = Math.Max(0m, invoice.Total - legacy - notes.Where(n => n.Kind == FinanceTreasuryAdjustmentKind.Credit).Sum(n => n.Amount));
        decimal Used(long line, FinanceTreasuryAdjustmentKind kind, bool quantity) => entries.Where(e => e.InvoiceLineId == line &&
            notes.Any(n => n.Id == e.NoteId && n.Kind == kind)).Sum(e => quantity ? e.Quantity : e.Amount);
        return new(invoice.PublicId, Version(account), legacy,
            lines.Select(l => new FinanceTreasuryLineLimitData(l.PublicId, l.LineNumber, l.ExecutedQuantity, l.Amount,
                Math.Max(0m, l.ExecutedQuantity - Used(l.Id, FinanceTreasuryAdjustmentKind.Credit, true)),
                Math.Min(globalCreditRemaining, Math.Max(0m, l.Amount - Used(l.Id, FinanceTreasuryAdjustmentKind.Credit, false))),
                Math.Max(0m, l.ExecutedQuantity - Used(l.Id, FinanceTreasuryAdjustmentKind.Debit, true)),
                Math.Max(0m, l.Amount - Used(l.Id, FinanceTreasuryAdjustmentKind.Debit, false)))).ToArray(),
            notes.Select(n => new FinanceTreasuryAdjustmentData(n.PublicId, n.Number, invoice.PublicId,
                n.RelatedNoteId is { } related ? notes.Single(p => p.Id == related).PublicId : null,
                n.Kind.ToString(), n.CurrencyCode, n.Amount, n.EffectiveOn, n.Reason, users[n.ActorAccountId], n.CreatedAt,
                entries.Where(e => e.NoteId == n.Id).Select(e => new FinanceTreasuryAdjustmentLineData(
                    lines.Single(l => l.Id == e.InvoiceLineId).PublicId, e.Quantity, e.Amount)).ToArray())).ToArray());
    }
    public Task<FinanceTreasuryResult> IssueAdjustmentAsync(Guid actorId, Guid invoiceId, FinanceTreasuryAdjustmentInput input,
        CancellationToken cancellationToken = default)
    {
        if (input is null || !Reason(input.Reason) || !DateValid(input.EffectiveOn) || string.IsNullOrEmpty(input.ExpectedVersion) ||
            !Enum.TryParse<FinanceTreasuryAdjustmentKind>(input.Kind, false, out var kind) || !Enum.IsDefined(kind) ||
            input.Lines is not { Count: >= 1 and <= 100 } || input.Lines.Any(l => l is null || l.InvoiceLineId == Guid.Empty ||
                l.Quantity < 0m || l.Quantity > 900_000_000_000m || decimal.Round(l.Quantity, 4) != l.Quantity || !FinanceTreasuryRules.Money(l.Amount)) ||
            input.Lines.Select(l => l.InvoiceLineId).Distinct().Count() != input.Lines.Count)
            return Task.FromResult(Fail(FinanceTreasuryFailure.Invalid));
        var ct = cancellationToken; var hash = Hash(input);
        return ExecuteAsync(actorId, input.RequestId, "finance.adjustments.issue", async (actor, accountId) =>
        {
            var scope = await Invoices(actor).SingleOrDefaultAsync(i => i.Invoice.PublicId == invoiceId, ct);
            if (scope is null) return Fail(FinanceTreasuryFailure.NotFound);
            await LockInvoiceAsync(scope.Invoice.Id, ct);
            var replay = await ReplayAsync(actorId, input.RequestId, invoiceId, "adjustment.issued", hash, ct);
            if (replay is not null) return replay;
            var account = await InvoiceAccountAsync(scope.Invoice.Id, ct);
            if (Version(account) != input.ExpectedVersion || input.EffectiveOn < DateOnly.FromDateTime(scope.Invoice.CreatedAt.UtcDateTime))
                return Fail(FinanceTreasuryFailure.Conflict);
            var data = await AdjustmentDataAsync(scope.Invoice, ct);
            var amount = input.Lines.Sum(l => l.Amount);
            if (!FinanceTreasuryRules.Money(amount)) return Fail(FinanceTreasuryFailure.Invalid);
            // Legacy notes have no line allocation: reserve their entire amount against the invoice-wide credit ceiling.
            if (kind == FinanceTreasuryAdjustmentKind.Credit && amount > scope.Invoice.Total - data.LegacyCredited -
                data.Notes.Where(n => n.Kind == "Credit").Sum(n => n.Amount)) return Fail(FinanceTreasuryFailure.Conflict);
            foreach (var line in input.Lines)
            {
                var limit = data.Lines.SingleOrDefault(l => l.InvoiceLineId == line.InvoiceLineId);
                if (limit is null) return Fail(FinanceTreasuryFailure.NotFound);
                if (!FinanceTreasuryRules.CanAdjust(line.Quantity, line.Amount,
                    kind == FinanceTreasuryAdjustmentKind.Credit ? limit.CreditQuantityRemaining : limit.DebitQuantityRemaining,
                    kind == FinanceTreasuryAdjustmentKind.Credit ? limit.CreditAmountRemaining : limit.DebitAmountRemaining))
                    return Fail(FinanceTreasuryFailure.Conflict);
            }
            FinanceTreasuryAdjustmentNote? related = null;
            if (input.RelatedNoteId is not null)
            {
                related = await context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().SingleOrDefaultAsync(n =>
                    n.PublicId == input.RelatedNoteId && n.InvoiceId == scope.Invoice.Id, ct);
                if (related is null) return Fail(FinanceTreasuryFailure.NotFound);
            }
            var id = Guid.CreateVersion7(); var now = timeProvider.GetUtcNow();
            var note = new FinanceTreasuryAdjustmentNote { PublicId = id, InvoiceId = scope.Invoice.Id, ActorAccountId = accountId,
                RequestId = input.RequestId, RelatedNoteId = related?.Id, Number = $"{(kind == FinanceTreasuryAdjustmentKind.Credit ? "TC" : "TD")}-{id:N}",
                Kind = kind, EffectiveOn = input.EffectiveOn, CurrencyCode = scope.Invoice.CurrencyCode, Amount = amount,
                Reason = input.Reason.Trim(), CreatedAt = now, UpdatedAt = now };
            context.Add(note);
            await context.SaveChangesAsync(ct);
            var invoiceLines = await context.Set<NonFiscalInvoiceLine>().Where(l => l.InvoiceId == scope.Invoice.Id).ToArrayAsync(ct);
            foreach (var line in input.Lines)
            {
                var entry = new FinanceTreasuryAdjustmentLine { PublicId = Guid.CreateVersion7(),
                    NoteId = note.Id, InvoiceLineId = invoiceLines.Single(l => l.PublicId == line.InvoiceLineId).Id,
                    Quantity = line.Quantity, Amount = line.Amount, CreatedAt = now, UpdatedAt = now };
                context.Add(entry);
            }
            account ??= NewAccount(scope.Invoice.Id);
            return await CompleteAsync(accountId, input.RequestId, invoiceId, "adjustment.issued", hash, id, account,
                scope.OrganizationId, scope.Invoice.StationId, input.Reason, ct);
        }, ct);
    }
}
