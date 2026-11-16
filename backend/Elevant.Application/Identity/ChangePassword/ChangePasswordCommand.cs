namespace Elevant.Application.Identity.ChangePassword;

/// <summary>Secret-bearing request; diagnostic strings intentionally redact all values.</summary>
public sealed record ChangePasswordCommand(string Email, string CurrentPassword, string NewPassword)
{
    public override string ToString() =>
        $"{nameof(ChangePasswordCommand)} {{ Email = [REDACTED], CurrentPassword = [REDACTED], NewPassword = [REDACTED] }}";
}
