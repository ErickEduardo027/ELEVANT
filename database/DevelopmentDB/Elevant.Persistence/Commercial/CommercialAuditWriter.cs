using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Application.Abstractions.Identity;
using Elevant.Persistence.Audit;

namespace Elevant.Persistence.Commercial;

internal static class CommercialAuditWriter
{
    /// <summary>
    /// Audits a commercial change. A null <paramref name="actorDatabaseId"/> is the system: the hourly
    /// contract sweep closing the versions of a contract whose scheduled termination took effect (2-N14).
    /// </summary>
    public static void Add(ElevantDbContext context, long? actorDatabaseId,
        string action, string entityType, Guid entityId, string? reason = null,
        params AuditFieldChangeData[] changes) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = DateTimeOffset.UtcNow,
            ActorType = actorDatabaseId is null ? AuditActorType.System : AuditActorType.Account,
            ActorAccountId = actorDatabaseId, ActorDisplay = actorDatabaseId is null ? "Sistema" : null,
            Action = action, EntityType = entityType, EntityPublicId = entityId,
            Source = actorDatabaseId is null ? AuditSource.BackgroundJob : AuditSource.Api,
            CorrelationId = Guid.CreateVersion7(),
            Reason = reason,
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });
}
