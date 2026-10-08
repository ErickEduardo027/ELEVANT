using System.Data;
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

    private async Task<IssueFinanceInvoiceResult> IssueInsideTransactionAsync(
        IssueFinanceInvoiceCommand command, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.preinvoices.manage") ||
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

        var lines = await context.PreinvoiceLines.AsNoTracking()
            .Where(line => line.PreinvoiceId == scope.Id)
            .OrderBy(line => line.LineNumber).ToArrayAsync(cancellationToken);
        if (lines.Length is < 1 or > 100 || lines.Any(line => line.ReleasedAt is not null) ||
            lines.Select(line => line.LineNumber).Distinct().Count() != lines.Length ||
            lines.Any(line => line.CurrencyCode != scope.CurrencyCode) ||
            lines.Sum(line => line.Amount) != scope.Total)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);

        var updated = await context.Preinvoices
            .Where(item => item.Id == scope.Id && item.Status == PreinvoiceStatus.Accepted)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Status, PreinvoiceStatus.Invoiced)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (updated != 1)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Conflict);

        var invoiceId = Guid.CreateVersion7();
        var invoice = new NonFiscalInvoice
        {
            PublicId = invoiceId, PreinvoiceId = scope.Id, AirlineId = scope.AirlineId,
            StationId = scope.StationId, IssuedByAccountId = accountId,
            RequestId = command.RequestId, Number = $"NF-{invoiceId:N}",
            CurrencyCode = scope.CurrencyCode, Total = scope.Total,
            CreatedAt = now, UpdatedAt = now,
        };
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
                Amount = line.Amount, CreatedAt = now, UpdatedAt = now,
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
            !actor.HasPermission("finance.preinvoices.manage") ||
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
