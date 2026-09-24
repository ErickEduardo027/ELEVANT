using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>Guards the irreversible handoff of an executed operation to OCC.</summary>
public static class RampOperationSubmissionPolicy
{
    public const int MaximumAgentNoteLength = 2000;

    public static bool HasValidNote(string? note) =>
        note is null ||
        (note.Trim().Length <= MaximumAgentNoteLength &&
         !note.Any(character =>
             (character < ' ' && character is not ('\n' or '\r' or '\t')) ||
             character == '\u007f'));

    public static bool CanSubmit(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt,
        ChecklistStatus checklistStatus,
        IReadOnlyCollection<ServiceExecutionStatus> serviceStatuses)
    {
        if (!RampOperationExecutionPolicy.CanExecute(
                turnaroundStatus, operationStatus, actualStartAt, actualEndAt) ||
            checklistStatus != ChecklistStatus.Submitted ||
            serviceStatuses.Count == 0)
        {
            return false;
        }

        return serviceStatuses.All(status => status is
            ServiceExecutionStatus.Completed or
            ServiceExecutionStatus.NotPerformed or
            ServiceExecutionStatus.Exception);
    }
}
