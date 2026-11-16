namespace Elevant.Application.Abstractions.Identity;

/// <summary>Changes an authenticated account password and clears its activation gate atomically.</summary>
public interface IPasswordChangeStore
{
    Task<PasswordChangeOutcome> ChangeAsync(
        Guid accountId,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken = default);
}

public enum PasswordChangeOutcome
{
    Succeeded,
    InvalidCredentials,
    RejectedNewPassword,
}
