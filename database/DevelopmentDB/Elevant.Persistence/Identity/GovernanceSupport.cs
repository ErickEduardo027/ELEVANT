using System.Net.Mail;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Validation and audit helpers shared by the governance stores.</summary>
internal static class GovernanceSupport
{
    public static bool ValidName(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length is >= 2 and <= 100;

    public static bool ValidEmail(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= 256 &&
        MailAddress.TryCreate(value.Trim(), out var address) &&
        string.Equals(address.Address, value.Trim(), StringComparison.OrdinalIgnoreCase);

    public static async Task<bool> ValidAvatarAsync(ElevantDbContext context, string? url, string? currentUrl,
        CancellationToken cancellationToken)
    {
        if (url is null) return true;
        if (!url.StartsWith("/api/v1/media/", StringComparison.Ordinal) ||
            !Guid.TryParse(url["/api/v1/media/".Length..], out var id)) return false;
        var cutoff = CommercialMediaLinkPolicy.LinkCutoff(DateTimeOffset.UtcNow);
        return await context.MediaAssets.AnyAsync(asset => asset.PublicId == id &&
            asset.Purpose == "avatar" &&
            (asset.CreatedAt >= cutoff || url == currentUrl), cancellationToken);
    }

    public static string Version(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static void AddAudit(ElevantDbContext context, long actorAccountId, string action, string entityType,
        Guid entityId, string? reason, IReadOnlyCollection<long?> stationIds, DateTimeOffset occurredAt,
        params AuditFieldChangeData[] changes) =>
        AddAudit(context, actorAccountId, action, entityType, entityId, reason, stationIds, occurredAt, null, changes);

    /// <summary>Audit entry attributed to a department, so its administrators can read the activity.</summary>
    public static void AddAudit(ElevantDbContext context, long actorAccountId, string action, string entityType,
        Guid entityId, string? reason, IReadOnlyCollection<long?> stationIds, DateTimeOffset occurredAt,
        Department? department, params AuditFieldChangeData[] changes)
    {
        var correlationId = Guid.CreateVersion7();
        foreach (var stationId in stationIds.Count == 0 ? [null] : stationIds)
        {
            context.AuditEntries.Add(new AuditEntry
            {
                PublicId = Guid.CreateVersion7(),
                OccurredAt = occurredAt,
                ActorType = AuditActorType.Account,
                ActorAccountId = actorAccountId,
                Action = action,
                EntityType = entityType,
                EntityPublicId = entityId,
                StationId = stationId,
                Department = department,
                Source = AuditSource.Api,
                CorrelationId = correlationId,
                Reason = reason,
                MetadataJson = SafeAuditChanges.Serialize(changes),
            });
        }
    }
}
