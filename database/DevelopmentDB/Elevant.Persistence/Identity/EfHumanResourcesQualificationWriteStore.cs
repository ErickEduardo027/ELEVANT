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

internal sealed class EfHumanResourcesQualificationWriteStore(
    ElevantDbContext context, IActorContextResolver actors, TimeProvider clock)
    : IHumanResourcesQualificationWriteStore
{
    public async Task<HumanResourcesQualificationWriteResult> RecordAsync(Guid actorId,
        Guid qualificationId, RecordHumanResourcesQualificationInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        // The first cycle is «Crear»; a renewal (it names the current cycle) is «Modificar».
        if (actor?.HasPermission(input?.ExpectedCurrentId is null
                ? "human_resources.qualifications.create" : "human_resources.qualifications.update") != true ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return HumanResourcesQualificationWriteResult.Failed(
                HumanResourcesQualificationWriteFailure.Forbidden);

        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        if (qualificationId == Guid.Empty || input is null || !Valid(input, today))
            return HumanResourcesQualificationWriteResult.Failed(
                HumanResourcesQualificationWriteFailure.Invalid);

        var actorDatabaseId = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                // A previous attempt may have rolled back after SaveChanges accepted
                // IsCurrent=false into EF's tracker; reload SQL state for each retry.
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);

                var existing = await context.QualificationCycles.AsNoTracking()
                    .SingleOrDefaultAsync(cycle => cycle.PublicId == qualificationId,
                        cancellationToken);
                if (existing is not null)
                    return await ReplayAsync(existing, actorDatabaseId, input, cancellationToken);

                var agent = await context.RampAgents.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.RampProfileId,
                        cancellationToken);
                var equipment = await context.EquipmentTypes.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == input.EquipmentTypeId,
                        cancellationToken);
                if (agent is null || equipment is null)
                    return HumanResourcesQualificationWriteResult.Failed(
                        HumanResourcesQualificationWriteFailure.NotFound);
                if (!agent.IsActive || !equipment.IsActive || !equipment.RequiresQualification)
                    return HumanResourcesQualificationWriteResult.Failed(
                        HumanResourcesQualificationWriteFailure.Conflict);

                var current = await context.QualificationCycles.SingleOrDefaultAsync(cycle =>
                    cycle.RampAgentId == agent.Id && cycle.EquipmentTypeId == equipment.Id &&
                    cycle.IsCurrent, cancellationToken);
                if (current?.PublicId != input.ExpectedCurrentId)
                    return HumanResourcesQualificationWriteResult.Failed(
                        HumanResourcesQualificationWriteFailure.Conflict);

                if (current is not null)
                {
                    current.IsCurrent = false;
                    current.UpdatedAt = now;
                    // The filtered unique index permits only one current cycle at a time.
                    await context.SaveChangesAsync(cancellationToken);
                }

                var cycle = new QualificationCycle
                {
                    PublicId = qualificationId,
                    CreatedAt = now,
                    UpdatedAt = now,
                    RampAgentId = agent.Id,
                    EquipmentTypeId = equipment.Id,
                    CycleNumber = (current?.CycleNumber ?? 0) + 1,
                    TrainingDate = input.TrainingDate,
                    ObtainedOn = input.ObtainedOn,
                    ExpiresOn = input.ExpiresOn,
                    CertifyingEntity = input.CertifyingEntity.Trim(),
                    InstructorName = input.InstructorName.Trim(),
                    Notes = NormalizeNotes(input.Notes),
                    SupersedesQualificationId = current?.Id,
                    IsCurrent = true,
                };
                context.QualificationCycles.Add(cycle);
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = Guid.CreateVersion7(),
                    OccurredAt = now,
                    ActorType = AuditActorType.Account,
                    ActorAccountId = actorDatabaseId,
                    Source = AuditSource.Api,
                    CorrelationId = qualificationId,
                    Action = "hr.qualification.recorded",
                    EntityType = "hr.qualification_cycles",
                    EntityPublicId = qualificationId,
                });
                var recipients = await (from link in context.Set<IdentityUserRole<long>>()
                    join role in context.Roles on link.RoleId equals role.Id
                    where role.NormalizedName == "SUPERADMIN" ||
                          role.NormalizedName == "GESTION_HUMANA"
                    select link.UserId).Distinct().ToArrayAsync(cancellationToken);
                foreach (var recipient in recipients)
                    AccountChangeOutboxWriter.Add(context, recipient, null,
                        "hr_qualifications", qualificationId, now);
                await OccPlanningChangeWriter.AddForAgentAsync(context, agent.Id,
                    today, DateOnly.MaxValue, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return HumanResourcesQualificationWriteResult.Success(
                    qualificationId, cycle.CycleNumber);
            });
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            var existing = await context.QualificationCycles.AsNoTracking()
                .SingleOrDefaultAsync(cycle => cycle.PublicId == qualificationId,
                    cancellationToken);
            return existing is null
                ? HumanResourcesQualificationWriteResult.Failed(
                    HumanResourcesQualificationWriteFailure.Conflict)
                : await ReplayAsync(existing, actorDatabaseId, input, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return HumanResourcesQualificationWriteResult.Failed(
                HumanResourcesQualificationWriteFailure.Conflict);
        }
    }

    private async Task<HumanResourcesQualificationWriteResult> ReplayAsync(
        QualificationCycle existing, long actorDatabaseId,
        RecordHumanResourcesQualificationInput input, CancellationToken cancellationToken)
    {
        var auditMatches = await context.AuditEntries.AsNoTracking().AnyAsync(entry =>
            entry.Action == "hr.qualification.recorded" &&
            entry.EntityPublicId == existing.PublicId &&
            entry.ActorAccountId == actorDatabaseId &&
            entry.CorrelationId == existing.PublicId, cancellationToken);
        var agentMatches = await context.RampAgents.AsNoTracking().AnyAsync(agent =>
            agent.Id == existing.RampAgentId && agent.PublicId == input.RampProfileId,
            cancellationToken);
        var equipmentMatches = await context.EquipmentTypes.AsNoTracking().AnyAsync(equipment =>
            equipment.Id == existing.EquipmentTypeId &&
            equipment.PublicId == input.EquipmentTypeId, cancellationToken);
        var previousPublicId = existing.SupersedesQualificationId is null ? null :
            await context.QualificationCycles.AsNoTracking()
                .Where(cycle => cycle.Id == existing.SupersedesQualificationId.Value)
                .Select(cycle => (Guid?)cycle.PublicId).SingleOrDefaultAsync(cancellationToken);
        return auditMatches && agentMatches && equipmentMatches &&
               previousPublicId == input.ExpectedCurrentId &&
               existing.TrainingDate == input.TrainingDate &&
               existing.ObtainedOn == input.ObtainedOn &&
               existing.ExpiresOn == input.ExpiresOn &&
               existing.CertifyingEntity == input.CertifyingEntity.Trim() &&
               existing.InstructorName == input.InstructorName.Trim() &&
               existing.Notes == NormalizeNotes(input.Notes)
            ? HumanResourcesQualificationWriteResult.Success(existing.PublicId,
                existing.CycleNumber)
            : HumanResourcesQualificationWriteResult.Failed(
                HumanResourcesQualificationWriteFailure.Conflict);
    }

    private static bool Valid(RecordHumanResourcesQualificationInput input, DateOnly today) =>
        input.RampProfileId != Guid.Empty && input.EquipmentTypeId != Guid.Empty &&
        input.ExpectedCurrentId != Guid.Empty &&
        input.TrainingDate != default && input.TrainingDate <= input.ObtainedOn &&
        input.ObtainedOn <= today && input.ExpiresOn >= input.ObtainedOn &&
        !string.IsNullOrWhiteSpace(input.CertifyingEntity) &&
        input.CertifyingEntity.Trim().Length is >= 2 and <= 160 &&
        !string.IsNullOrWhiteSpace(input.InstructorName) &&
        input.InstructorName.Trim().Length is >= 2 and <= 160 &&
        (input.Notes is null || input.Notes.Trim().Length <= 1000);

    private static string? NormalizeNotes(string? notes) =>
        string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
}
