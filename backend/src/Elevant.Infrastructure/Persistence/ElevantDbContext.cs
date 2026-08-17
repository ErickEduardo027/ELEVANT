using Elevant.Domain.Entities.Infrastructure;
using Elevant.Infrastructure.Persistence.Configurations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence;

/// <summary>EF Core boundary for Elevant-owned data.</summary>
public sealed class ElevantDbContext(DbContextOptions<ElevantDbContext> options)
    : DbContext(options)
{
    public DbSet<DatabaseInstance> DatabaseInstances => Set<DatabaseInstance>();

    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);

        base.OnModelCreating(modelBuilder);
        modelBuilder.ConfigurePlatform();
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ElevantDbContext).Assembly);
        modelBuilder.ConfigureElevantConventions();
    }
}
