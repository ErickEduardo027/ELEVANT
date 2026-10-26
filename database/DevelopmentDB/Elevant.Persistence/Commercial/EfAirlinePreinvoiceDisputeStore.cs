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

/// <summary>Records the airline's disputed line selection and publishes a durable change.</summary>
internal sealed class EfAirlinePreinvoiceDisputeStore(
    ElevantDbContext context, TimeProvider timeProvider) : IAirlinePreinvoiceDisputeStore
{
    private const string AuditAction = "airline.preinvoice.disputed";

    public async Task<DisputeAirlinePreinvoiceResult> DisputeAsync(
        DisputeAirlinePreinvoiceCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var strategy = context.Database.CreateExecutionStrategy();
        DisputeAirlinePreinvoiceResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await DisputeInsideTransactionAsync(command, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess) return attempt is not null;
                    return await context.PreinvoiceDisputes.AsNoTracking().AnyAsync(item =>
                        item.PublicId == attempt.DisputeId &&
                        item.RequestId == command.RequestId &&
                        item.PayloadHash == command.PayloadHash &&
                        context.Users.AsNoTracking().Any(account =>
                            account.PublicId == command.AccountId &&
                            account.Id == item.SubmittedByAccountId), token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateException exception) when (IsConcurrent(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsConcurrent(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Conflict);
        }
        catch (SqlException exception) when (IsConcurrent(exception))
        {
            context.ChangeTracker.Clear();
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Conflict);
        }
    }

    private async Task<DisputeAirlinePreinvoiceResult> DisputeInsideTransactionAsync(
        DisputeAirlinePreinvoiceCommand command, CancellationToken cancellationToken)
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
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Forbidden);

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
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.NotFound);

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == command.AccountId)
            .Select(account => account.Id).SingleAsync(cancellationToken);
        var prior = await context.PreinvoiceDisputes.AsNoTracking()
            .Where(item => item.RequestId == command.RequestId)
            .Select(item => new { item.PublicId, item.PreinvoiceId,
                item.SubmittedByAccountId, item.PayloadHash })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null)
            return prior.PreinvoiceId == scope.Id &&
                   prior.SubmittedByAccountId == accountId &&
                   prior.PayloadHash == command.PayloadHash
                ? DisputeAirlinePreinvoiceResult.Success(scope.PublicId, prior.PublicId, true)
                : DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Conflict);
        if (scope.Status != PreinvoiceStatus.Submitted)
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Conflict);

        var lines = await context.PreinvoiceLines.AsNoTracking()
            .Where(item => item.PreinvoiceId == scope.Id && !item.IsExcluded && command.LineIds.Contains(item.PublicId))
            .Select(item => item.Id).ToArrayAsync(cancellationToken);
        if (lines.Length != command.LineIds.Count)
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.InvalidRequest);

        var now = timeProvider.GetUtcNow();
        var changed = await context.Preinvoices
            .Where(item => item.Id == scope.Id && item.Status == PreinvoiceStatus.Submitted)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Status, PreinvoiceStatus.Disputed)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (changed != 1)
            return DisputeAirlinePreinvoiceResult.Failed(DisputeAirlinePreinvoiceFailure.Conflict);

        var dispute = new PreinvoiceDispute
        {
            PublicId = Guid.CreateVersion7(), PreinvoiceId = scope.Id,
            SubmittedByAccountId = accountId, RequestId = command.RequestId,
            PayloadHash = command.PayloadHash, Subject = command.Subject,
            Description = command.Description, CreatedAt = now, UpdatedAt = now,
        };
        context.PreinvoiceDisputes.Add(dispute);
        await context.SaveChangesAsync(cancellationToken);
        foreach (var lineId in lines)
            context.PreinvoiceDisputeLines.Add(new PreinvoiceDisputeLine
            {
                PublicId = Guid.CreateVersion7(), DisputeId = dispute.Id,
                PreinvoiceLineId = lineId, CreatedAt = now, UpdatedAt = now,
            });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName, Action = AuditAction,
            EntityType = nameof(Preinvoice), EntityPublicId = scope.PublicId,
            OrganizationId = scope.OrganizationId, StationId = scope.StationId,
            Source = AuditSource.Api, CorrelationId = command.RequestId,
            RequestId = command.RequestId.ToString("D"),
            Reason = "Airline disputed selected lines of the published non-fiscal preinvoice.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, scope.PublicId, now, "finance_preinvoices", cancellationToken);
        await DepartmentNotificationWriter.NotifyAsync(context, Department.Finance,
            "finance.preinvoices.read", "preinvoice_disputed", scope.PublicId,
            await context.Organizations.AsNoTracking().Where(organization => organization.Id == scope.OrganizationId)
                .Select(organization => (string?)organization.DisplayName).SingleOrDefaultAsync(cancellationToken),
            now, cancellationToken, stationId: scope.StationId);
        await AirlineOperationChangeWriter.AddPreinvoiceAsync(context,
            scope.OrganizationId, scope.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return DisputeAirlinePreinvoiceResult.Success(scope.PublicId, dispute.PublicId, false);
    }

    private static bool IsConcurrent(Exception exception) =>
        exception is SqlException sql && sql.Number is 2601 or 2627 or 1205 or 1222 or 3960;
}
