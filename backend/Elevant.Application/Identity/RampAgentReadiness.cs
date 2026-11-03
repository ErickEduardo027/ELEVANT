using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity;

/// <summary>Facts about one ramp agent, gathered from HR, identity and scopes (ADR-0026).</summary>
public sealed record RampAgentReadinessFacts(
    bool AgentActive,
    bool HasAccount,
    bool AccountActive,
    bool HasMobileRole,
    bool HasActiveMembership,
    IReadOnlyList<string> AgentStations,
    IReadOnlyList<string> AccountStations,
    int TerminalScopes,
    DateOnly? AirportIdExpiresOn,
    DateOnly? RampDriverLicenseExpiresOn,
    IReadOnlyList<(string EquipmentType, DateOnly ExpiresOn)> Qualifications,
    int ShiftsNextTwoWeeks,
    DateOnly? NextAbsenceStartsOn);

/// <summary>
/// The same rules OCC applies when it assigns an agent (<see cref="Operations.OccAgentEligibilityPolicy"/>),
/// read per agent instead of per flight, so HR sees what is missing before planning needs it.
/// Shifts and absences are informative: they depend on the day, not on the agent's file.
/// </summary>
public static class RampAgentReadiness
{
    public const int ExpiringDays = 30;

    public static RampAgentReadinessData Evaluate(Guid rampProfileId, string name, string employeeNumber,
        RampAgentReadinessFacts facts, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(facts);
        var items = new List<RampAgentReadinessItem>
        {
            new("agent_active", facts.AgentActive ? "Ok" : "Missing", facts.AgentActive ? null : "El perfil de rampa está inactivo."),
            new("mobile_account", !facts.HasAccount ? "Missing" : facts.AccountActive ? "Ok" : "Missing",
                !facts.HasAccount ? "No tiene cuenta para la tablet; solicita el acceso desde su perfil."
                : facts.AccountActive ? null : "La cuenta existe pero no está activa (invitación pendiente o bloqueada)."),
            new("mobile_role", facts.HasMobileRole ? "Ok" : "Missing",
                facts.HasMobileRole ? null : "La cuenta no tiene el rol Agente de rampa de la tablet."),
            new("membership", facts.HasActiveMembership ? "Ok" : "Missing",
                facts.HasActiveMembership ? null : "La cuenta no pertenece activamente al personal de AVIAM."),
        };

        var shared = facts.AgentStations.Intersect(facts.AccountStations, StringComparer.Ordinal).Order().ToArray();
        var withoutAccount = facts.AgentStations.Except(facts.AccountStations, StringComparer.Ordinal).Order().ToArray();
        items.Add(new("station_scope", shared.Length > 0 ? "Ok" : "Missing",
            shared.Length > 0
                ? "Estaciones: " + string.Join(", ", shared) + (withoutAccount.Length > 0 ? $" · sin acceso en la cuenta: {string.Join(", ", withoutAccount)}" : "")
                : facts.AgentStations.Count == 0 ? "Sin estación asignada en su perfil."
                : $"La cuenta no tiene acceso a {string.Join(", ", facts.AgentStations.Order())}."));
        items.Add(new("terminal_scope", facts.TerminalScopes > 0 ? "Ok" : "Missing",
            facts.TerminalScopes > 0 ? null : "Sin terminal asignada."));
        items.Add(Document("airport_id", facts.AirportIdExpiresOn, today, "Sin carnet aeroportuario vigente."));
        items.Add(Document("ramp_driver_license", facts.RampDriverLicenseExpiresOn, today, "Sin licencia de conducción en rampa vigente."));

        var current = facts.Qualifications.Where(item => item.ExpiresOn >= today).OrderBy(item => item.ExpiresOn).ToArray();
        items.Add(current.Length == 0
            ? new("qualifications", "Missing", "Sin habilitaciones vigentes.")
            : new("qualifications", current[0].ExpiresOn <= today.AddDays(ExpiringDays) ? "Expiring" : "Ok",
                string.Join(", ", current.Select(item => item.EquipmentType).Distinct().Order()), current[0].ExpiresOn));

        items.Add(new("upcoming_shifts", "Info", facts.ShiftsNextTwoWeeks == 0
            ? "Sin turnos en los próximos 14 días."
            : $"{facts.ShiftsNextTwoWeeks} turnos en los próximos 14 días."));
        if (facts.NextAbsenceStartsOn is { } absence)
            items.Add(new("approved_absence", "Info", $"Ausencia aprobada desde el {absence:dd/MM/yyyy}.", absence));

        var ready = items.All(item => item.Status is "Ok" or "Expiring" or "Info");
        return new RampAgentReadinessData(rampProfileId, name, employeeNumber, ready, items);
    }

    /// <summary>Current, expiring (within 30 days) or expired, for a document that ends on <paramref name="expiresOn"/>.</summary>
    public static string Validity(DateOnly expiresOn, DateOnly today) =>
        expiresOn < today ? "Expired" : expiresOn <= today.AddDays(ExpiringDays) ? "Expiring" : "Current";

    private static RampAgentReadinessItem Document(string key, DateOnly? expiresOn, DateOnly today, string missing) =>
        expiresOn is not { } end || end < today
            ? new(key, "Missing", missing)
            : new(key, end <= today.AddDays(ExpiringDays) ? "Expiring" : "Ok", $"Vence el {end:dd/MM/yyyy}.", end);
}
