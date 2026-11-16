namespace Elevant.Application.Abstractions.Commercial;

/// <summary>
/// An approved request waiting for its portal account; <c>Version</c> is the request rowversion,
/// the expected version of its provisioning commands.
/// </summary>
public sealed record ProvisioningTaskData(Guid RequestId, string Reference,
    string Airline, string RepresentativeName, string SuggestedEmail,
    Guid ContractId, DateTimeOffset ApprovedAt, string Version);

/// <summary>
/// Without a temporary password the account is invited by email to activate itself (ADR-0022).
/// <paramref name="ExpectedVersion"/> is the request version; it is optional while older clients
/// exist (expand) and required with an Idempotency-Key.
/// </summary>
public sealed record ProvisionAirlineInput(string Email, string? TemporaryPassword = null, string? ExpectedVersion = null)
{
    public override string ToString() => $"{nameof(ProvisionAirlineInput)} {{ TemporaryPassword = [REDACTED] }}";
}

/// <summary>Links the existing portal account that uses <paramref name="Email"/> to the request (1-N13).</summary>
public sealed record LinkProvisioningAccountInput(string Email, string ExpectedVersion);

/// <summary>The account version the superadministrator saw; optional while older clients exist (expand).</summary>
public sealed record ResendInvitationInput(string? ExpectedVersion = null);

public enum ProvisioningFailure { Forbidden, NotFound, Conflict, Invalid }
/// <summary>Result of a provisioning command; <paramref name="Code"/> is the Problem Details code of a failure.</summary>
public sealed record ProvisioningResult(Guid? AccountId, ProvisioningFailure? Failure, string? Code = null)
{
    public bool IsSuccess => AccountId is not null;
    public static ProvisioningResult Success(Guid id) => new(id, null);
    public static ProvisioningResult Failed(ProvisioningFailure failure, string? code = null) => new(null, failure, code);
}
/// <summary>
/// Portal accounts of approved requests (ADR-0022, 1-N13). Commands take an Idempotency-Key and the
/// expected version; the same key and body replay the first result.
/// </summary>
public interface ICommercialProvisioningStore
{
    Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    /// <summary>
    /// Creates the airline's portal account. An email that already has an account is refused with a
    /// code that says whether it can be linked instead (<c>email_has_account</c>).
    /// </summary>
    Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId,
        ProvisionAirlineInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);
    /// <summary>
    /// Completes the request with the existing portal account of the email: one of the same airline,
    /// or one without an airline, which joins it. Credentials are not touched.
    /// </summary>
    Task<ProvisioningResult> LinkAccountAsync(Guid actorId, Guid requestId, Guid idempotencyKey,
        LinkProvisioningAccountInput input, CancellationToken cancellationToken = default);
    /// <summary>Queues a new activation link for a portal account that has not activated yet; the earlier ones stop working.</summary>
    Task<ProvisioningResult> ResendInvitationAsync(Guid actorId, Guid accountId, ResendInvitationInput? input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);
}
