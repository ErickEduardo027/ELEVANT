using System.Text.Json;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Persistence.Audit;

internal static class SafeAuditChanges
{
    private static readonly HashSet<string> AllowedFields = new(StringComparer.Ordinal)
    {
        "role.name", "role.active", "role.permissions", "user.role", "user.status",
        "airline.country", "airline.iata", "airline.icao", "airline.logo", "airline.published",
        "airline.verified", "service.name", "service.public", "service.active",
        "rate.confirmed", "rate.price",
        // Portal accounts (phase 1, block E): the invitation a temporary password closed, the membership a link reactivated.
        "user.invitation", "membership.status",
        // Contract lifecycle (phase 2, block A): a version that started or stopped governing and a scheduled termination.
        "version.status", "version.valid_to", "contract.terminated_on",
    };

    public static string? Serialize(params AuditFieldChangeData[] changes)
    {
        var safe = changes.Where(change => AllowedFields.Contains(change.Field) &&
            change.Before != change.After).ToArray();
        return safe.Length == 0 ? null : JsonSerializer.Serialize(safe);
    }

    public static IReadOnlyList<AuditFieldChangeData> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<AuditFieldChangeData[]>(json)?
                .Where(change => AllowedFields.Contains(change.Field)).ToArray() ?? [];
        }
        catch (JsonException) { return []; }
    }
}
