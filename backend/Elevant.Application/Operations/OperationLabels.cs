using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// Spanish labels of the operational codes the server writes into OCC's reports and exports (3-N26): the same texts the
/// web shows (<c>operationLabels.js</c>, 3-N22) and the tablet's incident form uses. The JSON of the operations keeps
/// its codes; only what a person reads in a report is translated. A code this table does not know is written as it is.
/// </summary>
public static class OperationLabels
{
    private static readonly Dictionary<string, string> Units = new(StringComparer.OrdinalIgnoreCase)
    {
        ["operation"] = "Operación", ["aircraft"] = "Aeronave", ["passenger"] = "Pasajero", ["ton"] = "Tonelada",
        ["hour"] = "Hora", ["minute"] = "Minuto", ["unit"] = "Unidad", ["service"] = "Servicio", ["day"] = "Día",
    };

    /// <summary>State of a ground operation.</summary>
    public static string Status(GroundOperationStatus status) => status switch
    {
        GroundOperationStatus.Planned => "Planificada",
        GroundOperationStatus.Assigned => "Asignada",
        GroundOperationStatus.InProgress => "En curso",
        GroundOperationStatus.PendingReview => "Pendiente de revisión",
        GroundOperationStatus.InReview => "En revisión",
        GroundOperationStatus.Approved => "Aprobada",
        GroundOperationStatus.Returned => "Devuelta",
        GroundOperationStatus.Cancelled => "Cancelada",
        _ => status.ToString(),
    };

    /// <summary>Severity of an incident, capitalized as the tablet offers it («Alta»).</summary>
    public static string Severity(IncidentSeverity severity) => severity switch
    {
        IncidentSeverity.Low => "Baja",
        IncidentSeverity.Medium => "Media",
        IncidentSeverity.High => "Alta",
        IncidentSeverity.Critical => "Crítica",
        _ => severity.ToString(),
    };

    /// <summary>An incident as a report lists it: its type and, in lower case, its severity («Seguridad (alta)»).</summary>
    public static string Incident(string? type, IncidentSeverity severity)
    {
        var level = severity switch
        {
            IncidentSeverity.Low => "baja",
            IncidentSeverity.Medium => "media",
            IncidentSeverity.High => "alta",
            IncidentSeverity.Critical => "crítica",
            _ => severity.ToString(),
        };
        return $"{IncidentType(type)} ({level})";
    }

    /// <summary>
    /// Type of an incident (<see cref="RampIncidentPolicy"/>): the four of the tablet's form and the deviation of the
    /// Flight Report, which carries its IATA delay code (ADR-0031).
    /// </summary>
    public static string IncidentType(string? type)
    {
        var value = type?.Trim() ?? string.Empty;
        return value switch
        {
            "Operational" => "Operativa",
            "Safety" => "Seguridad",
            "Equipment" => "Equipo",
            "Documentation" => "Documentación",
            RampIncidentPolicy.Deviation => "Desviación",
            "" => "—",
            _ => value,
        };
    }

    /// <summary>
    /// The name of a billing unit when Finance's catalog (<c>ref.billing_units</c>) has no row for its code: the units
    /// every environment starts with, as the contract PDF and the airline portal name them.
    /// </summary>
    public static string BillingUnit(string? code)
    {
        var value = code?.Trim() ?? string.Empty;
        return value.Length == 0 ? "—" : Units.TryGetValue(value, out var name) ? name : value;
    }
}
