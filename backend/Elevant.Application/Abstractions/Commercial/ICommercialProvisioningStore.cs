namespace Elevant.Application.Abstractions.Commercial;

public sealed record ProvisioningTaskData(Guid RequestId, string Reference,
    string Airline, string RepresentativeName, string SuggestedEmail,
    Guid ContractId, DateTimeOffset ApprovedAt);
/// <summary>Without a temporary password the account is invited by email to activate itself (ADR-0022).</summary>
public sealed record ProvisionAirlineInput(string Email, string? TemporaryPassword = null)
{
    public override string ToString() => $"{nameof(ProvisionAirlineInput)} {{ TemporaryPassword = [REDACTED] }}";
}
public enum ProvisioningFailure { Forbidden, NotFound, Conflict, Invalid }
/// <summary>Result of a provisioning command; <paramref name="Code"/> is the Problem Details code of a failure.</summary>
public sealed record ProvisioningResult(Guid? AccountId, ProvisioningFailure? Failure, string? Code = null)
{
    public bool IsSuccess => AccountId is not null;
    public static ProvisioningResult Success(Guid id) => new(id, null);
    public static ProvisioningResult Failed(ProvisioningFailure failure, string? code = null) => new(null, failure, code);
}
public interface ICommercialProvisioningStore
{
    Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId,
        ProvisionAirlineInput input, CancellationToken cancellationToken = default);
    /// <summary>Sends a new activation link to a portal account that has not activated yet.</summary>
    Task<ProvisioningResult> ResendInvitationAsync(Guid actorId, Guid accountId,
        CancellationToken cancellationToken = default);
}
