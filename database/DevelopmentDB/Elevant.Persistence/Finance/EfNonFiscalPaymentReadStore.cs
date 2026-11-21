using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed class EfNonFiscalPaymentReadStore(
    ElevantDbContext context, TimeProvider timeProvider) : INonFiscalPaymentReadStore
{
    public async Task<NonFiscalPaymentLookupData?> GetForFinanceAsync(
        Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || invoiceId == Guid.Empty) return null;
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.reconciliation.read") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        var stationIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var now = timeProvider.GetUtcNow();
        var header = await (
            from invoice in context.NonFiscalInvoices.AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on invoice.StationId equals station.Id
            where invoice.PublicId == invoiceId && stationIds.Contains(station.PublicId) &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == accountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new { invoice.Id, invoice.PublicId, invoice.Number })
            .SingleOrDefaultAsync(cancellationToken);
        return header is null ? null : await ReadAsync(header.Id,
            header.PublicId, header.Number, cancellationToken);
    }

    public async Task<NonFiscalPaymentLookupData?> GetForAirlineAsync(
        Guid organizationId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        if (organizationId == Guid.Empty || invoiceId == Guid.Empty) return null;
        var header = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            join invoice in context.NonFiscalInvoices.AsNoTracking()
                on airline.Id equals invoice.AirlineId
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive &&
                  invoice.PublicId == invoiceId
            select new { invoice.Id, invoice.PublicId, invoice.Number })
            .SingleOrDefaultAsync(cancellationToken);
        return header is null ? null : await ReadAsync(header.Id,
            header.PublicId, header.Number, cancellationToken);
    }

    private async Task<NonFiscalPaymentLookupData> ReadAsync(long internalInvoiceId,
        Guid invoiceId, string invoiceNumber, CancellationToken cancellationToken)
    {
        var payment = await context.NonFiscalPayments.AsNoTracking()
            .Where(item => item.InvoiceId == internalInvoiceId)
            .OrderByDescending(item => item.CreatedAt).ThenByDescending(item => item.Id)
            .Select(item => new NonFiscalPaymentData(item.PublicId, invoiceId,
                item.Reference, item.CurrencyCode, item.Amount, item.CreatedAt, null, item.Method.ToString(), item.PaidOn,
                null, null, null, null))
            .FirstOrDefaultAsync(cancellationToken);
        if (payment is null) return new NonFiscalPaymentLookupData(invoiceId, null, invoiceNumber);
        // PR E: what the receipt prints besides the payment: the payer, the invoice's e-NCF and total, and its balance
        // on the day the receipt is produced (the receipt is stored once, with that date).
        var invoice = await (from item in context.NonFiscalInvoices.AsNoTracking()
                             join airline in context.Airlines.AsNoTracking() on item.AirlineId equals airline.Id
                             join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                             where item.Id == internalInvoiceId
                             select new { item.FiscalNumber, item.Total, organization.LegalName })
            .SingleAsync(cancellationToken);
        var balance = await FinanceTreasuryBalances.BalanceAsync(context, internalInvoiceId, invoice.Total, cancellationToken);
        return new NonFiscalPaymentLookupData(invoiceId, payment with
        {
            PayerName = invoice.LegalName, InvoiceFiscalNumber = invoice.FiscalNumber, InvoiceTotal = invoice.Total,
            Balance = balance, BalanceOn = Application.Common.BusinessCalendar.Today(timeProvider.GetUtcNow()),
        }, invoiceNumber);
    }
}
