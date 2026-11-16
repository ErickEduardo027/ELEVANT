using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// «Inicio» of Finance (4-A, 4-N02): the indicators of one station at the business day of Santo Domingo, each one
/// computed in SQL from the records it summarizes and governed by the module it opens. Nothing reads a preinvoice and
/// a missing module hides its section instead of failing the page.
/// </summary>
internal sealed class EfFinanceHomeStore(ElevantDbContext context, TimeProvider timeProvider) : IFinanceHomeStore
{
    public const string ReadPermission = "finance.home.read";

    public async Task<FinanceHomeData?> GetAsync(Guid actorId, Guid stationId, CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || stationId == Guid.Empty) return null;
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(actorId, cancellationToken);
        if (actor is null || actor.AccountId != actorId || !actor.HasPermission(ReadPermission) ||
            !actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (station is not { } stationKey) return null;

        var today = BusinessCalendar.Today(timeProvider.GetUtcNow());
        var month = new DateOnly(today.Year, today.Month, 1);
        var monthStart = BusinessCalendar.StartOfDay(month);
        var monthEnd = BusinessCalendar.StartOfDay(month.AddMonths(1));
        var canReadInvoices = actor.HasPermission("finance.reconciliation.read");

        return new FinanceHomeData(stationId, today,
            actor.HasPermission(FinanceInvoicePolicy.ReadPermission)
                ? await ToInvoiceAsync(stationKey, cancellationToken) : null,
            canReadInvoices || actor.HasPermission(FinanceInvoicePolicy.ReadPermission)
                ? await InvoicedAsync(stationKey, monthStart, monthEnd, cancellationToken) : null,
            canReadInvoices ? await ReceivablesAsync(stationKey, today, cancellationToken) : null,
            canReadInvoices ? await CardCollectionsAsync(stationKey, monthStart, monthEnd, cancellationToken) : null,
            actor.HasPermission("finance.contract_approvals.read")
                ? await PendingContractApprovalsAsync(actor.StationScopes.Select(scope => scope.StationId).ToArray(),
                    cancellationToken)
                : null,
            actor.HasPermission("finance.charters.read")
                ? await ChartersAwaitingPrepaymentAsync(stationKey, cancellationToken) : null);
    }

    /// <summary>The pending predicate of «Por facturar» (block A): invoiced and closed-without-charge work is out.</summary>
    private async Task<FinanceHomeToInvoiceData> ToInvoiceAsync(long station, CancellationToken cancellationToken)
    {
        var pending = from operation in new EfFinancePendingOperationsReadStore(context, timeProvider).PendingOperations(station)
                      join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                      select new { turnaround.AirlineId, turnaround.OperationDate };
        var operations = await pending.CountAsync(cancellationToken);
        if (operations == 0) return new FinanceHomeToInvoiceData(0, 0, null);
        return new FinanceHomeToInvoiceData(operations,
            await pending.Select(item => item.AirlineId).Distinct().CountAsync(cancellationToken),
            await pending.MinAsync(item => (DateOnly?)item.OperationDate, cancellationToken));
    }

    /// <summary>The invoices issued in the business month, by currency.</summary>
    private async Task<IReadOnlyList<FinanceHomeAmountData>> InvoicedAsync(long station, DateTimeOffset from,
        DateTimeOffset to, CancellationToken cancellationToken) =>
        (await context.NonFiscalInvoices.AsNoTracking()
            .Where(invoice => invoice.StationId == station && invoice.CreatedAt >= from && invoice.CreatedAt < to)
            .GroupBy(invoice => invoice.CurrencyCode)
            .Select(group => new { group.Key, Count = group.Count(), Amount = group.Sum(invoice => invoice.Total) })
            .ToArrayAsync(cancellationToken))
        .OrderBy(item => item.Key, StringComparer.Ordinal)
        .Select(item => new FinanceHomeAmountData(item.Key, item.Count, item.Amount)).ToArray();

