using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

public sealed class FinanceFiscalDocumentConfiguration : IEntityTypeConfiguration<FinanceFiscalDocument>
{
    public void Configure(EntityTypeBuilder<FinanceFiscalDocument> b)
    {
        b.ToTable("finance_fiscal_documents", "commercial", t =>
        {
            t.HasCheckConstraint("ck_fiscal_document_total", "[total] >= 0");
            t.HasCheckConstraint("ck_fiscal_document_simulation", "[mode] = N'LocalSimulation' AND [environment] IN (N'Development', N'Test') AND [encf] IS NULL AND [dgii_response_id] IS NULL");
            t.HasCheckConstraint("ck_fiscal_document_snapshot", "ISJSON([canonical_snapshot]) = 1 AND LEN([snapshot_hash]) = 64 AND LEN([request_hash]) = 64");
            t.HasCheckConstraint("ck_fiscal_document_request", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
            t.HasCheckConstraint("ck_fiscal_document_currency", "[currency_code] IN ('USD', 'DOP')");
        });
        b.Property(x => x.Mode).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.Environment).HasMaxLength(32).IsRequired();
        b.Property(x => x.Outcome).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.State).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.ArtifactCompletion).HasConversion<string>().HasMaxLength(16);
        b.Property(x => x.RequestHash).HasMaxLength(64).IsRequired();
        b.Property(x => x.SnapshotHash).HasMaxLength(64).IsRequired();
        b.Property(x => x.CanonicalSnapshot).HasColumnType("nvarchar(max)").IsRequired();
        b.Property(x => x.CurrencyCode).HasColumnType("char(3)").IsRequired();
        b.Property(x => x.Total).HasPrecision(19, 4);
        b.Property(x => x.ProviderDocumentId).HasMaxLength(160);
        b.Property(x => x.DgiiResponseId).HasMaxLength(160);
        b.Property(x => x.Encf).HasMaxLength(32);
        b.HasIndex(x => new { x.Environment, x.RequestId }).IsUnique();
        b.HasIndex(x => new { x.InvoiceId, x.Environment, x.Mode }).IsUnique();
        b.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedByAccountId).OnDelete(DeleteBehavior.NoAction);
        b.Property(x => x.RowVersion).IsRowVersion();
        // Immutable snapshot columns cannot be modified by EF after insertion.
        foreach (var name in new[] { nameof(FinanceFiscalDocument.InvoiceId), nameof(FinanceFiscalDocument.CreatedByAccountId),
            nameof(FinanceFiscalDocument.RequestId), nameof(FinanceFiscalDocument.RequestHash), nameof(FinanceFiscalDocument.Mode),
            nameof(FinanceFiscalDocument.Environment), nameof(FinanceFiscalDocument.Outcome), nameof(FinanceFiscalDocument.CanonicalSnapshot),
            nameof(FinanceFiscalDocument.SnapshotHash), nameof(FinanceFiscalDocument.CurrencyCode), nameof(FinanceFiscalDocument.Total) })
            b.Property(name).Metadata.SetAfterSaveBehavior(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Throw);
    }
}
public sealed class FinanceFiscalIntentConfiguration : IEntityTypeConfiguration<FinanceFiscalIntent>
{
    public void Configure(EntityTypeBuilder<FinanceFiscalIntent> b)
    {
        b.ToTable("finance_fiscal_intents", "commercial", t => t.HasCheckConstraint("ck_fiscal_intent_single_dispatch", "[dispatch_count] BETWEEN 0 AND 1"));
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.DispatchRequestHash).HasMaxLength(64);
        b.HasIndex(x => x.DocumentId).IsUnique();
        b.HasIndex(x => x.DispatchRequestId).IsUnique().HasFilter("[dispatch_request_id] IS NOT NULL");
        b.HasOne<FinanceFiscalDocument>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.DispatchedByAccountId).OnDelete(DeleteBehavior.NoAction);
        b.Property(x => x.RowVersion).IsRowVersion();
    }
}
public sealed class FinanceFiscalArtifactConfiguration : IEntityTypeConfiguration<FinanceFiscalArtifact>
{
    public void Configure(EntityTypeBuilder<FinanceFiscalArtifact> b)
    {
        b.ToTable("finance_fiscal_artifacts", "commercial", t => t.HasCheckConstraint("ck_fiscal_artifact_integrity", "[length] > 0 AND LEN([sha256]) = 64"));
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.ObjectKey).HasMaxLength(400).IsRequired();
        b.Property(x => x.ContentType).HasMaxLength(80).IsRequired();
        b.Property(x => x.FileName).HasMaxLength(160).IsRequired();
        b.Property(x => x.Sha256).HasMaxLength(64).IsRequired();
        b.HasIndex(x => x.ObjectKey).IsUnique();
        b.HasOne<FinanceFiscalDocument>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.NoAction);
        b.Property(x => x.RowVersion).IsRowVersion();
    }
}
public sealed class FinanceFiscalEventConfiguration : IEntityTypeConfiguration<FinanceFiscalEvent>
{
    public void Configure(EntityTypeBuilder<FinanceFiscalEvent> b)
    {
        b.ToTable("finance_fiscal_events", "commercial");
        b.Property(x => x.Kind).HasMaxLength(40).IsRequired();
        b.Property(x => x.State).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.PayloadHash).HasMaxLength(64).IsRequired();
        b.Property(x => x.Detail).HasMaxLength(500).IsRequired();
        b.HasIndex(x => new { x.DocumentId, x.EventId }).IsUnique();
        b.HasOne<FinanceFiscalDocument>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.NoAction);
        b.Property(x => x.RowVersion).IsRowVersion();
    }
}
