namespace Elevant.Application.Abstractions.Identity;

/// <summary>Reads the current credential version of an account eligible for sessions.</summary>
public interface ISessionSecurityVersionStore
{
    Task<string?> GetCurrentAsync(Guid accountId, CancellationToken cancellationToken = default);
}
