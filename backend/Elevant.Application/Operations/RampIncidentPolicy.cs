using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampIncidentPolicy
{
    public static bool IsValid(
        string? incidentType,
        IncidentSeverity severity,
        string? description,
        DateTimeOffset occurredAt) =>
        incidentType is "Operational" or "Safety" or "Equipment" or "Documentation" &&
        Enum.IsDefined(severity) &&
        description is not null &&
        description.Trim().Length is >= 8 and <= 2000 &&
        description.Length <= 2000 &&
        !description.Any(character => char.IsControl(character) &&
            character is not ('\t' or '\n' or '\r')) &&
        occurredAt != default &&
        occurredAt.Year >= 2000;

    public static bool CanReport(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt,
        DateTimeOffset occurredAt,
        DateTimeOffset now) =>
        RampOperationExecutionPolicy.CanExecute(
            turnaroundStatus,
            operationStatus,
            actualStartAt,
            actualEndAt) &&
        occurredAt.ToUniversalTime() >= actualStartAt!.Value.ToUniversalTime() &&
        occurredAt.ToUniversalTime() <= now.ToUniversalTime();
}
