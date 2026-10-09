using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Bounded, station-scoped reads of accepted preinvoices, issued invoices and manual payments.</summary>
internal sealed class EfFinanceReconciliationReadStore(
    ElevantDbContext context, TimeProvider timeProvider) : IFinanceReconciliationReadStore
{
    public async Task<FinanceReconciliationPageData?> ListAsync(Guid accountId,
        Guid stationId, int page, int limit, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || stationId == Guid.Empty || page < 1 ||
            limit is < 1 or > 50 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.reconciliation.read") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from account in context.Users.AsNoTracking()
            from station in context.Stations.AsNoTracking()
            where account.PublicId == accountId && station.PublicId == stationId &&
                  station.IsActive && context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { AccountId = account.Id, StationId = station.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return null;

        var candidates = await (
            from preinvoice in context.Preinvoices.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on preinvoice.AirlineId equals airline.Id
            where preinvoice.StationId == scope.StationId &&
                  (preinvoice.Status == PreinvoiceStatus.Accepted ||
                   preinvoice.Status == PreinvoiceStatus.Invoiced) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == scope.AccountId && grant.StationId == preinvoice.StationId &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            orderby preinvoice.CreatedAt descending, preinvoice.Id descending
            select new { preinvoice.Id, preinvoice.PublicId,
                AirlineId = airline.PublicId, AirlineName = airline.Name,
                preinvoice.From, preinvoice.To, preinvoice.CurrencyCode,
                preinvoice.Total, preinvoice.Status })
            .Skip((page - 1) * limit).Take(limit + 1).ToArrayAsync(cancellationToken);
        var selected = candidates.Take(limit).ToArray();
        var preinvoiceIds = selected.Select(item => item.Id).ToArray();
        var invoices = await context.NonFiscalInvoices.AsNoTracking()
            .Where(invoice => preinvoiceIds.Contains(invoice.PreinvoiceId))
            .Select(invoice => new { invoice.Id, invoice.PublicId, invoice.PreinvoiceId,
                invoice.Number, invoice.Total, invoice.CreatedAt })
            .ToArrayAsync(cancellationToken);
        var invoiceIds = invoices.Select(invoice => invoice.Id).ToArray();
        var payments = await context.NonFiscalPayments.AsNoTracking()
            .Where(payment => invoiceIds.Contains(payment.InvoiceId))
            .Select(payment => new { payment.PublicId, payment.InvoiceId,
                payment.Reference, payment.Amount, payment.CreatedAt })
            .ToArrayAsync(cancellationToken);
        if (!await context.AccountStationScopes.AsNoTracking().AnyAsync(grant =>
                grant.AccountId == scope.AccountId && grant.StationId == scope.StationId &&
                grant.GrantedAt <= now && grant.RevokedAt == null, cancellationToken))
            return null;

        var byPreinvoice = invoices.ToDictionary(invoice => invoice.PreinvoiceId);
        // Several partial payments may settle an invoice: report their sum and the latest one.
        var byInvoice = payments.GroupBy(payment => payment.InvoiceId).ToDictionary(group => group.Key,
            group => new { Latest = group.OrderBy(payment => payment.CreatedAt).Last(), Total = group.Sum(payment => payment.Amount) });
        var rows = selected.Select(item =>
        {
            var invoice = byPreinvoice.GetValueOrDefault(item.Id);
            var payment = invoice is null ? null : byInvoice.GetValueOrDefault(invoice.Id);
            return new FinanceReconciliationData(item.PublicId, item.AirlineId,
                item.AirlineName, item.From, item.To, item.CurrencyCode,
                item.Total, item.Status.ToString(), invoice?.PublicId, invoice?.Number,
                invoice?.Total, invoice?.CreatedAt, payment?.Latest.PublicId, payment?.Latest.Reference,
                payment?.Total, payment?.Latest.CreatedAt);
        }).ToArray();
        return new FinanceReconciliationPageData(stationId, page, limit,
            candidates.Length > limit, rows);
    }
}
