using System.Linq.Expressions;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class IntegrationAuditConfiguration
{
    public static void ConfigureIntegrationAndAudit(this ModelBuilder modelBuilder)
    {
        ConfigureMobile(modelBuilder);
        ConfigureAudit(modelBuilder);
    }

    private static void ConfigureMobile(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MobileDevice>(builder =>
        {
            builder.ToTable("mobile_devices", "integration", table =>
                table.HasCheckConstraint("ck_mobile_device_revoked", "[revoked_at] IS NULL OR [revoked_at] >= [last_seen_at]"));
            builder.Property(device => device.Platform).HasConversion<string>().HasMaxLength(16);
            builder.Property(device => device.DeviceName).HasMaxLength(120);
            builder.Property(device => device.AppVersion).HasMaxLength(32).IsRequired();
            builder.Property(device => device.OperatingSystemVersion).HasMaxLength(64);
            builder.Property(device => device.LastSeenAt).HasPrecision(3);
            builder.Property(device => device.RevokedAt).HasPrecision(3);
            builder.HasIndex(device => device.InstallationId).IsUnique();
            builder.HasIndex(device => new { device.Platform, device.RevokedAt });
        });

        modelBuilder.Entity<MobileDeviceAccountBinding>(builder =>
        {
            builder.ToTable("mobile_device_account_bindings", "integration", table =>
                table.HasCheckConstraint("ck_device_binding_dates", "[unbound_at] IS NULL OR [unbound_at] >= [bound_at]"));
            builder.Property(binding => binding.Id).UseIdentityColumn();
            builder.Property(binding => binding.BoundAt).HasPrecision(3);
            builder.Property(binding => binding.UnboundAt).HasPrecision(3);
            builder.HasIndex(binding => binding.MobileDeviceId)
                .HasFilter("[unbound_at] IS NULL")
                .IsUnique();
            builder.HasIndex(binding => new { binding.MobileDeviceId, binding.AccountId, binding.BoundAt }).IsUnique();
            AddReference<MobileDevice, MobileDeviceAccountBinding>(builder, binding => binding.MobileDeviceId);
            AddReference<ApplicationUser, MobileDeviceAccountBinding>(builder, binding => binding.AccountId);
        });

        modelBuilder.Entity<MobileCommandReceipt>(builder =>
        {
            builder.ToTable("mobile_command_receipts", "integration", table =>
            {
                table.HasCheckConstraint("ck_mobile_command_hash", "LEN([payload_hash]) = 64");
                table.HasCheckConstraint("ck_mobile_command_processed", "[processed_at] IS NULL OR [processed_at] >= [received_at]");
                table.HasCheckConstraint("ck_mobile_command_expiry", "[expires_at] > [received_at]");
            });
            builder.Property(receipt => receipt.IdempotencyKey).HasMaxLength(128).IsRequired();
            builder.Property(receipt => receipt.CommandType).HasMaxLength(120).IsRequired();
            builder.Property(receipt => receipt.PayloadHash).HasColumnType("char(64)").IsRequired();
            builder.Property(receipt => receipt.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(receipt => receipt.ReceivedAt).HasPrecision(3);
            builder.Property(receipt => receipt.ProcessedAt).HasPrecision(3);
            builder.Property(receipt => receipt.ResultJson).HasColumnType("nvarchar(max)");
            builder.Property(receipt => receipt.ErrorCode).HasMaxLength(80);
            builder.Property(receipt => receipt.ErrorMessage).HasMaxLength(2000);
            builder.Property(receipt => receipt.ExpiresAt).HasPrecision(3);
            builder.HasIndex(receipt => new { receipt.MobileDeviceId, receipt.IdempotencyKey }).IsUnique();
            builder.HasIndex(receipt => new { receipt.AccountId, receipt.ClientBatchId });
            builder.HasIndex(receipt => new { receipt.Status, receipt.ReceivedAt });
            builder.HasIndex(receipt => receipt.ExpiresAt);
            AddReference<MobileDevice, MobileCommandReceipt>(builder, receipt => receipt.MobileDeviceId);
            AddReference<ApplicationUser, MobileCommandReceipt>(builder, receipt => receipt.AccountId);
        });
    }

    private static void ConfigureAudit(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AuditEntry>(builder =>
        {
            builder.ToTable("audit_entries", "audit");
            builder.Property(entry => entry.Id).UseIdentityColumn();
            builder.Property(entry => entry.PublicId).HasDefaultValueSql("NEWSEQUENTIALID()");
            builder.Property(entry => entry.OccurredAt).HasPrecision(3);
            builder.Property(entry => entry.ActorType).HasConversion<string>().HasMaxLength(16);
            builder.Property(entry => entry.ActorDisplay).HasMaxLength(200);
            builder.Property(entry => entry.Action).HasMaxLength(120).IsRequired();
            builder.Property(entry => entry.EntityType).HasMaxLength(160).IsRequired();
            builder.Property(entry => entry.Source).HasConversion<string>().HasMaxLength(24);
            builder.Property(entry => entry.RequestId).HasMaxLength(128);
            builder.Property(entry => entry.Reason).HasMaxLength(2000);
            builder.Property(entry => entry.MetadataJson).HasColumnType("nvarchar(max)");
            builder.HasIndex(entry => entry.PublicId).IsUnique();
            builder.HasIndex(entry => entry.CorrelationId);
            builder.HasIndex(entry => new { entry.EntityType, entry.EntityPublicId, entry.OccurredAt });
            builder.HasIndex(entry => new { entry.OrganizationId, entry.OccurredAt });
            builder.HasIndex(entry => new { entry.StationId, entry.OccurredAt });
            builder.HasIndex(entry => new { entry.ActorAccountId, entry.OccurredAt });
            AddReference<ApplicationUser, AuditEntry>(builder, entry => entry.ActorAccountId);
            AddReference<Organization, AuditEntry>(builder, entry => entry.OrganizationId);
            AddReference<Station, AuditEntry>(builder, entry => entry.StationId);
        });

        modelBuilder.Entity<AuditChange>(builder =>
        {
            builder.ToTable("audit_changes", "audit");
            builder.Property(change => change.Id).UseIdentityColumn();
            builder.Property(change => change.PropertyName).HasMaxLength(160).IsRequired();
            builder.Property(change => change.OldValue).HasColumnType("nvarchar(max)");
            builder.Property(change => change.NewValue).HasColumnType("nvarchar(max)");
            builder.HasIndex(change => change.AuditEntryId);
            AddReference<AuditEntry, AuditChange>(builder, change => change.AuditEntryId);
        });
    }

    private static void AddReference<TPrincipal, TDependent>(
        EntityTypeBuilder<TDependent> builder,
        Expression<Func<TDependent, object?>> foreignKey)
        where TPrincipal : class
        where TDependent : class
    {
        builder.HasOne<TPrincipal>()
            .WithMany()
            .HasForeignKey(foreignKey)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
