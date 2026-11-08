using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampIncidentPolicy
{
    /// <summary>A deviation from the normal process carries its IATA delay code (ADR-0031).</summary>
    public const string Deviation = "Deviation";

    public static bool IsValid(
        string? incidentType,
        IncidentSeverity severity,
        string? description,
        DateTimeOffset occurredAt,
        string? delayCode = null) =>
        incidentType is "Operational" or "Safety" or "Equipment" or "Documentation" or Deviation &&
        (incidentType == Deviation ? IataDelayCodes.IsKnown(delayCode) : delayCode is null) &&
        Enum.IsDefined(severity) &&
        description is not null &&
        description.Trim().Length is >= 8 and <= 2000 &&
        description.Length <= 2000 &&
        !description.Any(character => char.IsControl(character) &&
            character is not ('\t' or '\n' or '\r')) &&
        occurredAt != default &&
        occurredAt.Year >= 2000;

    /// <summary>
    /// Why an incident report is refused, or null: it belongs to a running operation and its time fits the window of
    /// the damages (3-N25, <see cref="RampEvidenceKind.Report"/>: a correction round takes it until now), with the
    /// clock tolerance on both ends; the store clamps it to the server's clock.
    /// </summary>
    public static string? ReportRejection(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt,
        DateTimeOffset occurredAt,
        RampEvidenceWindow window) =>
        !RampOperationExecutionPolicy.CanExecute(turnaroundStatus, operationStatus, actualStartAt, actualEndAt)
            ? RampProblemCodes.GenericConflict
            : RampEvidenceTimePolicy.CheckEvidence(occurredAt.ToUniversalTime(), window);

    public static bool CanReport(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt,
        DateTimeOffset occurredAt,
        RampEvidenceWindow window) =>
        ReportRejection(turnaroundStatus, operationStatus, actualStartAt, actualEndAt, occurredAt, window) is null;
}
