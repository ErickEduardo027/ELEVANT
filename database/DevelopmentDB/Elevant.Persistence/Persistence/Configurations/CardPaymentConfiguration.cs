using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

/// <summary>ADR-0036: simulated card payment attempts keep the brand and last four digits only.</summary>
internal static class CardPaymentConfiguration
{
    public static void ConfigureCardPayments(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CardPaymentAttempt>(builder =>
        {
            builder.ToTable("card_payment_attempts", "commercial", table =>
            {
                table.HasCheckConstraint("ck_card_payment_attempt_amount", "[amount] > 0");
                table.HasCheckConstraint("ck_card_payment_attempt_currency", "[currency_code] IN ('USD','DOP')");
                table.HasCheckConstraint("ck_card_payment_attempt_last4", "[last4] LIKE '[0-9][0-9][0-9][0-9]'");
                table.HasCheckConstraint("ck_card_payment_attempt_outcome",
                    "([status] = 'Approved' AND [authorization_code] IS NOT NULL AND [receipt_id] IS NOT NULL AND [decline_code] IS NULL) OR " +
                    "([status] IN ('Declined','Error') AND [authorization_code] IS NULL AND [receipt_id] IS NULL AND [decline_code] IS NOT NULL)");
            });
            builder.Property(item => item.RequestHash).HasColumnType("char(64)").IsRequired();
            builder.Property(item => item.Amount).HasPrecision(19, 4);
            builder.Property(item => item.CurrencyCode).HasColumnType("char(3)").IsRequired();
            builder.Property(item => item.Brand).HasMaxLength(16).IsRequired();
            builder.Property(item => item.Last4).HasColumnType("char(4)").IsRequired();
            builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(item => item.DeclineCode).HasMaxLength(40);
            builder.Property(item => item.AuthorizationCode).HasMaxLength(12);
            builder.HasIndex(item => new { item.AccountId, item.IdempotencyKey }).IsUnique();
            builder.HasIndex(item => new { item.InvoiceId, item.CreatedAt });
            builder.HasIndex(item => item.ReceiptId).IsUnique().HasFilter("[receipt_id] IS NOT NULL");
            builder.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(item => item.InvoiceId).OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Airline>().WithMany().HasForeignKey(item => item.AirlineId).OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.AccountId).OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<FinanceTreasuryReceipt>().WithMany().HasForeignKey(item => item.ReceiptId).OnDelete(DeleteBehavior.NoAction);
        });
    }
}
