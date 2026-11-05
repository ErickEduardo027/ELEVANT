using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>Issues one non-fiscal invoice from accepted immutable snapshots.</summary>
internal sealed class EfFinanceInvoiceIssueStore(
    ElevantDbContext context, TimeProvider timeProvider) : IFinanceInvoiceIssueStore
{
    public async Task<IssueFinanceInvoiceResult> IssueAsync(
        IssueFinanceInvoiceCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var strategy = context.Database.CreateExecutionStrategy();
        IssueFinanceInvoiceResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await IssueInsideTransactionAsync(command, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess) return attempt is not null;
                    return await context.NonFiscalInvoices.AsNoTracking().AnyAsync(item =>
                        item.PublicId == attempt.InvoiceId && item.Number == attempt.Number &&
                        item.RequestId == command.RequestId &&
                        context.Preinvoices.AsNoTracking().Any(preinvoice =>
                            preinvoice.Id == item.PreinvoiceId &&
                            preinvoice.PublicId == command.PreinvoiceId) &&
                        context.Users.AsNoTracking().Any(account =>
                            account.Id == item.IssuedByAccountId &&
                            account.PublicId == command.AccountId), token);
                },
                IsolationLevel.Serializable, cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniquenessConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, cancellationToken);
        }
        catch (RetryLimitExceededException exception) when (IsUniquenessConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, cancellationToken);
        }
        catch (SqlException exception) when (IsUniquenessConflict(exception))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, cancellationToken);
        }
    }

    /// <summary>ADR-0035: issues the invoice of the internal draft inside the caller's transaction.</summary>
    internal Task<IssueFinanceInvoiceResult> IssueForInvoicingAsync(IssueFinanceInvoiceCommand command,
        CancellationToken cancellationToken) => IssueInsideTransactionAsync(command, cancellationToken, requirePermission: false);

    private async Task<IssueFinanceInvoiceResult> IssueInsideTransactionAsync(
        IssueFinanceInvoiceCommand command, CancellationToken cancellationToken, bool requirePermission = true)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            requirePermission && !actor.HasPermission("finance.preinvoices.issue") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Forbidden);

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from item in context.Preinvoices.AsNoTracking()
            join station in context.Stations.AsNoTracking() on item.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking() on item.AirlineId equals airline.Id
            join organization in context.Organizations.AsNoTracking()
                on airline.OrganizationId equals organization.Id
            where item.PublicId == command.PreinvoiceId && station.IsActive &&
                  airline.IsActive && organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == command.AccountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new { item.Id, item.PublicId, item.AirlineId, item.StationId,
                item.CurrencyCode, item.Total, item.Status,
                StationPublicId = station.PublicId,
                AirlineOrganizationId = organization.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null || !actor.StationScopes.Any(station =>
                station.StationId == scope.StationPublicId))
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.NotFound);

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == command.AccountId)
            .Select(account => account.Id).SingleAsync(cancellationToken);
        var prior = await context.NonFiscalInvoices.AsNoTracking()
            .Where(item => item.PreinvoiceId == scope.Id || item.RequestId == command.RequestId)
            .Select(item => new { item.PublicId, item.PreinvoiceId,
                item.RequestId, item.IssuedByAccountId, item.Number })
            .ToArrayAsync(cancellationToken);
        if (prior.Length > 0)
        {
            var exact = prior.Length == 1 && prior[0].PreinvoiceId == scope.Id &&
                prior[0].RequestId == command.RequestId &&
                prior[0].IssuedByAccountId == accountId;
            return exact
                ? IssueFinanceInvoiceResult.Success(prior[0].PublicId, prior[0].Number, true)
                : IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);
        }
        if (scope.Status != PreinvoiceStatus.Accepted)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);

        // Excluded lines stay on the preinvoice for traceability but are not invoiced.
        var allLines = await context.PreinvoiceLines.AsNoTracking()
            .Where(line => line.PreinvoiceId == scope.Id)
            .OrderBy(line => line.LineNumber).ToArrayAsync(cancellationToken);
        var lines = allLines.Where(line => !line.IsExcluded).ToArray();
        var lineNumbers = allLines.ToDictionary(line => line.Id, line => line.LineNumber);
        if (lines.Length is < 1 or > 500 || lines.Any(line => line.ReleasedAt is not null) ||
            lines.Select(line => line.LineNumber).Distinct().Count() != lines.Length ||
            lines.Any(line => line.CurrencyCode != scope.CurrencyCode) ||
            lines.Sum(line => line.Amount) != scope.Total)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);

        // A historical line without a snapshot stays explicitly unknown. Issuance never applies a current policy.
        foreach (var line in lines) FinanceTaxCalculator.Capture(line, null, now);
        if (lines.Any(line => line.GrossAmount != line.Amount ||
            line.NetAmount - line.DiscountAmount + (line.TaxAmount ?? 0) != line.Amount))
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);

        var issuerIds = actor.Memberships.Where(m => m.OrganizationType == OrganizationType.AviamOperator &&
            m.Kind == MembershipKind.InternalStaff).Select(m => m.OrganizationId).Distinct().ToArray();
        if (issuerIds.Length != 1) return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);
        var issuer = await context.Organizations.AsNoTracking().Where(o => o.PublicId == issuerIds[0])
            .Select(o => new { o.PublicId, o.Code, o.LegalName, o.DisplayName }).SingleOrDefaultAsync(cancellationToken);
        var customer = await context.Organizations.AsNoTracking().Where(o => o.Id == scope.AirlineOrganizationId)
            .Select(o => new { o.PublicId, o.Code, o.LegalName, o.DisplayName }).SingleAsync(cancellationToken);
        var airlineIdentity = await context.Airlines.AsNoTracking().Where(a => a.Id == scope.AirlineId)
            .Select(a => new { a.PublicId, a.Name, a.IataCode, a.IcaoCode }).SingleAsync(cancellationToken);
        var stationIdentity = await context.Stations.AsNoTracking().Where(s => s.Id == scope.StationId)
            .Select(s => new { s.PublicId, s.Code, s.Name }).SingleAsync(cancellationToken);

        var updated = await context.Preinvoices
            .Where(item => item.Id == scope.Id && item.Status == PreinvoiceStatus.Accepted)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Status, PreinvoiceStatus.Invoiced)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (updated != 1)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);

        var terms = await context.AirlineBillingProfiles.AsNoTracking()
            .Where(profile => profile.AirlineId == scope.AirlineId)
            .Select(profile => (int?)profile.PaymentTermDays).SingleOrDefaultAsync(cancellationToken) ?? 30;
        var invoiceId = Guid.CreateVersion7();
        var invoice = new NonFiscalInvoice
        {
            PublicId = invoiceId, PreinvoiceId = scope.Id, AirlineId = scope.AirlineId,
            StationId = scope.StationId, IssuedByAccountId = accountId,
            RequestId = command.RequestId, Number = $"NF-{invoiceId:N}",
            CurrencyCode = scope.CurrencyCode, Total = scope.Total,
            PaymentTermDays = terms, DueDate = DateOnly.FromDateTime(now.UtcDateTime).AddDays(terms),
            CreatedAt = now, UpdatedAt = now,
        };
        invoice.NetTotal = lines.Sum(l => l.NetAmount ?? l.Amount);
        invoice.DiscountTotal = lines.Sum(l => l.DiscountAmount ?? 0);
        invoice.TaxTreatmentsConfigured = lines.All(FinanceTaxCalculator.IsConfigured);
        invoice.TaxTotal = invoice.TaxTreatmentsConfigured ? lines.Sum(l => l.TaxAmount ?? 0) : null;
        invoice.CommercialSnapshotJson = JsonSerializer.Serialize(new
        {
            version = 1, capturedAt = now, issuer, customer, airline = airlineIdentity, station = stationIdentity,
            invoice.CurrencyCode, invoice.PaymentTermDays, invoice.DueDate,
            net = invoice.NetTotal, discount = invoice.DiscountTotal, tax = invoice.TaxTotal, gross = invoice.Total,
            treatmentsConfigured = invoice.TaxTreatmentsConfigured,
            // The shared commercial model has no reviewed tax-registration/address source.
            issuerTaxRegistration = FinanceInvoicePolicy.SimulatedIssuerRnc, customerTaxRegistration = (string?)null,
            fiscalDisclaimer = FinanceInvoicePolicy.Disclaimer,
        });
        // ADR-0035: every new invoice gets the next simulated e-NCF; the serializable transaction and
        // the unique index keep the sequence gap-free and unique.
        var highest = await context.NonFiscalInvoices
            .FromSqlRaw("SELECT * FROM [commercial].[non_fiscal_invoices] WITH (UPDLOCK, HOLDLOCK)")
            .Where(item => item.FiscalNumber != null).Select(item => item.FiscalNumber).MaxAsync(cancellationToken);
        invoice.FiscalNumber = FinanceInvoicePolicy.NextFiscalNumber(highest);
        invoice.FiscalSignedAt = now;
        invoice.SecurityCode = FinanceInvoicePolicy.SecurityCode(invoice.FiscalNumber, invoice.Total, now,
            customer.Code);
        context.NonFiscalInvoices.Add(invoice);
        await context.SaveChangesAsync(cancellationToken);
        foreach (var line in lines)
            context.NonFiscalInvoiceLines.Add(new NonFiscalInvoiceLine
            {
                PublicId = Guid.CreateVersion7(), InvoiceId = invoice.Id,
                PreinvoiceLineId = line.Id, LineNumber = line.LineNumber,
                OperationCode = line.OperationCode, OperationDate = line.OperationDate,
                ServiceCode = line.ServiceCode, ServiceName = line.ServiceName,
                ExecutedQuantity = line.ExecutedQuantity, BillingUnit = line.BillingUnit,
                UnitPrice = line.UnitPrice, CurrencyCode = line.CurrencyCode,
                Amount = line.Amount, Kind = line.Kind,
                TaxPolicyPublicId = line.TaxPolicyPublicId, TaxTreatment = line.TaxTreatment,
                TaxRate = line.TaxRate, TaxBasis = line.TaxBasis, NetAmount = line.NetAmount,
                DiscountAmount = line.DiscountAmount, TaxAmount = line.TaxAmount,
                GrossAmount = line.GrossAmount, TaxCapturedAt = line.TaxCapturedAt,
                ParentLineNumber = line.ParentLineId is { } parent ? lineNumbers[parent] : null,
                Reason = line.Kind == Elevant.Domain.Enumerations.PreinvoiceLineKind.Service ? null : line.AdjustmentReason,
                CreatedAt = now, UpdatedAt = now,
            });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName, Action = "finance.invoice.non_fiscal.issued",
            EntityType = nameof(NonFiscalInvoice), EntityPublicId = invoiceId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId,
            Source = AuditSource.Api, CorrelationId = command.RequestId,
            RequestId = command.RequestId.ToString("D"),
            Reason = "Finance issued a non-fiscal invoice from an accepted frozen preinvoice.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, scope.PublicId, now, "finance_preinvoices", cancellationToken);
        await AirlineOperationChangeWriter.AddPreinvoiceAsync(context,
            scope.AirlineOrganizationId, scope.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return IssueFinanceInvoiceResult.Success(invoiceId, invoice.Number, false);
    }

    private async Task<IssueFinanceInvoiceResult> ReplayOrConflictAsync(
        IssueFinanceInvoiceCommand command, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.preinvoices.issue") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Forbidden);
        var now = timeProvider.GetUtcNow();
        var prior = await (
            from invoice in context.NonFiscalInvoices.AsNoTracking()
            join preinvoice in context.Preinvoices.AsNoTracking()
                on invoice.PreinvoiceId equals preinvoice.Id
            join station in context.Stations.AsNoTracking()
                on preinvoice.StationId equals station.Id
            join account in context.Users.AsNoTracking()
                on invoice.IssuedByAccountId equals account.Id
            where invoice.RequestId == command.RequestId &&
                  preinvoice.PublicId == command.PreinvoiceId &&
                  account.PublicId == command.AccountId &&
                  actor.StationScopes.Select(scope => scope.StationId).Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { invoice.PublicId, invoice.Number })
            .SingleOrDefaultAsync(cancellationToken);
        return prior is null
            ? IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict)
            : IssueFinanceInvoiceResult.Success(prior.PublicId, prior.Number, true);
    }

    private static bool IsUniquenessConflict(Exception exception) =>
        exception is SqlException sql && IsUniquenessConflict(sql.Number);

    internal static bool IsUniquenessConflict(int sqlNumber) => sqlNumber is 2601 or 2627;
}
