using System.ComponentModel.DataAnnotations;

namespace Elevant.Contracts.Identity;

/// <summary>Changes the password without creating a session from a temporary credential.</summary>
public sealed record ChangePasswordRequest
{
    public ChangePasswordRequest(string email, string currentPassword, string newPassword)
    {
        Email = email;
        CurrentPassword = currentPassword;
        NewPassword = newPassword;
    }

    [Required]
    [EmailAddress]
    [StringLength(SessionContractLimits.MaximumEmailLength, MinimumLength = 1)]
    public string Email { get; init; }

    [Required]
    [DataType(DataType.Password)]
    [StringLength(SessionContractLimits.MaximumPasswordLength, MinimumLength = 1)]
    public string CurrentPassword { get; init; }

    [Required]
    [DataType(DataType.Password)]
    [StringLength(SessionContractLimits.MaximumPasswordLength, MinimumLength = 14)]
    public string NewPassword { get; init; }

    public override string ToString() =>
        $"{nameof(ChangePasswordRequest)} {{ Email = [REDACTED], CurrentPassword = [REDACTED], NewPassword = [REDACTED] }}";
}
