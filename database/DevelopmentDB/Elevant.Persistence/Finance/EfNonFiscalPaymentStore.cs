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

/// <summary>Records one full manual Development payment against one non-fiscal invoice.</summary>
internal sealed class EfNonFiscalPaymentStore(
    ElevantDbContext context, TimeProvider timeProvider) : INonFiscalPaymentStore
{
    public async Task<RecordNonFiscalPaymentResult> RecordAsync(
        RecordNonFiscalPaymentCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var strategy = context.Database.CreateExecutionStrategy();
        RecordNonFiscalPaymentResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await RecordInsideTransactionAsync(command, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess) return attempt is not null;
                    return await context.NonFiscalPayments.AsNoTracking().AnyAsync(item =>
                        item.PublicId == attempt.PaymentId &&
                        item.InvoiceId == context.NonFiscalInvoices.AsNoTracking()
                            .Where(invoice => invoice.PublicId == command.InvoiceId)
                            .Select(invoice => invoice.Id).Single() &&
                        item.RequestId == command.RequestId &&
                        item.Reference == command.Reference &&
                        context.Users.AsNoTracking().Any(account =>
                            account.Id == item.RecordedByAccountId &&
                            account.PublicId == command.AccountId), token);
                },
                IsolationLevel.Serializable, cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, cancellationToken);
        }
        catch (RetryLimitExceededException exception) when (IsUniqueViolation(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, cancellationToken);
        }
        catch (SqlException exception) when (IsUniqueViolation(exception))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, cancellationToken);
        }
    }

    private async Task<RecordNonFiscalPaymentResult> RecordInsideTransactionAsync(
        RecordNonFiscalPaymentCommand command, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Forbidden);

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from invoice in context.NonFiscalInvoices.AsNoTracking()
            join preinvoice in context.Preinvoices.AsNoTracking()
                on invoice.PreinvoiceId equals preinvoice.Id
            join station in context.Stations.AsNoTracking()
                on invoice.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on invoice.AirlineId equals airline.Id
            join organization in context.Organizations.AsNoTracking()
                on airline.OrganizationId equals organization.Id
            where invoice.PublicId == command.InvoiceId && station.IsActive &&
                  airline.IsActive && organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active &&
                  preinvoice.Status == PreinvoiceStatus.Invoiced &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == command.AccountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new { invoice.Id, invoice.PublicId, invoice.Total,
                invoice.CurrencyCode, invoice.PreinvoiceId, invoice.StationId,
                StationPublicId = station.PublicId,
                PreinvoicePublicId = preinvoice.PublicId,
                AirlineOrganizationId = organization.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null || !actor.StationScopes.Any(station =>
                station.StationId == scope.StationPublicId))
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.NotFound);
        if (scope.Total <= 0)
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Conflict);

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == command.AccountId)
            .Select(account => account.Id).SingleAsync(cancellationToken);
        var prior = await context.NonFiscalPayments.AsNoTracking()
            .Where(item => item.InvoiceId == scope.Id || item.RequestId == command.RequestId ||
                item.Reference == command.Reference)
            .Select(item => new { item.PublicId, item.InvoiceId, item.RequestId,
                item.RecordedByAccountId, item.Reference, item.Amount, item.CurrencyCode })
            .ToArrayAsync(cancellationToken);
        if (prior.Length > 0)
        {
            var exact = prior.Length == 1 && prior[0].InvoiceId == scope.Id &&
                prior[0].RequestId == command.RequestId &&
                prior[0].RecordedByAccountId == accountId &&
                prior[0].Reference == command.Reference;
            return exact
                ? RecordNonFiscalPaymentResult.Success(prior[0].PublicId,
                    prior[0].Reference, prior[0].Amount, prior[0].CurrencyCode, true)
                : RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Conflict);
        }

        var paymentId = Guid.CreateVersion7();
        context.NonFiscalPayments.Add(new NonFiscalPayment
        {
            PublicId = paymentId, InvoiceId = scope.Id,
            RecordedByAccountId = accountId, RequestId = command.RequestId,
            Reference = command.Reference, CurrencyCode = scope.CurrencyCode,
            Amount = scope.Total, CreatedAt = now, UpdatedAt = now,
        });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName,
            Action = "finance.payment.non_fiscal.recorded",
            EntityType = nameof(NonFiscalPayment), EntityPublicId = paymentId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId,
            Source = AuditSource.Api, CorrelationId = command.RequestId,
            RequestId = command.RequestId.ToString("D"),
            Reason = "Finance recorded a full manual Development payment; no external settlement was verified.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, scope.PreinvoicePublicId, now, "finance_preinvoices", cancellationToken);
        await AirlineOperationChangeWriter.AddPreinvoiceAsync(context,
            scope.AirlineOrganizationId, scope.PreinvoicePublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return RecordNonFiscalPaymentResult.Success(paymentId,
            command.Reference, scope.Total, scope.CurrencyCode, false);
    }

    private async Task<RecordNonFiscalPaymentResult> ReplayOrConflictAsync(
        RecordNonFiscalPaymentCommand command, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Forbidden);
        var now = timeProvider.GetUtcNow();
        var stationIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var prior = await (
            from payment in context.NonFiscalPayments.AsNoTracking()
            join invoice in context.NonFiscalInvoices.AsNoTracking()
                on payment.InvoiceId equals invoice.Id
            join station in context.Stations.AsNoTracking()
                on invoice.StationId equals station.Id
            join account in context.Users.AsNoTracking()
                on payment.RecordedByAccountId equals account.Id
            where payment.RequestId == command.RequestId &&
                  payment.Reference == command.Reference &&
                  invoice.PublicId == command.InvoiceId &&
                  account.PublicId == command.AccountId &&
                  stationIds.Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { payment.PublicId, payment.Reference,
                payment.Amount, payment.CurrencyCode })
            .SingleOrDefaultAsync(cancellationToken);
        return prior is null
            ? RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Conflict)
            : RecordNonFiscalPaymentResult.Success(prior.PublicId, prior.Reference,
                prior.Amount, prior.CurrencyCode, true);
    }

    private static bool IsUniqueViolation(Exception exception) =>
        exception is SqlException sql && sql.Number is 2601 or 2627;
}
