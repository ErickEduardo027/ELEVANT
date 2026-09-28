using System.Data;
using System.Security.Cryptography;
using System.Text;
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

/// <summary>Closes the latest airline objection without repricing historical lines.</summary>
internal sealed class EfPreinvoiceDisputeResolutionStore(
    ElevantDbContext context, TimeProvider timeProvider) : IPreinvoiceDisputeResolutionStore
{
    public async Task<ResolvePreinvoiceDisputeResult> ResolveAsync(
        ResolvePreinvoiceDisputeCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{command.Decision}\n{command.Reason}"))).ToLowerInvariant();
        var strategy = context.Database.CreateExecutionStrategy();
        ResolvePreinvoiceDisputeResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await ResolveInsideTransactionAsync(command, hash, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess) return attempt is not null;
                    return await context.PreinvoiceDisputeResolutions.AsNoTracking().AnyAsync(item =>
                        item.PublicId == attempt.ResolutionId && item.RequestId == command.RequestId &&
                        item.PayloadHash == hash &&
                        context.Users.AsNoTracking().Any(account =>
                            account.Id == item.ResolvedByAccountId &&
                            account.PublicId == command.AccountId), token);
                },
                IsolationLevel.Serializable, cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, hash, cancellationToken);
        }
        catch (RetryLimitExceededException exception) when (IsUniqueViolation(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, hash, cancellationToken);
        }
        catch (SqlException exception) when (IsUniqueViolation(exception))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(command, hash, cancellationToken);
        }
    }

    private async Task<ResolvePreinvoiceDisputeResult> ResolveInsideTransactionAsync(
        ResolvePreinvoiceDisputeCommand command, string hash, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Forbidden);

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from preinvoice in context.Preinvoices.AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on preinvoice.StationId equals station.Id
            join airline in context.Airlines.AsNoTracking()
                on preinvoice.AirlineId equals airline.Id
            join organization in context.Organizations.AsNoTracking()
                on airline.OrganizationId equals organization.Id
            where preinvoice.PublicId == command.PreinvoiceId && station.IsActive &&
                  airline.IsActive && organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == command.AccountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new { preinvoice.Id, preinvoice.PublicId, preinvoice.Status,
                preinvoice.StationId, StationPublicId = station.PublicId,
                AirlineOrganizationId = organization.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null || !actor.StationScopes.Any(station =>
                station.StationId == scope.StationPublicId))
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.NotFound);

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == command.AccountId)
            .Select(account => account.Id).SingleAsync(cancellationToken);
        var prior = await (
            from resolution in context.PreinvoiceDisputeResolutions.AsNoTracking()
            join resolvedDispute in context.PreinvoiceDisputes.AsNoTracking()
                on resolution.DisputeId equals resolvedDispute.Id
            where resolution.RequestId == command.RequestId
            select new { resolution.PublicId, resolution.PayloadHash,
                resolution.ResolvedByAccountId, resolution.Decision,
                resolvedDispute.PreinvoiceId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null)
            return prior.PreinvoiceId == scope.Id && prior.ResolvedByAccountId == accountId &&
                   prior.PayloadHash == hash
                ? ResolvePreinvoiceDisputeResult.Success(prior.PublicId, scope.PublicId,
                    prior.Decision == "Void" ? "Voided" : "Submitted", true)
                : ResolvePreinvoiceDisputeResult.Failed(
                    ResolvePreinvoiceDisputeFailure.Conflict);
        if (scope.Status != PreinvoiceStatus.Disputed)
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Conflict);

        var dispute = await context.PreinvoiceDisputes.AsNoTracking()
            .Where(item => item.PreinvoiceId == scope.Id)
            .OrderByDescending(item => item.Id)
            .Select(item => new { item.Id, item.PublicId })
            .FirstOrDefaultAsync(cancellationToken);
        if (dispute is null || await context.PreinvoiceDisputeResolutions.AsNoTracking()
                .AnyAsync(item => item.DisputeId == dispute.Id, cancellationToken))
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Conflict);

        var target = command.Decision == "Void" ? PreinvoiceStatus.Voided : PreinvoiceStatus.Submitted;
        var changed = await context.Preinvoices
            .Where(item => item.Id == scope.Id && item.Status == PreinvoiceStatus.Disputed)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Status, target)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (changed != 1)
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Conflict);
        if (target == PreinvoiceStatus.Voided)
        {
            var released = await context.PreinvoiceLines
                .Where(line => line.PreinvoiceId == scope.Id && line.ReleasedAt == null)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(line => line.ReleasedAt, now)
                    .SetProperty(line => line.UpdatedAt, now), cancellationToken);
            if (released == 0)
                throw new InvalidOperationException("A disputed preinvoice has no active service reservation.");
        }

        var resolutionId = Guid.CreateVersion7();
        context.PreinvoiceDisputeResolutions.Add(new PreinvoiceDisputeResolution
        {
            PublicId = resolutionId, DisputeId = dispute.Id,
            ResolvedByAccountId = accountId, RequestId = command.RequestId,
            PayloadHash = hash, Decision = command.Decision, Reason = command.Reason,
            CreatedAt = now, UpdatedAt = now,
        });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName,
            Action = target == PreinvoiceStatus.Voided
                ? "finance.preinvoice.dispute.voided" : "finance.preinvoice.dispute.maintained",
            EntityType = nameof(Preinvoice), EntityPublicId = scope.PublicId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId,
            Source = AuditSource.Api, CorrelationId = command.RequestId,
            RequestId = command.RequestId.ToString("D"), Reason = command.Reason,
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, scope.PublicId, now, "finance_preinvoices", cancellationToken);
        await AirlineOperationChangeWriter.AddPreinvoiceAsync(context,
            scope.AirlineOrganizationId, scope.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return ResolvePreinvoiceDisputeResult.Success(
            resolutionId, scope.PublicId, target.ToString(), false);
    }

    private async Task<ResolvePreinvoiceDisputeResult> ReplayOrConflictAsync(
        ResolvePreinvoiceDisputeCommand command, string hash, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(command.AccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Forbidden);
        var now = timeProvider.GetUtcNow();
        var stationIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var prior = await (
            from resolution in context.PreinvoiceDisputeResolutions.AsNoTracking()
            join dispute in context.PreinvoiceDisputes.AsNoTracking()
                on resolution.DisputeId equals dispute.Id
            join preinvoice in context.Preinvoices.AsNoTracking()
                on dispute.PreinvoiceId equals preinvoice.Id
            join station in context.Stations.AsNoTracking()
                on preinvoice.StationId equals station.Id
            join account in context.Users.AsNoTracking()
                on resolution.ResolvedByAccountId equals account.Id
            where resolution.RequestId == command.RequestId &&
                  resolution.PayloadHash == hash &&
                  preinvoice.PublicId == command.PreinvoiceId &&
                  account.PublicId == command.AccountId &&
                  stationIds.Contains(station.PublicId) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { ResolutionId = resolution.PublicId,
                PreinvoiceId = preinvoice.PublicId, resolution.Decision })
            .SingleOrDefaultAsync(cancellationToken);
        return prior is null
            ? ResolvePreinvoiceDisputeResult.Failed(ResolvePreinvoiceDisputeFailure.Conflict)
            : ResolvePreinvoiceDisputeResult.Success(prior.ResolutionId,
                prior.PreinvoiceId, prior.Decision == "Void" ? "Voided" : "Submitted", true);
    }

    private static bool IsUniqueViolation(Exception exception) =>
        exception is SqlException sql && sql.Number is 2601 or 2627;
}
