using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfHumanResourcesPermitWriteStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesPermitWriteStore
{
    public async Task<HumanResourcesPermitWriteResult> RecordAsync(Guid actorId,
        Guid permitId, RecordHumanResourcesPermitInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
                role.Code is "GESTION_HUMANA" or "SUPERADMIN") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return HumanResourcesPermitWriteResult.Failed(
                HumanResourcesPermitWriteFailure.Forbidden);

        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        if (permitId == Guid.Empty || input is null || !Valid(input, today))
            return HumanResourcesPermitWriteResult.Failed(
                HumanResourcesPermitWriteFailure.Invalid);

        var actorDatabaseId = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);
        var documentType = Enum.Parse<PermitDocumentType>(input.DocumentType);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);

                var existing = await context.AirportPermitCycles.AsNoTracking()
                    .SingleOrDefaultAsync(cycle => cycle.PublicId == permitId,
                        cancellationToken);
                if (existing is not null)
                    return await ReplayAsync(existing, actorDatabaseId, input,
                        cancellationToken);

                var agent = await context.RampAgents.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.RampProfileId,
                        cancellationToken);
                if (agent is null)
                    return HumanResourcesPermitWriteResult.Failed(
                        HumanResourcesPermitWriteFailure.NotFound);
                if (!agent.IsActive)
                    return HumanResourcesPermitWriteResult.Failed(
                        HumanResourcesPermitWriteFailure.Conflict);

                var current = await context.AirportPermitCycles.SingleOrDefaultAsync(cycle =>
                    cycle.RampAgentId == agent.Id &&
                    cycle.DocumentType == documentType && cycle.IsCurrent,
                    cancellationToken);
                if (current?.PublicId != input.ExpectedCurrentId)
                    return HumanResourcesPermitWriteResult.Failed(
                        HumanResourcesPermitWriteFailure.Conflict);

                if (current is not null)
                {
                    current.IsCurrent = false;
                    current.UpdatedAt = now;
                    await context.SaveChangesAsync(cancellationToken);
                }

                var cycle = new AirportPermitCycle
                {
                    PublicId = permitId,
                    CreatedAt = now,
                    UpdatedAt = now,
                    RampAgentId = agent.Id,
                    DocumentType = documentType,
                    CycleNumber = (current?.CycleNumber ?? 0) + 1,
                    DocumentNumber = input.DocumentNumber.Trim(),
                    IssuedOn = input.IssuedOn,
                    ExpiresOn = input.ExpiresOn,
                    SupersedesPermitId = current?.Id,
                    IsCurrent = true,
                };
                context.AirportPermitCycles.Add(cycle);
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(),
                    OccurredAt = now,
                    ActorType = AuditActorType.Account,
                    ActorAccountId = actorDatabaseId,
                    Source = AuditSource.Api,
                    CorrelationId = permitId,
                    Action = "hr.permit.recorded",
                    EntityType = "hr.airport_permit_cycles",
                    EntityPublicId = permitId,
                });
                var recipients = await (from link in context.Set<IdentityUserRole<long>>()
                    join role in context.Roles on link.RoleId equals role.Id
                    where role.NormalizedName == "SUPERADMIN" ||
                          role.NormalizedName == "GESTION_HUMANA"
                    select link.UserId).Distinct().ToArrayAsync(cancellationToken);
                foreach (var recipient in recipients)
                    AccountChangeOutboxWriter.Add(context, recipient, null,
                        "hr_permits", permitId, now);
                await OccPlanningChangeWriter.AddForAgentAsync(context, agent.Id,
                    today, DateOnly.MaxValue, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesPermitWriteResult.Success(permitId,
                    cycle.CycleNumber);
            });
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            var existing = await context.AirportPermitCycles.AsNoTracking()
                .SingleOrDefaultAsync(cycle => cycle.PublicId == permitId,
                    cancellationToken);
            return existing is null
                ? HumanResourcesPermitWriteResult.Failed(
                    HumanResourcesPermitWriteFailure.Conflict)
                : await ReplayAsync(existing, actorDatabaseId, input,
                    cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return HumanResourcesPermitWriteResult.Failed(
                HumanResourcesPermitWriteFailure.Conflict);
        }
    }

    private async Task<HumanResourcesPermitWriteResult> ReplayAsync(
        AirportPermitCycle existing, long actorDatabaseId,
        RecordHumanResourcesPermitInput input, CancellationToken cancellationToken)
    {
        var auditMatches = await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
            entry.Action == "hr.permit.recorded" &&
            entry.EntityPublicId == existing.PublicId &&
            entry.ActorAccountId == actorDatabaseId &&
            entry.CorrelationId == existing.PublicId, cancellationToken);
        var agentMatches = await context.RampAgents.AsNoTracking().AnyAsync(agent =>
            agent.Id == existing.RampAgentId && agent.PublicId == input.RampProfileId,
            cancellationToken);
        var previousPublicId = existing.SupersedesPermitId is null ? null :
            await context.AirportPermitCycles.AsNoTracking()
                .Where(cycle => cycle.Id == existing.SupersedesPermitId.Value)
                .Select(cycle => (Guid?)cycle.PublicId)
                .SingleOrDefaultAsync(cancellationToken);
        return auditMatches && agentMatches &&
               existing.DocumentType.ToString() == input.DocumentType &&
               previousPublicId == input.ExpectedCurrentId &&
               existing.DocumentNumber == input.DocumentNumber.Trim() &&
               existing.IssuedOn == input.IssuedOn &&
               existing.ExpiresOn == input.ExpiresOn
            ? HumanResourcesPermitWriteResult.Success(existing.PublicId,
                existing.CycleNumber)
            : HumanResourcesPermitWriteResult.Failed(
                HumanResourcesPermitWriteFailure.Conflict);
    }

    private static bool Valid(RecordHumanResourcesPermitInput input, DateOnly today) =>
        input.RampProfileId != Guid.Empty &&
        (input.DocumentType is nameof(PermitDocumentType.AirportId) or
            nameof(PermitDocumentType.RampDriverLicense)) &&
        input.ExpectedCurrentId != Guid.Empty &&
        !string.IsNullOrWhiteSpace(input.DocumentNumber) &&
        input.DocumentNumber.Trim().Length is >= 2 and <= 64 &&
        input.IssuedOn != default && input.IssuedOn <= today &&
        input.ExpiresOn >= input.IssuedOn;
}
