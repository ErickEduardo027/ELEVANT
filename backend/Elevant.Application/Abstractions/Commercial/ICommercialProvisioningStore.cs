namespace Elevant.Application.Abstractions.Commercial;

public sealed record ProvisioningTaskData(Guid RequestId, string Reference,
    string Airline, string RepresentativeName, string SuggestedEmail,
    Guid ContractId, DateTimeOffset ApprovedAt);
public sealed record ProvisionAirlineInput(string Email, string TemporaryPassword);
public enum ProvisioningFailure { Forbidden, NotFound, Conflict, Invalid }
public sealed record ProvisioningResult(Guid? AccountId, ProvisioningFailure? Failure)
{
    public bool IsSuccess => AccountId is not null;
    public static ProvisioningResult Success(Guid id) => new(id, null);
    public static ProvisioningResult Failed(ProvisioningFailure failure) => new(null, failure);
}
public interface ICommercialProvisioningStore
{
    Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId,
        ProvisionAirlineInput input, CancellationToken cancellationToken = default);
}
