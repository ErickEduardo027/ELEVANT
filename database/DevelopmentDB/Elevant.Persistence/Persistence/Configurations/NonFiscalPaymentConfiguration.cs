using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class NonFiscalPaymentConfiguration
{
    public static void ConfigureNonFiscalPayments(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NonFiscalPayment>(builder =>
        {
            builder.ToTable("non_fiscal_payments", "commercial", table =>
            {
                table.HasCheckConstraint("ck_non_fiscal_payment_amount", "[amount] > 0");
                table.HasCheckConstraint("ck_non_fiscal_payment_currency",
                    "LEN([currency_code]) = 3");
                table.HasCheckConstraint("ck_non_fiscal_payment_reference",
                    "LEN([reference]) BETWEEN 8 AND 80");
                table.HasCheckConstraint("ck_non_fiscal_payment_request_id",
                    "[request_id] <> '00000000-0000-0000-0000-000000000000'");
            });
            builder.Property(item => item.Reference).HasMaxLength(80).IsRequired();
            builder.Property(item => item.CurrencyCode).HasColumnType("char(3)").IsRequired();
            builder.Property(item => item.Amount).HasPrecision(19, 4);
            builder.Property(item => item.Method).HasConversion<string>().HasMaxLength(16)
                .HasDefaultValue(Elevant.Domain.Enumerations.PaymentMethod.Transfer);
            builder.Property(item => item.PaidOn).HasColumnType("date");
            builder.HasIndex(item => item.InvoiceId);
            builder.HasIndex(item => item.RequestId).IsUnique();
            builder.HasIndex(item => item.Reference).IsUnique();
            builder.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(item => item.InvoiceId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.RecordedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}
