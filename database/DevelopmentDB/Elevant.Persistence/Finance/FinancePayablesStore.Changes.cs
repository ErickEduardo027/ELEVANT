using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    /// <summary>An internal AVIAM account that holds a station, with its person and effective department access.</summary>
    private sealed record StationStaff(long AccountId, long PersonId, DepartmentAccess? Access);

    /// <summary>
    /// The internal AVIAM staff of a station now: active, invited and confirmed accounts with the station in scope and a
    /// current AVIAM membership by the business day. The notices of an expense and, 4-N13, its reviewers come from it.
    /// </summary>
    private async Task<IReadOnlyList<StationStaff>> StationStaffAsync(long station, DateTimeOffset now, CancellationToken ct)
    {
        var today = BusinessCalendar.Today(now);
        var accounts = await context.Users.AsNoTracking().Where(u => u.Status == AccountLifecycleStatus.Active && u.InvitationStatus == InvitationStatus.Accepted && u.EmailConfirmed &&
            context.AccountStationScopes.Any(s => s.AccountId == u.Id && s.StationId == station && s.GrantedAt <= now && s.RevokedAt == null) &&
            context.OrganizationMemberships.Any(m => m.AccountId == u.Id && m.Kind == MembershipKind.InternalStaff && m.Status == MembershipStatus.Active &&
                (m.ValidFrom == null || m.ValidFrom <= today) && (m.ValidTo == null || m.ValidTo >= today) &&
                context.Organizations.Any(o => o.Id == m.OrganizationId && o.Type == OrganizationType.AviamOperator && o.Status == OrganizationStatus.Active)))
            .Select(u => new { u.Id, u.PersonId }).ToArrayAsync(ct);
        var access = await DepartmentAccessQueries.ReadManyAsync(context, accounts.Select(x => x.Id).ToArray(), ct);
        return accounts.Select(x => new StationStaff(x.Id, x.PersonId, access.GetValueOrDefault(x.Id))).ToArray();
    }
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
            // Finance hears through its station feed above; the requester and the department's administrators here.
            var staff = await StationStaffAsync(claim.ScopeStationId, now, ct);
            foreach (var member in staff.Where(m => m.Access is { } access && access.Department != Department.Finance &&
                (m.AccountId == claim.CreatedByAccountId || access.Kind == DepartmentAssignmentKind.Administrator && access.Department == claim.Department)))
                AccountChangeOutboxWriter.Add(context, member.AccountId, claim.ScopeStationId, "finance_expenses", claim.PublicId, now);
            if (staff.Any(m => m.AccountId == claim.CreatedByAccountId && m.Access is null))
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
            // 4-N04: a reversed application changes the balance of its invoice too.
            var reversedApplications = context.Set<FinancePayablesReversal>().Local
                .Where(r => context.Entry(r).State == EntityState.Added && r.ApplicationId is not null).Select(r => r.ApplicationId!.Value).ToHashSet();
            var invoiceIds = context.Set<FinancePayablesApplication>().Local
                .Where(a => context.Entry(a).State == EntityState.Added && a.PaymentId == payment.Id || reversedApplications.Contains(a.Id))
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
