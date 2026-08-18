using Elevant.Domain.Entities.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class PlatformConfiguration
{
    public static void ConfigurePlatform(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DatabaseInstance>(builder =>
        {
            builder.ToTable("database_instances", "infra", table => table.ExcludeFromMigrations());
            builder.HasKey(instance => instance.Id);
            builder.Property(instance => instance.Id).ValueGeneratedNever();
            builder.Property(instance => instance.InstanceId).IsRequired();
            builder.Property(instance => instance.EnvironmentName).HasMaxLength(32).IsRequired();
            builder.Property(instance => instance.CreatedAt).HasPrecision(3).IsRequired();
        });

        modelBuilder.Entity<OutboxMessage>(builder =>
        {
            builder.ToTable("outbox_messages", "infra");
            builder.HasKey(message => message.Id);
            builder.Property(message => message.Id).UseIdentityColumn();
            builder.Property(message => message.PublicId).HasDefaultValueSql("NEWSEQUENTIALID()");
            builder.Property(message => message.OccurredAt).HasPrecision(3).IsRequired();
            builder.Property(message => message.EventType).HasMaxLength(300).IsRequired();
            builder.Property(message => message.PayloadJson).HasColumnType("nvarchar(max)").IsRequired();
            builder.Property(message => message.ProcessedAt).HasPrecision(3);
            builder.Property(message => message.LastError).HasMaxLength(2000);
            builder.HasIndex(message => message.PublicId).IsUnique();
            builder.HasIndex(message => new { message.ProcessedAt, message.OccurredAt });
        });
    }
}
