using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

/// <summary>
/// One service transition from the tablet. <see cref="OccurredAt"/> is the moment the agent tapped it (3-I), sent later
/// from the offline queue; without it the server's time applies, as it did for the first version of the app.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TransitionRampOperationServiceRequest
{
    public TransitionRampOperationServiceRequest(
        string targetStatus,
        decimal? executedQuantity,
        string? note,
        DateTimeOffset? occurredAt = null)
    {
        TargetStatus = targetStatus;
        ExecutedQuantity = executedQuantity;
        Note = note;
        OccurredAt = occurredAt;
    }

    [Required(AllowEmptyStrings = false)]
    [RegularExpression("^(InProgress|Completed|NotPerformed|Exception)$")]
    public string TargetStatus { get; init; }

    public decimal? ExecutedQuantity { get; init; }

    [StringLength(1000)]
    public string? Note { get; init; }

    /// <summary>When the agent recorded the transition on the tablet; null records the server's time.</summary>
    public DateTimeOffset? OccurredAt { get; init; }
}

/// <summary>
/// «Iniciar» from the tablet (3-I). The body is optional: the first version of the app sends the command without one
/// and the server's time applies; a newer one sends the moment the agent tapped it, possibly from its offline queue.
/// </summary>
/// <param name="StartedAt">When the agent tapped «Iniciar»; null records the server's time.</param>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record StartRampOperationRequest(DateTimeOffset? StartedAt = null);

public sealed record RampOperationServiceTransitionResponse(
    Guid ReceiptId,
    RampOperationServiceExecutionResponse Service);

public sealed record RampOperationServiceExecutionResponse(
    Guid Id,
    string Status,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit);
