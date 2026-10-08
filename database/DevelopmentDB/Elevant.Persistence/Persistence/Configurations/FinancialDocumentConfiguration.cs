using Elevant.Domain.Entities.Commercial;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal sealed class FinancialDocumentConfiguration : IEntityTypeConfiguration<FinancialDocument>
{
    public void Configure(EntityTypeBuilder<FinancialDocument> builder)
    {
        builder.ToTable("financial_documents", "commercial", table =>
        {
            table.HasCheckConstraint("ck_financial_document_kind",
                "([kind] = 'Invoice' AND [payment_id] IS NULL) OR " +
                "([kind] = 'Receipt' AND [payment_id] IS NOT NULL)");
            table.HasCheckConstraint("ck_financial_document_length", "[length] > 0");
            table.HasCheckConstraint("ck_financial_document_content_type",
                "[content_type] = 'application/pdf'");
            table.HasCheckConstraint("ck_financial_document_sha256", "LEN([sha256]) = 64");
        });
        builder.Property(item => item.Kind).HasMaxLength(16).IsRequired();
        builder.Property(item => item.ObjectKey).HasMaxLength(240).IsRequired();
        builder.Property(item => item.ContentType).HasMaxLength(32).IsRequired();
        builder.Property(item => item.Sha256).HasMaxLength(64).IsRequired();
        builder.HasIndex(item => new { item.InvoiceId, item.Kind }).IsUnique()
            .HasFilter("[kind] = 'Invoice'");
        builder.HasIndex(item => item.PaymentId).IsUnique()
            .HasFilter("[payment_id] IS NOT NULL");
        builder.HasIndex(item => item.ObjectKey).IsUnique();
        builder.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(item => item.InvoiceId)
            .OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<NonFiscalPayment>().WithMany().HasForeignKey(item => item.PaymentId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
