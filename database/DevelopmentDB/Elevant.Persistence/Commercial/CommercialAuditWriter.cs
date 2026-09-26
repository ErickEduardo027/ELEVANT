using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;

namespace Elevant.Persistence.Commercial;

internal static class CommercialAuditWriter
{
    public static void Add(ElevantDbContext context, long actorDatabaseId,
        string action, string entityType, Guid entityId, string? reason = null) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = DateTimeOffset.UtcNow,
            ActorType = AuditActorType.Account, ActorAccountId = actorDatabaseId,
            Action = action, EntityType = entityType, EntityPublicId = entityId,
            Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            Reason = reason,
        });
}
