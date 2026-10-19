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
            var today = SettlementToday; var end = SettlementCutoff; var applications = CurrentApplications();
            var query = context.Set<FinancePayablesPayment>().AsNoTracking().Where(x => a.Stations.Contains(x.ScopeStationId) && x.PaidOn <= today && x.CreatedAt < end);
            if (station is not null) query = query.Where(x => x.ScopeStationId == station);
            if (filter.SupplierId is { } supplier) query = query.Where(x => context.Set<Supplier>().Any(s => s.Id == x.SupplierId && s.PublicId == supplier));
            if (filter.From is { } from) query = query.Where(x => x.PaidOn >= from);
            if (filter.To is { } to) query = query.Where(x => x.PaidOn <= to);
            if (!string.IsNullOrWhiteSpace(filter.Search)) query = query.Where(x => x.Reference.Contains(filter.Search));
            if (filter.OutstandingOnly) query = query.Where(x => x.Amount > (applications.Where(p => p.PaymentId == x.Id).Sum(p => (decimal?)p.PaymentAmount) ?? 0));
            var rows = await query.OrderByDescending(x => x.PaidOn).ThenBy(x => x.Id).Skip(filter.Skip).Take(filter.Take).ToArrayAsync(ct);
            var result = new List<FinancePayablesPaymentView>(); foreach (var row in rows) result.Add(await PaymentViewAsync(row, ct)); return result;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> RecordPaymentAsync(Guid actorId, FinancePayablesPaymentSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "payable.payment.record", null, input, "finance.payables.pay", async a =>
        {
            Require(Finance(a, "finance.payables.pay"), "forbidden"); Require(Text(input.Reference, 100) && FinancePayablesPolicy.Money(input.Amount) && input.Amount > 0);
            RequireSettlementDate(input.PaidOn);
            var dop = ValidateFx(input.Fx, input.Amount, input.PaidOn); var station = await StationAsync(a, input.ScopeStationId, ct);
            var supplier = await SupplierAsync(a, input.SupplierId, ct); Require(supplier.IsActive && supplier.ScopeStationId == station);
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
            // Retained allocations still cap writes, including old invalid future rows, to prevent later overapplication.
            var used = await context.Set<FinancePayablesApplication>().Where(x => x.PaymentId == payment.Id).SumAsync(x => (decimal?)x.PaymentAmount, ct) ?? 0m;
            var remaining = payment.Amount - used;
            // All invoice reads and both balance updates share this SERIALIZABLE transaction. Order reduces deadlocks.
            foreach (var application in input.Applications!.OrderBy(x => x.InvoiceId))
            {
                var invoice = await InvoiceAsync(a, application.InvoiceId, ct); Match(invoice.RowVersion, application.ExpectedVersion);
                Require(invoice.Status == SupplierInvoiceStatus.Approved && invoice.SupplierId == payment.SupplierId && invoice.ScopeStationId == payment.ScopeStationId, "conflict");
                var invoiceUsed = await context.Set<FinancePayablesApplication>().Where(x => x.SupplierInvoiceId == invoice.Id).SumAsync(x => (decimal?)x.InvoiceAmount, ct) ?? 0m;
                var rate = ApplicationRate(payment.CurrencyCode, payment.FxToDop, invoice.CurrencyCode, invoice.FxToDop, application.RateToInvoice);
                Require(FinancePayablesPolicy.CanApply(remaining, invoice.Total - invoiceUsed, application.PaymentAmount, rate), "conflict");
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
}
