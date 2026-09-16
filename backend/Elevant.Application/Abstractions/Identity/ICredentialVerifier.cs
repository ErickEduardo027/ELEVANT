using Elevant.Application.Identity;

namespace Elevant.Application.Abstractions.Identity;

/// <summary>Verifies a development account credential without exposing identity-provider details.</summary>
public interface ICredentialVerifier
{
    /// <summary>
    /// Returns the verified public account identity, or <see langword="null"/> when the
    /// credentials must not be accepted.
    /// </summary>
    Task<VerifiedCredential?> VerifyAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default);
}
