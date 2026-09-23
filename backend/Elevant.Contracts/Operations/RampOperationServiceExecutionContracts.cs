using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TransitionRampOperationServiceRequest
{
    public TransitionRampOperationServiceRequest(
        string targetStatus,
        decimal? executedQuantity,
        string? note)
    {
        TargetStatus = targetStatus;
        ExecutedQuantity = executedQuantity;
        Note = note;
    }

    [Required(AllowEmptyStrings = false)]
    [RegularExpression("^(InProgress|Completed|NotPerformed|Exception)$")]
    public string TargetStatus { get; init; }

    public decimal? ExecutedQuantity { get; init; }

    [StringLength(1000)]
    public string? Note { get; init; }
}

public sealed record RampOperationServiceTransitionResponse(
    Guid ReceiptId,
    RampOperationServiceExecutionResponse Service);

public sealed record RampOperationServiceExecutionResponse(
    Guid Id,
    string Status,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit);
