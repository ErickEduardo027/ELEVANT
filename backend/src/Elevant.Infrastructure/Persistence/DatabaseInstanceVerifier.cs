using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence;

/// <summary>Validates the immutable marker provisioned outside the EF migration chain.</summary>
public static class DatabaseInstanceVerifier
{
    public static async Task<DatabaseInstance> RequireEnvironmentAsync(
        ElevantDbContext context,
        string expectedEnvironment,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        var markers = await context.DatabaseInstances
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        if (markers.Count != 1 || markers[0].Id != 1)
        {
            throw new InvalidOperationException(
                "The database must contain exactly one infra.database_instances marker with id=1.");
        }

        var marker = markers[0];
        if (!string.Equals(marker.EnvironmentName, expectedEnvironment, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Database environment marker is '{marker.EnvironmentName}', expected '{expectedEnvironment}'.");
        }

        return marker;
    }
}
