using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class PreinvoiceConfiguration
{
    public static void ConfigurePreinvoices(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Preinvoice>(builder =>
        {
            builder.ToTable("preinvoices", "commercial", table =>
            {
                table.HasCheckConstraint("ck_preinvoice_dates", "[to] >= [from]");
                table.HasCheckConstraint("ck_preinvoice_total", "[total] >= 0");
                table.HasCheckConstraint("ck_preinvoice_currency", "LEN([currency_code]) = 3");
                table.HasCheckConstraint("ck_preinvoice_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
            });
            builder.Property(item => item.From).HasColumnType("date");
            builder.Property(item => item.To).HasColumnType("date");
            builder.Property(item => item.CurrencyCode).HasColumnType("char(3)").IsRequired();
            builder.Property(item => item.Total).HasPrecision(19, 4);
            builder.Property(item => item.PayloadHash).HasMaxLength(64).IsRequired();
            builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            builder.HasIndex(item => item.RequestId).IsUnique();
            builder.HasIndex(item => new { item.AirlineId, item.StationId, item.Status, item.From });
            builder.HasOne<Airline>().WithMany().HasForeignKey(item => item.AirlineId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>().WithMany().HasForeignKey(item => item.StationId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.CreatedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PreinvoiceLine>(builder =>
        {
            builder.ToTable("preinvoice_lines", "commercial", table =>
            {
                table.HasCheckConstraint("ck_preinvoice_line_number", "[line_number] > 0");
                table.HasCheckConstraint("ck_preinvoice_line_quantity",
                    "[executed_quantity] > 0 OR ([kind] <> N'Service' AND [executed_quantity] >= 0)");
                table.HasCheckConstraint("ck_preinvoice_line_price",
                    "[unit_price] >= 0 AND ([kind] = N'Adjustment' OR [amount] >= 0)");
                table.HasCheckConstraint("ck_preinvoice_line_kind",
                    "([kind] = N'Service' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NULL) OR " +
                    "([kind] = N'Charge' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NOT NULL AND [parent_line_id] IS NOT NULL) OR " +
                    "([kind] = N'Adjustment' AND [charge_definition_id] IS NULL AND LEN([adjustment_reason]) >= 3)");
                table.HasCheckConstraint("ck_preinvoice_line_excluded", "[is_excluded] = 0 OR [amount] = 0");
                table.HasCheckConstraint("ck_preinvoice_line_currency", "LEN([currency_code]) = 3");
            });
            builder.Property(item => item.OperationCode).HasMaxLength(40).IsRequired();
            builder.Property(item => item.OperationDate).HasColumnType("date");
            builder.Property(item => item.ServiceCode).HasMaxLength(40).IsRequired();
            builder.Property(item => item.ServiceName).HasMaxLength(160).IsRequired();
            builder.Property(item => item.ExecutedQuantity).HasPrecision(18, 4);
            builder.Property(item => item.BillingUnit).HasMaxLength(32).IsRequired();
            builder.Property(item => item.UnitPrice).HasPrecision(19, 4);
            builder.Property(item => item.CurrencyCode).HasColumnType("char(3)").IsRequired();
            builder.Property(item => item.Amount).HasPrecision(19, 4);
            builder.Property(item => item.ReleasedAt).HasPrecision(3);
            builder.Property(item => item.Kind).HasConversion<string>().HasMaxLength(16)
                .HasDefaultValue(Elevant.Domain.Enumerations.PreinvoiceLineKind.Service);
            builder.Property(item => item.ComputedQuantity).HasPrecision(18, 4);
            builder.Property(item => item.ComputedAmount).HasPrecision(19, 4);
            builder.Property(item => item.AdjustmentReason).HasMaxLength(500);
            builder.Property(item => item.EditedAt).HasPrecision(3);
            builder.HasIndex(item => new { item.PreinvoiceId, item.LineNumber }).IsUnique();
            builder.HasIndex(item => item.OperationServiceId).IsUnique()
                .HasFilter("[released_at] IS NULL AND [kind] = N'Service'");
            builder.HasIndex(item => new { item.OperationServiceId, item.ChargeDefinitionId });
            builder.HasOne<PreinvoiceLine>().WithMany().HasForeignKey(item => item.ParentLineId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ChargeDefinition>().WithMany().HasForeignKey(item => item.ChargeDefinitionId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.EditedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Preinvoice>().WithMany().HasForeignKey(item => item.PreinvoiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<OperationService>().WithMany().HasForeignKey(item => item.OperationServiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<OperationSubmission>().WithMany().HasForeignKey(item => item.ApprovedSubmissionId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PreinvoiceDispute>(builder =>
        {
            builder.ToTable("preinvoice_disputes", "commercial", table =>
            {
                table.HasCheckConstraint("ck_preinvoice_dispute_request_id",
                    "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                table.HasCheckConstraint("ck_preinvoice_dispute_subject", "LEN([subject]) BETWEEN 1 AND 160");
                table.HasCheckConstraint("ck_preinvoice_dispute_description", "LEN([description]) BETWEEN 1 AND 1000");
            });
            builder.Property(item => item.PayloadHash).HasMaxLength(64).IsRequired();
            builder.Property(item => item.Subject).HasMaxLength(160).IsRequired();
            builder.Property(item => item.Description).HasMaxLength(1000).IsRequired();
            builder.HasIndex(item => item.RequestId).IsUnique();
            builder.HasIndex(item => new { item.PreinvoiceId, item.CreatedAt });
            builder.HasOne<Preinvoice>().WithMany().HasForeignKey(item => item.PreinvoiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.SubmittedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PreinvoiceDisputeLine>(builder =>
        {
            builder.ToTable("preinvoice_dispute_lines", "commercial");
            builder.HasIndex(item => new { item.DisputeId, item.PreinvoiceLineId }).IsUnique();
            builder.HasOne<PreinvoiceDispute>().WithMany().HasForeignKey(item => item.DisputeId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<PreinvoiceLine>().WithMany().HasForeignKey(item => item.PreinvoiceLineId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PreinvoiceDisputeResolution>(builder =>
        {
            builder.ToTable("preinvoice_dispute_resolutions", "commercial", table =>
            {
                table.HasCheckConstraint("ck_preinvoice_resolution_request_id",
                    "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                table.HasCheckConstraint("ck_preinvoice_resolution_decision",
                    "[decision] IN ('Maintain', 'Void')");
                table.HasCheckConstraint("ck_preinvoice_resolution_reason",
                    "LEN([reason]) BETWEEN 1 AND 1000");
            });
            builder.Property(item => item.PayloadHash).HasMaxLength(64).IsRequired();
            builder.Property(item => item.Decision).HasMaxLength(16).IsRequired();
            builder.Property(item => item.Reason).HasMaxLength(1000).IsRequired();
            builder.HasIndex(item => item.RequestId).IsUnique();
            builder.HasIndex(item => item.DisputeId).IsUnique();
            builder.HasOne<PreinvoiceDispute>().WithMany()
                .HasForeignKey(item => item.DisputeId).OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(item => item.ResolvedByAccountId).OnDelete(DeleteBehavior.NoAction);
        });
    }
}
