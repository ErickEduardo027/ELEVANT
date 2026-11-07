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
        // Permit dossier (phase 2, block B): a verification Contratos revoked (2-N09).
        "permit.review",
        // Master data and flight feed (phase 2, block C): stations, terminals, stands and aircraft types (2-A) and a
        // dismissed proposal OCC restored (2-N36).
        "station.name", "station.time_zone", "station.active",
        "terminal.code", "terminal.name", "terminal.active",
        "stand.code", "stand.terminal", "stand.bridge", "stand.remote", "stand.max_size", "stand.active",
        "aircraft_type.icao", "aircraft_type.iata", "aircraft_type.manufacturer", "aircraft_type.model",
        "aircraft_type.size", "aircraft_type.active",
        "flight_proposal.status",
        // Ramp staff (phase 2, block D): what the release path took off an agent (2-N06, 2-N08) and an approved
        // absence Gestión Humana cancelled or shortened (2-N22).
        "coverage.status", "assignment.status", "operation.status", "shift.status",
        "availability.status", "availability.ends_on",
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
