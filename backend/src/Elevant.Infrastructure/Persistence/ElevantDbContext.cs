using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence;

/// <summary>EF Core boundary for Elevant-owned data.</summary>
public sealed class ElevantDbContext(DbContextOptions<ElevantDbContext> options)
    : DbContext(options)
{
    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ElevantDbContext).Assembly);
        base.OnModelCreating(modelBuilder);
    }
}
