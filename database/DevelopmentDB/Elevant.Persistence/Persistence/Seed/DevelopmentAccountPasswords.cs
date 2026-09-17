namespace Elevant.Infrastructure.Persistence.Seed;

/// <summary>Distinct deployment secrets for the four synthetic Development actors.</summary>
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
        string airlineClient,
        string humanResources)
    {
        AdminOcc = Validate(adminOcc, nameof(adminOcc));
        RampAgent = Validate(rampAgent, nameof(rampAgent));
        AirlineClient = Validate(airlineClient, nameof(airlineClient));
        HumanResources = Validate(humanResources, nameof(humanResources));

        if (new HashSet<string>(StringComparer.Ordinal)
            {
                AdminOcc,
                RampAgent,
                AirlineClient,
                HumanResources,
            }.Count != 4)
        {
            throw new InvalidOperationException(
                "Synthetic Development accounts must use four distinct passwords.");
        }
    }

    public string AdminOcc { get; }

    public string RampAgent { get; }

    public string AirlineClient { get; }

    public string HumanResources { get; }

    public override string ToString() =>
        $"{nameof(DevelopmentAccountPasswords)} {{ AdminOcc = [REDACTED], RampAgent = [REDACTED], AirlineClient = [REDACTED], HumanResources = [REDACTED] }}";

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