    /// <summary>
    /// What the airlines owe at the business day, as «Cuentas por cobrar y antigüedad» computes it: legacy payments and
    /// credits, treasury applications and adjustment notes until the end of the day; past due once the due day passed.
    /// </summary>
    private async Task<IReadOnlyList<FinanceHomeReceivableData>> ReceivablesAsync(long station, DateOnly today,
        CancellationToken cancellationToken)
    {
        var end = BusinessCalendar.StartOfDay(today.AddDays(1));
        var invoices = await context.NonFiscalInvoices.AsNoTracking()
            .Where(invoice => invoice.StationId == station && invoice.CreatedAt < end)
            .Select(invoice => new { invoice.Id, invoice.CurrencyCode, invoice.Total, invoice.DueDate })
            .ToArrayAsync(cancellationToken);
        if (invoices.Length == 0) return [];
        var ids = invoices.Select(invoice => invoice.Id).ToArray();
        var paid = await context.NonFiscalPayments.AsNoTracking()
            .Where(item => ids.Contains(item.InvoiceId) && item.CreatedAt < end && (item.PaidOn == null || item.PaidOn <= today))
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var credited = await context.NonFiscalCreditNotes.AsNoTracking()
            .Where(item => ids.Contains(item.InvoiceId) && item.CreatedAt < end)
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var treasury = await FinanceTreasuryBalances.TotalsAsync(context, ids, cancellationToken, today);
        return invoices
            .Select(invoice => new
            {
                invoice.CurrencyCode,
                Balance = FinanceTreasuryRules.Balance(invoice.Total, paid.GetValueOrDefault(invoice.Id),
                    credited.GetValueOrDefault(invoice.Id), treasury[invoice.Id].Applied, treasury[invoice.Id].Credited,
                    treasury[invoice.Id].Debited),
                Overdue = invoice.DueDate is { } due && due < today,
            })
            .Where(item => item.Balance > 0m)
            .GroupBy(item => item.CurrencyCode).OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new FinanceHomeReceivableData(group.Key, group.Count(), group.Sum(item => item.Balance),
                group.Count(item => item.Overdue), group.Where(item => item.Overdue).Sum(item => item.Balance)))
            .ToArray();
    }

    /// <summary>The card payments the portal approved in the business month (ADR-0036), by currency.</summary>
    private async Task<IReadOnlyList<FinanceHomeAmountData>> CardCollectionsAsync(long station, DateTimeOffset from,
        DateTimeOffset to, CancellationToken cancellationToken) =>
        (await (from attempt in context.Set<CardPaymentAttempt>().AsNoTracking()
                join invoice in context.NonFiscalInvoices.AsNoTracking() on attempt.InvoiceId equals invoice.Id
                where invoice.StationId == station && attempt.Status == CardPaymentStatus.Approved &&
                      attempt.CreatedAt >= @from && attempt.CreatedAt < to
                group attempt by attempt.CurrencyCode into byCurrency
                select new { byCurrency.Key, Count = byCurrency.Count(), Amount = byCurrency.Sum(item => item.Amount) })
            .ToArrayAsync(cancellationToken))
        .OrderBy(item => item.Key, StringComparer.Ordinal)
        .Select(item => new FinanceHomeAmountData(item.Key, item.Count, item.Amount)).ToArray();

    /// <summary>
    /// The contract versions waiting for Finance whose stations are all in the account's scope: what «Aprobación de
    /// contratos» lists, which is not filtered by station.
    /// </summary>
    private Task<int> PendingContractApprovalsAsync(Guid[] scope, CancellationToken cancellationToken) =>
        context.ContractVersions.AsNoTracking()
            .CountAsync(version => version.Status == ContractVersionStatus.PendingFinanceApproval &&
                context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id) &&
                !context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id &&
                    !context.Stations.Any(station => station.Id == link.StationId && scope.Contains(station.PublicId))),
                cancellationToken);

    /// <summary>Charters of the station whose prepayment Finance has not confirmed, on turnarounds not cancelled.</summary>
    private Task<int> ChartersAwaitingPrepaymentAsync(long station, CancellationToken cancellationToken) =>
        (from agreement in context.Set<CharterAgreement>().AsNoTracking()
         join turnaround in context.Turnarounds.AsNoTracking() on agreement.TurnaroundId equals turnaround.Id
         where turnaround.StationId == station && agreement.PrepaymentStatus == CharterPrepaymentStatus.Pending &&
               turnaround.CurrentStatus != TurnaroundStatus.Cancelled
         select agreement.Id).CountAsync(cancellationToken);
}
