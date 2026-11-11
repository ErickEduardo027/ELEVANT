using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed class EfNonFiscalInvoiceReadStore(
    ElevantDbContext context, TimeProvider timeProvider) : INonFiscalInvoiceReadStore
{
    public async Task<NonFiscalInvoiceData?> GetForFinanceAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || preinvoiceId == Guid.Empty) return null;
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !FinanceInvoicePolicy.CanReadInvoice(actor) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        var stationIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        // 4-N02: «Facturas» opens every invoice of its stations; the issuance of «Por facturar» alone, what it issued.
        var everyInvoice = FinanceInvoicePolicy.ReadsEveryInvoice(actor);
        var now = timeProvider.GetUtcNow();
        var header = await (
            from invoice in context.NonFiscalInvoices.AsNoTracking()
            join preinvoice in context.Preinvoices.AsNoTracking()
                on invoice.PreinvoiceId equals preinvoice.Id
            join station in context.Stations.AsNoTracking()
                on invoice.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on invoice.AirlineId equals airline.Id
            where preinvoice.PublicId == preinvoiceId &&
                  preinvoice.Status == PreinvoiceStatus.Invoiced &&
                  stationIds.Contains(station.PublicId) &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == accountId &&
                      (everyInvoice || account.Id == invoice.IssuedByAccountId) &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new { invoice.Id, invoice.PublicId, PreinvoiceId = preinvoice.PublicId,
                AirlineId = airline.PublicId, StationId = station.PublicId,
                invoice.Number, invoice.CurrencyCode, invoice.Total, invoice.CreatedAt })
            .SingleOrDefaultAsync(cancellationToken);
        return header is null ? null : await ReadLinesAsync(header.Id, header.PublicId,
            header.PreinvoiceId, header.AirlineId, header.StationId,
            header.Number, header.CurrencyCode, header.Total, header.CreatedAt,
            cancellationToken);
    }

    public async Task<NonFiscalInvoiceData?> GetForAirlineAsync(
        Guid organizationId, Guid preinvoiceId, CancellationToken cancellationToken = default)
    {
        if (organizationId == Guid.Empty || preinvoiceId == Guid.Empty) return null;
        var header = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            join preinvoice in context.Preinvoices.AsNoTracking()
                on airline.Id equals preinvoice.AirlineId
            join invoice in context.NonFiscalInvoices.AsNoTracking()
                on preinvoice.Id equals invoice.PreinvoiceId
            join station in context.Stations.AsNoTracking()
                on invoice.StationId equals station.Id
            where organization.PublicId == organizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive &&
                  preinvoice.PublicId == preinvoiceId &&
                  preinvoice.Status == PreinvoiceStatus.Invoiced
            select new { invoice.Id, invoice.PublicId, PreinvoiceId = preinvoice.PublicId,
                AirlineId = airline.PublicId, StationId = station.PublicId,
                invoice.Number, invoice.CurrencyCode, invoice.Total, invoice.CreatedAt })
            .SingleOrDefaultAsync(cancellationToken);
        return header is null ? null : await ReadLinesAsync(header.Id, header.PublicId,
            header.PreinvoiceId, header.AirlineId, header.StationId,
            header.Number, header.CurrencyCode, header.Total, header.CreatedAt,
            cancellationToken);
    }

    public async Task<Guid?> PreinvoiceOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        invoiceId == Guid.Empty ? null : await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                                               join preinvoice in context.Preinvoices.AsNoTracking()
                                                   on invoice.PreinvoiceId equals preinvoice.Id
                                               where invoice.PublicId == invoiceId
                                               select (Guid?)preinvoice.PublicId).SingleOrDefaultAsync(cancellationToken);

    /// <summary>The invoice for system use (the email attachment); never exposed to a caller.</summary>
    internal async Task<NonFiscalInvoiceData?> SystemReadAsync(Guid invoiceId, CancellationToken cancellationToken)
    {
        var header = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                            join preinvoice in context.Preinvoices.AsNoTracking() on invoice.PreinvoiceId equals preinvoice.Id
                            join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
                            join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                            where invoice.PublicId == invoiceId
                            select new { invoice.Id, invoice.PublicId, PreinvoiceId = preinvoice.PublicId,
                                AirlineId = airline.PublicId, StationId = station.PublicId,
                                invoice.Number, invoice.CurrencyCode, invoice.Total, invoice.CreatedAt })
            .SingleOrDefaultAsync(cancellationToken);
        return header is null ? null : await ReadLinesAsync(header.Id, header.PublicId, header.PreinvoiceId,
            header.AirlineId, header.StationId, header.Number, header.CurrencyCode, header.Total, header.CreatedAt,
            cancellationToken);
    }

    private async Task<NonFiscalInvoiceData> ReadLinesAsync(
        long internalId, Guid id, Guid preinvoiceId, Guid airlineId, Guid stationId,
        string number, string currency, decimal total, DateTimeOffset issuedAt,
        CancellationToken cancellationToken)
    {
        var lines = await context.NonFiscalInvoiceLines.AsNoTracking()
            .Where(line => line.InvoiceId == internalId)
            .OrderBy(line => line.LineNumber)
            .Select(line => new NonFiscalInvoiceLineData(line.PublicId, line.LineNumber,
                line.OperationCode, line.OperationDate, line.ServiceCode,
                line.ServiceName, line.ExecutedQuantity, line.BillingUnit,
                line.UnitPrice, line.Amount, line.NetAmount, line.TaxAmount))
            .ToArrayAsync(cancellationToken);
        // ADR-0035: the simulated e-CF identity and the parties printed on the document.
        var fiscal = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                            join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                            join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                            join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
                            where invoice.Id == internalId
                            select new NonFiscalInvoiceFiscalData(invoice.FiscalNumber, invoice.SecurityCode,
                                invoice.FiscalSignedAt, invoice.DueDate, invoice.NetTotal, invoice.TaxTotal, "AVIAM Ltd.",
                                FinanceInvoicePolicy.SimulatedIssuerRnc, organization.LegalName, station.Code))
            .SingleAsync(cancellationToken);
        return new NonFiscalInvoiceData(id, preinvoiceId, airlineId, stationId,
            number, currency, total, issuedAt, lines, fiscal);
    }
}
