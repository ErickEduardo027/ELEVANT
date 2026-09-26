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
                table.HasCheckConstraint("ck_preinvoice_line_quantity", "[executed_quantity] > 0");
                table.HasCheckConstraint("ck_preinvoice_line_price", "[unit_price] >= 0 AND [amount] >= 0");
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
            builder.HasIndex(item => new { item.PreinvoiceId, item.LineNumber }).IsUnique();
            builder.HasIndex(item => item.OperationServiceId).IsUnique();
            builder.HasOne<Preinvoice>().WithMany().HasForeignKey(item => item.PreinvoiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<OperationService>().WithMany().HasForeignKey(item => item.OperationServiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<OperationSubmission>().WithMany().HasForeignKey(item => item.ApprovedSubmissionId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}
