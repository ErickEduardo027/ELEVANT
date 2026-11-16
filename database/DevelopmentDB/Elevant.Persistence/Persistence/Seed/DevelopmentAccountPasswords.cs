namespace Elevant.Infrastructure.Persistence.Seed;

/// <summary>Distinct deployment secrets for the synthetic Development actors.</summary>
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
        string humanResources,
        string contracts,
        string finance,
        string? superAdministrator = null)
    {
        AdminOcc = ValidateSingle(adminOcc, nameof(adminOcc));
        RampAgent = ValidateSingle(rampAgent, nameof(rampAgent));
        AirlineClient = ValidateSingle(airlineClient, nameof(airlineClient));
        HumanResources = ValidateSingle(humanResources, nameof(humanResources));
        Contracts = ValidateSingle(contracts, nameof(contracts));
        Finance = ValidateSingle(finance, nameof(finance));
        SuperAdministrator = superAdministrator is null ? null :
            ValidateSingle(superAdministrator, nameof(superAdministrator));

        if (new HashSet<string>(StringComparer.Ordinal)
            {
                AdminOcc,
                RampAgent,
                AirlineClient,
                HumanResources,
                Contracts,
                Finance,
            }.Append(SuperAdministrator).Where(value => value is not null).Distinct(StringComparer.Ordinal).Count()
            != (SuperAdministrator is null ? 6 : 7))
        {
            throw new InvalidOperationException(
                "Synthetic Development accounts must use distinct passwords.");
        }
    }

    public string AdminOcc { get; }

    public string RampAgent { get; }

    public string AirlineClient { get; }

    public string HumanResources { get; }

    public string Contracts { get; }

    public string Finance { get; }

    public string? SuperAdministrator { get; }

    public override string ToString() =>
        $"{nameof(DevelopmentAccountPasswords)} {{ AdminOcc = [REDACTED], RampAgent = [REDACTED], AirlineClient = [REDACTED], HumanResources = [REDACTED], Contracts = [REDACTED], Finance = [REDACTED], SuperAdministrator = [REDACTED] }}";

    public static string ValidateSingle(string password, string parameterName = "password")
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
