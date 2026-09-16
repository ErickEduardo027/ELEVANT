namespace Elevant.Infrastructure.Persistence.Seed;

/// <summary>Distinct deployment secrets for the three synthetic Development actors.</summary>
public sealed class DevelopmentAccountPasswords
{
    public const int MinimumLength = 14;
    public const int MaximumLength = 256;

    private static readonly string[] PlaceholderMarkers =
    [
        "REPLACE_ME",
        "REPLACE_WITH",
        "CHANGE_ME",
        "CHANGEME",
        "PLACEHOLDER",
    ];

    public DevelopmentAccountPasswords(
        string adminOcc,
        string rampAgent,
        string airlineClient)
    {
        AdminOcc = Validate(adminOcc, nameof(adminOcc));
        RampAgent = Validate(rampAgent, nameof(rampAgent));
        AirlineClient = Validate(airlineClient, nameof(airlineClient));

        if (string.Equals(AdminOcc, RampAgent, StringComparison.Ordinal) ||
            string.Equals(AdminOcc, AirlineClient, StringComparison.Ordinal) ||
            string.Equals(RampAgent, AirlineClient, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Synthetic Development accounts must use three distinct passwords.");
        }
    }

    public string AdminOcc { get; }

    public string RampAgent { get; }

    public string AirlineClient { get; }

    public override string ToString() =>
        $"{nameof(DevelopmentAccountPasswords)} {{ AdminOcc = [REDACTED], RampAgent = [REDACTED], AirlineClient = [REDACTED] }}";

    private static string Validate(string password, string parameterName)
    {
        ArgumentNullException.ThrowIfNull(password, parameterName);

        if (password.Length is < MinimumLength or > MaximumLength ||
            !password.Any(char.IsUpper) ||
            !password.Any(char.IsLower) ||
            !password.Any(char.IsDigit) ||
            !password.Any(character => !char.IsLetterOrDigit(character)))
        {
            throw new InvalidOperationException(
                $"Each synthetic Development account password must contain {MinimumLength}-{MaximumLength} characters, including uppercase, lowercase, digit, and non-alphanumeric characters.");
        }

        if (PlaceholderMarkers.Any(marker => password.Contains(marker, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException(
                "Synthetic Development account passwords must not contain deployment placeholder text.");
        }

        return password;
    }
}
