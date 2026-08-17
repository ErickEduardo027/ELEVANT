using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Microsoft.EntityFrameworkCore;

const string connectionVariable = "ConnectionStrings__ElevantDatabase";
const string seedPasswordVariable = "ELEVANT_DEV_SEED_ACCOUNT_PASSWORD";

if (args.Length != 1 || args[0] is not ("verify-target" or "seed-development"))
{
    Console.Error.WriteLine("Usage: Elevant.DatabaseTool <verify-target|seed-development>");
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

    var password = Environment.GetEnvironmentVariable(seedPasswordVariable)
        ?? throw new InvalidOperationException($"Set {seedPasswordVariable} through the deployment secret store.");

    await new DevelopmentDataSeeder(context).SeedAsync(password);
    Console.WriteLine("Synthetic Development fixtures are present.");
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Database tool failed: {exception.Message}");
    return 1;
}
