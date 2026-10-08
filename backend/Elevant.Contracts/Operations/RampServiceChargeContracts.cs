using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ApplyRampServiceChargeRequest(Guid ChargeId, string Action);

public sealed record RampChargeOptionResponse(Guid Id, string Code, string Name, string? Description, string Category,
    bool AllowMultiple);

public sealed record RampAppliedChargeResponse(Guid Id, Guid ChargeId, string Code, string Name, DateTimeOffset AppliedAt);

public sealed record RampServiceChargesResponse(Guid ServiceId, bool CanEdit,
    IReadOnlyList<RampChargeOptionResponse> Available, IReadOnlyList<RampAppliedChargeResponse> Applied);

public sealed record RampOperationChargesResponse(Guid OperationId, IReadOnlyList<RampServiceChargesResponse> Services);

public sealed record RampServiceChargeCommandResponse(Guid ReceiptId, RampServiceChargesResponse Service);
