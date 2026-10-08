using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class NonFiscalInvoiceConfiguration
{
    public static void ConfigureNonFiscalInvoices(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NonFiscalInvoice>(builder =>
        {
            builder.ToTable("non_fiscal_invoices", "commercial", table =>
            {
                table.HasCheckConstraint("ck_non_fiscal_invoice_total", "[total] >= 0");
                table.HasCheckConstraint("ck_non_fiscal_invoice_currency", "LEN([currency_code]) = 3");
                table.HasCheckConstraint("ck_non_fiscal_invoice_number", "LEN([number]) = 35");
                table.HasCheckConstraint("ck_non_fiscal_invoice_request_id",
                    "[request_id] <> '00000000-0000-0000-0000-000000000000'");
            });
            builder.Property(item => item.Number).HasMaxLength(35).IsRequired();
            builder.Property(item => item.CurrencyCode).HasColumnType("char(3)").IsRequired();
            builder.Property(item => item.Total).HasPrecision(19, 4);
            builder.Property(item => item.DueDate).HasColumnType("date");
            builder.HasIndex(item => item.PreinvoiceId).IsUnique();
            builder.HasIndex(item => item.RequestId).IsUnique();
            builder.HasIndex(item => item.Number).IsUnique();
            builder.HasIndex(item => new { item.AirlineId, item.CreatedAt });
            builder.HasOne<Preinvoice>().WithMany().HasForeignKey(item => item.PreinvoiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Airline>().WithMany().HasForeignKey(item => item.AirlineId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>().WithMany().HasForeignKey(item => item.StationId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.IssuedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<NonFiscalInvoiceLine>(builder =>
        {
            builder.ToTable("non_fiscal_invoice_lines", "commercial", table =>
            {
                table.HasCheckConstraint("ck_non_fiscal_invoice_line_number", "[line_number] > 0");
                table.HasCheckConstraint("ck_non_fiscal_invoice_line_quantity", "[executed_quantity] > 0");
                table.HasCheckConstraint("ck_non_fiscal_invoice_line_price",
                    "[unit_price] >= 0 AND ([kind] = N'Adjustment' OR [amount] >= 0)");
                table.HasCheckConstraint("ck_non_fiscal_invoice_line_currency", "LEN([currency_code]) = 3");
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
            builder.Property(item => item.Kind).HasConversion<string>().HasMaxLength(16)
                .HasDefaultValue(Elevant.Domain.Enumerations.PreinvoiceLineKind.Service);
            builder.Property(item => item.Reason).HasMaxLength(500);
            builder.HasIndex(item => new { item.InvoiceId, item.LineNumber }).IsUnique();
            builder.HasIndex(item => item.PreinvoiceLineId).IsUnique();
            builder.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(item => item.InvoiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<PreinvoiceLine>().WithMany().HasForeignKey(item => item.PreinvoiceLineId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}
