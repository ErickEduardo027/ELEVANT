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

/// <summary>Publishes a frozen draft once, with audit and account changes in one transaction.</summary>
internal sealed class EfPreinvoiceSubmissionStore(
    ElevantDbContext context, TimeProvider timeProvider) : IPreinvoiceSubmissionStore
{
    private const string AuditAction = "finance.preinvoice.submitted";

    public async Task<SubmitPreinvoiceResult> SubmitAsync(
        SubmitPreinvoiceCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var strategy = context.Database.CreateExecutionStrategy();
        SubmitPreinvoiceResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await SubmitInsideTransactionAsync(command, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess) return attempt is not null;
                    return await context.AuditEntries.AsNoTracking().AnyAsync(audit =>
                        audit.Action == AuditAction &&
                        audit.EntityPublicId == command.PreinvoiceId &&
                        audit.CorrelationId == command.RequestId &&
                        context.Users.AsNoTracking().Any(account =>
                            account.PublicId == command.AccountId &&
                            account.Id == audit.ActorAccountId), token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateException exception) when (IsConcurrent(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsConcurrent(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Conflict);
        }
        catch (SqlException exception) when (IsConcurrent(exception))
        {
            context.ChangeTracker.Clear();
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Conflict);
        }
    }

    private async Task<SubmitPreinvoiceResult> SubmitInsideTransactionAsync(
        SubmitPreinvoiceCommand command, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Forbidden);

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
                  context.Users.AsNoTracking().Any(requester =>
                      requester.PublicId == command.AccountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == requester.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new { item.Id, item.PublicId, item.Status, StationId = station.Id,
                StationPublicId = station.PublicId,
                AirlineOrganizationId = organization.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null || !actor.StationScopes.Any(station =>
                station.StationId == scope.StationPublicId))
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.NotFound);

        var prior = await context.AuditEntries.AsNoTracking()
            .Where(audit => audit.Action == AuditAction &&
                audit.EntityPublicId == command.PreinvoiceId)
            .Select(audit => new { audit.CorrelationId, audit.ActorAccountId })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope.Status != PreinvoiceStatus.Draft)
        {
            if (prior?.CorrelationId == command.RequestId &&
                prior.ActorAccountId == await context.Users.AsNoTracking()
                    .Where(account => account.PublicId == command.AccountId)
                    .Select(account => (long?)account.Id).SingleAsync(cancellationToken))
                return SubmitPreinvoiceResult.Success(scope.PublicId, true);
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Conflict);
        }
        if (prior is not null ||
            !await context.PreinvoiceLines.AsNoTracking().AnyAsync(
                line => line.PreinvoiceId == scope.Id, cancellationToken))
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Conflict);

        var updated = await context.Preinvoices
            .Where(item => item.Id == scope.Id && item.Status == PreinvoiceStatus.Draft)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Status, PreinvoiceStatus.Submitted)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (updated != 1) return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Conflict);

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == command.AccountId)
            .Select(account => account.Id).SingleAsync(cancellationToken);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName, Action = AuditAction,
            EntityType = nameof(Preinvoice), EntityPublicId = scope.PublicId,
            OrganizationId = scope.AirlineOrganizationId,
            StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = command.RequestId, RequestId = command.RequestId.ToString("D"),
            Reason = "Finance published an immutable non-fiscal preinvoice for airline review.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, scope.PublicId, now, "finance_preinvoices", cancellationToken);
        await AirlineOperationChangeWriter.AddPreinvoiceAsync(context,
            scope.AirlineOrganizationId, scope.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return SubmitPreinvoiceResult.Success(scope.PublicId, false);
    }

    private static bool IsConcurrent(Exception exception) =>
        exception is SqlException sql && sql.Number is 1205 or 1222 or 3960;
}
