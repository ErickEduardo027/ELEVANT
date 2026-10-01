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
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
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
            .Select(item => new NonFiscalPaymentData(item.PublicId, invoiceId,
                item.Reference, item.CurrencyCode, item.Amount, item.CreatedAt))
            .SingleOrDefaultAsync(cancellationToken);
        return new NonFiscalPaymentLookupData(invoiceId, payment, invoiceNumber);
    }
}
