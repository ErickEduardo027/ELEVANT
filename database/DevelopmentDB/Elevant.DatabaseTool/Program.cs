using System.Globalization;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Microsoft.EntityFrameworkCore;

const string connectionVariable = "ConnectionStrings__ElevantDatabase";
const string adminPasswordVariable = "ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD";
const string rampPasswordVariable = "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD";
const string airlinePasswordVariable = "ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD";
const string humanResourcesPasswordVariable = "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD";
const string contractsPasswordVariable = "ELEVANT_DEV_CONTRACTS_ACCOUNT_PASSWORD";
const string financePasswordVariable = "ELEVANT_DEV_FINANCE_ACCOUNT_PASSWORD";
const string superAdminPasswordVariable = "ELEVANT_DEV_SUPERADMIN_ACCOUNT_PASSWORD";
const string scenarioDateVariable = "ELEVANT_DEV_SCENARIO_DATE";

if (args.Length != 1 || args[0] is not ("verify-target" or "seed-development" or
    "seed-development-scenario" or "rotate-development-human-resources"))
{
    Console.Error.WriteLine("Usage: Elevant.DatabaseTool <verify-target|seed-development|seed-development-scenario|rotate-development-human-resources>");
    return 2;
}

try
{
    var connectionString = Environment.GetEnvironmentVariable(connectionVariable)
        ?? throw new InvalidOperationException($"Set {connectionVariable}.");
    var environmentName = Environment.GetEnvironmentVariable(DatabaseTargetGuard.EnvironmentVariable);

    DatabaseTargetGuard.Validate(
        connectionString,
        environmentName,
        Environment.GetEnvironmentVariable(DatabaseTargetGuard.ProductionConfirmationVariable));

    var options = new DbContextOptionsBuilder<ElevantDbContext>()
        .UseSqlServer(connectionString, ElevantSqlServerOptions.Configure)
        .Options;

    await using var context = new ElevantDbContext(options);

    if (args[0] == "verify-target")
    {
        await DatabaseInstanceVerifier.RequireEnvironmentAsync(context, environmentName!);
        Console.WriteLine($"Verified Elevant {environmentName} database target.");
        return 0;
    }

    if (!string.Equals(environmentName, "Development", StringComparison.Ordinal))
    {
        throw new InvalidOperationException("The Development seeder is forbidden outside Development.");
    }

    if (args[0] == "seed-development-scenario")
    {
        var input = Environment.GetEnvironmentVariable(scenarioDateVariable);
        if (!DateOnly.TryParseExact(input, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var localDate) ||
            localDate < new DateOnly(2026, 1, 1) ||
            localDate > new DateOnly(2099, 12, 30))
            throw new InvalidOperationException(
                $"Set {scenarioDateVariable} to a valid local date (YYYY-MM-DD) within the synthetic contract period.");
        await new DevelopmentScenarioSeeder(context).SeedAsync(localDate);
        Console.WriteLine("Synthetic Development operational scenario is present.");
        return 0;
    }

    var passwords = new DevelopmentAccountPasswords(
        ReadSecret(adminPasswordVariable),
        ReadSecret(rampPasswordVariable),
        ReadSecret(airlinePasswordVariable),
        ReadSecret(humanResourcesPasswordVariable),
        ReadSecret(contractsPasswordVariable),
        ReadSecret(financePasswordVariable),
        args[0] == "seed-development" ? ReadSecret(superAdminPasswordVariable) : null);

    if (args[0] == "rotate-development-human-resources")
    {
        await new DevelopmentHumanResourcesCredentialRotator(context)
            .RotateAsync(passwords.HumanResources);
        Console.WriteLine("Synthetic Development HR credential rotated.");
        return 0;
    }

    await new DevelopmentDataSeeder(context).SeedAsync(passwords);
    Console.WriteLine("Synthetic Development fixtures are present.");
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Database tool failed: {exception.Message}");
    return 1;
}

static string ReadSecret(string variableName) =>
    Environment.GetEnvironmentVariable(variableName)
    ?? throw new InvalidOperationException($"Set {variableName} through the deployment secret store.");
