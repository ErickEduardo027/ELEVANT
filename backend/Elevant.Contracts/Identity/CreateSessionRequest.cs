using System.ComponentModel.DataAnnotations;

namespace Elevant.Contracts.Identity;

/// <summary>Credentials used to create a Development session.</summary>
public sealed record CreateSessionRequest
{
    public CreateSessionRequest(string email, string password)
    {
        Email = email;
        this.Password = password;
    }

    [Required]
    [EmailAddress]
    [StringLength(SessionContractLimits.MaximumEmailLength, MinimumLength = 1)]
    public string Email { get; init; }

    [Required]
    [DataType(DataType.Password)]
    [StringLength(SessionContractLimits.MaximumPasswordLength, MinimumLength = 1)]
    public string Password { get; init; }

    /// <summary>Returns a diagnostic representation that never includes credentials.</summary>
    public override string ToString() =>
        $"{nameof(CreateSessionRequest)} {{ Email = [REDACTED], Password = [REDACTED] }}";
}

/// <summary>Public input limits enforced before password verification.</summary>
public static class SessionContractLimits
{
    public const int MaximumEmailLength = 256;

    public const int MaximumPasswordLength = 256;
}
