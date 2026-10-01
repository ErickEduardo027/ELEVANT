using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Commercial;

/// <summary>Accepts a published preinvoice for exactly one live airline tenant.</summary>
internal sealed class EfAirlinePreinvoiceAcceptanceStore(
    ElevantDbContext context, TimeProvider timeProvider) : IAirlinePreinvoiceAcceptanceStore
{
    private const string AuditAction = "airline.preinvoice.accepted";

    public async Task<AcceptAirlinePreinvoiceResult> AcceptAsync(
        AcceptAirlinePreinvoiceCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var strategy = context.Database.CreateExecutionStrategy();
        AcceptAirlinePreinvoiceResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await AcceptInsideTransactionAsync(command, token);
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
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsConcurrent(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Conflict);
        }
        catch (SqlException exception) when (IsConcurrent(exception))
        {
            context.ChangeTracker.Clear();
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Conflict);
        }
    }

    private async Task<AcceptAirlinePreinvoiceResult> AcceptInsideTransactionAsync(
        AcceptAirlinePreinvoiceCommand command, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        var memberships = actor?.Memberships
            .Where(membership =>
                membership.OrganizationType == OrganizationType.AirlineCustomer &&
                membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.OrganizationId).Distinct().ToArray();
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "AIRLINE_CLIENT" &&
                role.Portal == PortalKind.AirlinePortal) ||
            memberships is not { Length: 1 } || memberships[0] != command.OrganizationId)
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Forbidden);

        var scope = await (
            from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            join item in context.Preinvoices.AsNoTracking()
                on airline.Id equals item.AirlineId
            where organization.PublicId == command.OrganizationId &&
                  organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive &&
                  item.PublicId == command.PreinvoiceId &&
                  (item.Status == PreinvoiceStatus.Submitted ||
                   item.Status == PreinvoiceStatus.Disputed ||
                   item.Status == PreinvoiceStatus.Accepted ||
                   item.Status == PreinvoiceStatus.Invoiced)
            select new { item.Id, item.PublicId, item.Status,
                item.StationId, OrganizationId = organization.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null)
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.NotFound);

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == command.AccountId)
            .Select(account => account.Id).SingleAsync(cancellationToken);
        var prior = await context.AuditEntries.AsNoTracking()
            .Where(audit => audit.Action == AuditAction &&
                audit.EntityPublicId == scope.PublicId)
            .Select(audit => new { audit.CorrelationId, audit.ActorAccountId })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope.Status != PreinvoiceStatus.Submitted)
        {
            if (prior?.CorrelationId == command.RequestId &&
                prior.ActorAccountId == accountId)
                return AcceptAirlinePreinvoiceResult.Success(scope.PublicId, true);
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Conflict);
        }
        if (prior is not null)
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Conflict);

        var now = timeProvider.GetUtcNow();
        var changed = await context.Preinvoices
            .Where(item => item.Id == scope.Id && item.Status == PreinvoiceStatus.Submitted)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Status, PreinvoiceStatus.Accepted)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (changed != 1)
            return AcceptAirlinePreinvoiceResult.Failed(AcceptAirlinePreinvoiceFailure.Conflict);

        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName, Action = AuditAction,
            EntityType = nameof(Preinvoice), EntityPublicId = scope.PublicId,
            OrganizationId = scope.OrganizationId, StationId = scope.StationId,
            Source = AuditSource.Api, CorrelationId = command.RequestId,
            RequestId = command.RequestId.ToString("D"),
            Reason = "Airline accepted the published non-fiscal preinvoice.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, scope.PublicId, now, "finance_preinvoices", cancellationToken);
        await AirlineOperationChangeWriter.AddPreinvoiceAsync(context,
            scope.OrganizationId, scope.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return AcceptAirlinePreinvoiceResult.Success(scope.PublicId, false);
    }

    private static bool IsConcurrent(Exception exception) =>
        exception is SqlException sql && sql.Number is 1205 or 1222 or 3960;
}
