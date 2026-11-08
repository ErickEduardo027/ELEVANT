using Elevant.Application.Common;
using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    private async Task<T> ChangedAsync<T>(Guid id, CancellationToken ct) where T : AuditableEntity =>
        context.Set<T>().Local.SingleOrDefault(x => x.PublicId == id) ?? await context.Set<T>().SingleAsync(x => x.PublicId == id, ct);
    private async Task NotifyMutationAsync(string operation, Guid? parentId, Guid resultId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        if (operation.StartsWith("expense.", StringComparison.Ordinal))
        {
            var claim = await ChangedAsync<EmployeeExpenseClaim>(parentId ?? resultId, ct);
            await FinanceApprovedServiceChangeWriter.AddAsync(context, claim.ScopeStationId, claim.PublicId, now, "finance_expenses", ct);
            if (operation == "expense.reimburse")
                await FinanceApprovedServiceChangeWriter.AddAsync(context, claim.ScopeStationId, resultId, now, "finance_receipts", ct);
            var today = BusinessCalendar.Today(now);
            var candidates = await context.Users.AsNoTracking().Where(u => u.Status == AccountLifecycleStatus.Active && u.InvitationStatus == InvitationStatus.Accepted && u.EmailConfirmed &&
                context.AccountStationScopes.Any(s => s.AccountId == u.Id && s.StationId == claim.ScopeStationId && s.GrantedAt <= now && s.RevokedAt == null) &&
                context.OrganizationMemberships.Any(m => m.AccountId == u.Id && m.Kind == MembershipKind.InternalStaff && m.Status == MembershipStatus.Active &&
                    (m.ValidFrom == null || m.ValidFrom <= today) && (m.ValidTo == null || m.ValidTo >= today) &&
                    context.Organizations.Any(o => o.Id == m.OrganizationId && o.Type == OrganizationType.AviamOperator && o.Status == OrganizationStatus.Active)))
                .Select(u => u.Id).ToArrayAsync(ct);
            var access = await DepartmentAccessQueries.ReadManyAsync(context, candidates, ct);
            foreach (var pair in access.Where(pair => pair.Value.Department != Department.Finance &&
                (pair.Key == claim.CreatedByAccountId || pair.Value.Kind == DepartmentAssignmentKind.Administrator && pair.Value.Department == claim.Department)))
                AccountChangeOutboxWriter.Add(context, pair.Key, claim.ScopeStationId, "finance_expenses", claim.PublicId, now);
            if (candidates.Contains(claim.CreatedByAccountId) && !access.ContainsKey(claim.CreatedByAccountId))
                AccountChangeOutboxWriter.Add(context, claim.CreatedByAccountId, claim.ScopeStationId, "finance_expenses", claim.PublicId, now);
        }
        else if (operation.StartsWith("supplier.", StringComparison.Ordinal))
        {
            var supplier = await ChangedAsync<Supplier>(parentId ?? resultId, ct);
            await FinanceApprovedServiceChangeWriter.AddAsync(context, supplier.ScopeStationId, supplier.PublicId, now, "finance_payables", ct);
        }
        else if (operation.StartsWith("payable.payment.", StringComparison.Ordinal))
        {
            var payment = await ChangedAsync<FinancePayablesPayment>(parentId ?? resultId, ct);
            await FinanceApprovedServiceChangeWriter.AddAsync(context, payment.ScopeStationId, payment.PublicId, now, "finance_receipts", ct);
            var invoiceIds = context.Set<FinancePayablesApplication>().Local
                .Where(a => context.Entry(a).State == EntityState.Added && a.PaymentId == payment.Id)
                .Select(a => a.SupplierInvoiceId).Distinct().ToArray();
            foreach (var invoiceId in invoiceIds)
            {
                var invoice = context.Set<SupplierInvoice>().Local.Single(i => i.Id == invoiceId);
                await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.ScopeStationId, invoice.PublicId, now, "finance_payables", ct);
            }
        }
        else
        {
            var invoice = await ChangedAsync<SupplierInvoice>(parentId ?? resultId, ct);
            await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.ScopeStationId, invoice.PublicId, now, "finance_payables", ct);
        }
    }
}
