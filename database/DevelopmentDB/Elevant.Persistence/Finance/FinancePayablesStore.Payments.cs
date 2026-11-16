using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    private async Task<FinancePayablesPayment> PaymentAsync(Actor a, Guid id, CancellationToken ct)
    {
        var row = await context.Set<FinancePayablesPayment>().SingleOrDefaultAsync(x => x.PublicId == id, ct);
        Require(row is not null, "not_found"); Scope(a, row!.ScopeStationId); return row;
    }
    public Task<FinancePayablesResult<FinancePayablesPaymentView>> GetPaymentAsync(Guid actorId, Guid id, CancellationToken ct = default) =>
        ReadAsync(actorId, "finance.payables.read", async a => await PaymentViewAsync(await PaymentAsync(a, id, ct), ct), ct);
    public Task<FinancePayablesResult<IReadOnlyList<FinancePayablesPaymentView>>> ListPaymentsAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) =>
        ReadAsync<IReadOnlyList<FinancePayablesPaymentView>>(actorId, "finance.payables.read", async a =>
        {
            Filter(filter); var station = await FilterStationAsync(a, filter, ct);
            var today = SettlementToday; var end = SettlementCutoff; var applications = CurrentApplications(); var voids = PaymentVoids();
            var query = context.Set<FinancePayablesPayment>().AsNoTracking().Where(x => a.Stations.Contains(x.ScopeStationId) && x.PaidOn <= today && x.CreatedAt < end);
            if (station is not null) query = query.Where(x => x.ScopeStationId == station);
            if (filter.SupplierId is { } supplier) query = query.Where(x => context.Set<Supplier>().Any(s => s.Id == x.SupplierId && s.PublicId == supplier));
            if (filter.From is { } from) query = query.Where(x => x.PaidOn >= from);
            if (filter.To is { } to) query = query.Where(x => x.PaidOn <= to);
            if (!string.IsNullOrWhiteSpace(filter.Search)) query = query.Where(x => x.Reference.Contains(filter.Search));
            // 4-N04: a voided payment has nothing left to apply.
            if (filter.OutstandingOnly) query = query.Where(x => !voids.Any(v => v.PaymentId == x.Id) &&
                x.Amount > (applications.Where(p => p.PaymentId == x.Id).Sum(p => (decimal?)p.PaymentAmount) ?? 0));
            var rows = await query.OrderByDescending(x => x.PaidOn).ThenBy(x => x.Id).Skip(filter.Skip).Take(filter.Take).ToArrayAsync(ct);
            var result = new List<FinancePayablesPaymentView>(); foreach (var row in rows) result.Add(await PaymentViewAsync(row, ct)); return result;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> RecordPaymentAsync(Guid actorId, FinancePayablesPaymentSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "payable.payment.record", null, input, "finance.payables.pay", async a =>
        {
            Require(Finance(a, "finance.payables.pay"), "forbidden"); Require(Text(input.Reference, 100) && FinancePayablesPolicy.Money(input.Amount) && input.Amount > 0);
            RequireSettlementDate(input.PaidOn);
            var dop = ValidateFx(input.Fx, input.Amount, input.PaidOn); var station = await StationAsync(a, input.ScopeStationId, ct);
            var supplier = await SupplierAsync(a, input.SupplierId, ct); Require(supplier.ScopeStationId == station);
            Require(supplier.IsActive, FinancePayablesProblems.SupplierInactive);
            var now = clock.GetUtcNow(); var row = new FinancePayablesPayment { PublicId = Guid.CreateVersion7(), SupplierId = supplier.Id, ScopeStationId = station,
                Reference = input.Reference.Trim(), PaidOn = input.PaidOn, CurrencyCode = input.Fx.Currency, FxToDop = input.Fx.RateToDop!.Value,
                FxSource = input.Fx.Source.Trim(), FxDate = input.Fx.RateDate!.Value, Amount = input.Amount, AmountDop = dop,
                CreatedByAccountId = a.Id, CreatedAt = now, UpdatedAt = now };
            context.Set<FinancePayablesPayment>().Add(row); Audit(a, "finance.payable.payment_recorded", "commercial.payable_payments", row.PublicId); return row.PublicId;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> ApplyPaymentAsync(Guid actorId, Guid id, FinancePayablesApply input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "payable.payment.apply", id, input, "finance.payables.pay", async a =>
        {
            Require(Finance(a, "finance.payables.pay"), "forbidden");
            Require(input.Applications is { Count: > 0 and <= 100 } && input.Applications.All(x => x is not null) &&
                input.Applications.Select(x => x.InvoiceId).Distinct().Count() == input.Applications.Count);
            var payment = await PaymentAsync(a, id, ct); RequireSettlementDate(payment.PaidOn);
            Require(payment.CreatedAt < SettlementCutoff); Match(payment.RowVersion, input.ExpectedVersion);
            Require(!await PaymentVoids().AnyAsync(v => v.PaymentId == payment.Id, ct), FinancePayablesProblems.PaymentVoided);
            // Retained allocations still cap writes, including old invalid future rows, to prevent later overapplication;
            // 4-N04: a reversed application gives its amount back to the payment and the invoice.
            var used = await ActiveApplications().Where(x => x.PaymentId == payment.Id).SumAsync(x => (decimal?)x.PaymentAmount, ct) ?? 0m;
            var remaining = payment.Amount - used;
            var paymentCreator = await context.Users.Where(u => u.Id == payment.CreatedByAccountId).Select(u => u.PersonId).SingleAsync(ct);
            // All invoice reads and both balance updates share this SERIALIZABLE transaction. Order reduces deadlocks.
            foreach (var application in input.Applications!.OrderBy(x => x.InvoiceId))
            {
                var invoice = await InvoiceAsync(a, application.InvoiceId, ct); Match(invoice.RowVersion, application.ExpectedVersion);
                Require(invoice.SupplierId == payment.SupplierId && invoice.ScopeStationId == payment.ScopeStationId);
                Require(invoice.Status == SupplierInvoiceStatus.Approved, FinancePayablesProblems.InvalidState);
                // 4-N14: who approved the invoice neither applies a payment to it nor recorded that payment (by person).
                var approver = await (from review in context.Set<SupplierInvoiceReview>() join user in context.Users on review.ActorAccountId equals user.Id
                    where review.DocumentId == invoice.Id && review.Stage == "Finance" && review.Decision == nameof(SupplierInvoiceStatus.Approved)
                    orderby review.Id descending select (long?)user.PersonId).FirstOrDefaultAsync(ct);
                Require(FinancePayablesPolicy.CanSettleInvoice(a.PersonId, paymentCreator, approver), FinancePayablesProblems.SegregationOfDuties);
                var invoiceUsed = await ActiveApplications().Where(x => x.SupplierInvoiceId == invoice.Id).SumAsync(x => (decimal?)x.InvoiceAmount, ct) ?? 0m;
                var rate = ApplicationRate(payment.CurrencyCode, payment.FxToDop, invoice.CurrencyCode, invoice.FxToDop, application.RateToInvoice);
                Require(FinancePayablesPolicy.CanApply(remaining, invoice.Total - invoiceUsed, application.PaymentAmount, rate), FinancePayablesProblems.BalanceExceeded);
                context.Set<FinancePayablesApplication>().Add(new FinancePayablesApplication { PublicId = Guid.CreateVersion7(), PaymentId = payment.Id,
                    SupplierInvoiceId = invoice.Id, PaymentAmount = application.PaymentAmount, InvoiceAmount = FinancePayablesPolicy.Round(application.PaymentAmount * rate),
                    RateToInvoice = rate, ActorAccountId = a.Id, AppliedAt = clock.GetUtcNow() });
                remaining -= application.PaymentAmount; invoice.UpdatedAt = clock.GetUtcNow();
                context.Entry(invoice).Property(x => x.UpdatedAt).IsModified = true;
                Audit(a, "finance.payable.payment_applied", "commercial.supplier_invoices", invoice.PublicId);
            }
            payment.UpdatedAt = clock.GetUtcNow(); context.Entry(payment).Property(x => x.UpdatedAt).IsModified = true;
            Audit(a, "finance.payable.payment_allocated", "commercial.payable_payments", id); return id;
        }, ct);
    /// <summary>
    /// 4-N04: a payment applied to the wrong invoice gets that application reversed; a payment recorded by mistake is voided
    /// once nothing of it remains applied. Both are new linked rows with their reason: the payment and its applications are
    /// never changed, and the invoice and the payment move to a new version so a stale screen re-reads them.
    /// </summary>
    public Task<FinancePayablesResult<FinancePayablesMutation>> ReversePaymentAsync(Guid actorId, Guid id, FinancePayablesReverse input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "payable.payment.reverse", id, input, "finance.payables.reverse", async a =>
        {
            Require(Finance(a, "finance.payables.reverse"), FinancePayablesProblems.Forbidden);
            var payment = await PaymentAsync(a, id, ct); Match(payment.RowVersion, input.ExpectedVersion);
            RequireReason(input.Reason, true);
            var reversals = context.Set<FinancePayablesReversal>(); var now = clock.GetUtcNow(); var reason = input.Reason!.Trim();
            var voided = await PaymentVoids().AnyAsync(v => v.PaymentId == payment.Id, ct);
            if (input.ApplicationId is { } applicationId)
            {
                var application = await context.Set<FinancePayablesApplication>().SingleOrDefaultAsync(x => x.PublicId == applicationId && x.PaymentId == payment.Id, ct);
                Require(application is not null, FinancePayablesProblems.NotFound);
                Require(!await reversals.AnyAsync(r => r.ApplicationId == application!.Id, ct), FinancePayablesProblems.AlreadyReversed);
                Require(!voided, FinancePayablesProblems.PaymentVoided);
                var invoice = await context.Set<SupplierInvoice>().SingleAsync(x => x.Id == application!.SupplierInvoiceId, ct);
                reversals.Add(new FinancePayablesReversal { PublicId = Guid.CreateVersion7(), PaymentId = payment.Id, ApplicationId = application!.Id,
                    Reason = reason, ActorAccountId = a.Id, ReversedAt = now });
                invoice.UpdatedAt = now; context.Entry(invoice).Property(x => x.UpdatedAt).IsModified = true;
                Audit(a, "finance.payable.application_reversed", "commercial.supplier_invoices", invoice.PublicId, reason);
                Audit(a, "finance.payable.application_reversed", "commercial.payable_payments", payment.PublicId, reason);
            }
            else
            {
                Require(!voided, FinancePayablesProblems.AlreadyReversed);
                Require(!await ActiveApplications().AnyAsync(x => x.PaymentId == payment.Id, ct), FinancePayablesProblems.PaymentHasApplications);
                reversals.Add(new FinancePayablesReversal { PublicId = Guid.CreateVersion7(), PaymentId = payment.Id, Reason = reason,
                    ActorAccountId = a.Id, ReversedAt = now });
                Audit(a, "finance.payable.payment_voided", "commercial.payable_payments", payment.PublicId, reason);
            }
            payment.UpdatedAt = now; context.Entry(payment).Property(x => x.UpdatedAt).IsModified = true;
            return payment.PublicId;
        }, ct);
}
