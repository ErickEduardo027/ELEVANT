using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity.ChangePassword;

/// <summary>Accepts only a valid existing credential before changing a password.</summary>
public sealed class ChangePasswordHandler(
    ICredentialVerifier credentialVerifier,
    IPasswordChangeStore passwordChangeStore)
{
    public async Task<PasswordChangeOutcome> HandleAsync(
        ChangePasswordCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (string.IsNullOrWhiteSpace(command.Email) || command.Email.Length > 256 ||
            string.IsNullOrWhiteSpace(command.CurrentPassword) || command.CurrentPassword.Length > 256 ||
            string.IsNullOrWhiteSpace(command.NewPassword) || command.NewPassword.Length > 256 ||
            string.Equals(command.CurrentPassword, command.NewPassword, StringComparison.Ordinal))
        {
            return PasswordChangeOutcome.InvalidCredentials;
        }

        var verified = await credentialVerifier.VerifyAsync(
            command.Email.Trim(), command.CurrentPassword, cancellationToken);
        if (verified is null || verified.AccountId == Guid.Empty)
        {
            return PasswordChangeOutcome.InvalidCredentials;
        }

        return await passwordChangeStore.ChangeAsync(
            verified.AccountId,
            command.CurrentPassword,
            command.NewPassword,
            cancellationToken);
    }
}
