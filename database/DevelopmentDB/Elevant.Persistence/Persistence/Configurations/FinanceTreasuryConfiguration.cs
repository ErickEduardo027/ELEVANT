using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace Elevant.Persistence.Persistence.Configurations;

internal sealed class FinanceTreasuryConfiguration :
    IEntityTypeConfiguration<FinanceTreasuryReceipt>, IEntityTypeConfiguration<FinanceTreasuryMovement>,
    IEntityTypeConfiguration<FinanceTreasuryInvoiceAccount>, IEntityTypeConfiguration<FinanceTreasuryRequest>,
    IEntityTypeConfiguration<FinanceTreasuryAdjustmentNote>, IEntityTypeConfiguration<FinanceTreasuryAdjustmentLine>
{
    public void Configure(EntityTypeBuilder<FinanceTreasuryReceipt> b)
    {
        b.ToTable("finance_treasury_receipts", "commercial", t => {
            t.HasCheckConstraint("ck_treasury_receipt_amount", "[amount] > 0");
            t.HasCheckConstraint("ck_treasury_receipt_currency", "[currency_code] IN ('USD','DOP')");
        });
        b.Property(x => x.Amount).HasPrecision(19, 4);
        b.Property(x => x.CurrencyCode).HasColumnType("char(3)").IsRequired();
        b.Property(x => x.Reference).HasMaxLength(120).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(1000).IsRequired();
        b.Property(x => x.Method).HasConversion<string>().HasMaxLength(24);
        b.HasIndex(x => x.RequestId).IsUnique();
        b.HasIndex(x => new { x.AirlineId, x.Reference }).IsUnique();
        b.HasIndex(x => new { x.StationId, x.AirlineId, x.ReceivedOn });
        b.HasOne<Airline>().WithMany().HasForeignKey(x => x.AirlineId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<Station>().WithMany().HasForeignKey(x => x.StationId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorAccountId).OnDelete(DeleteBehavior.NoAction);
        // 4-N22: the receipt of a charter prepayment names its charter.
        b.HasIndex(x => x.CharterAgreementId).HasFilter("[charter_agreement_id] IS NOT NULL");
        b.HasOne<CharterAgreement>().WithMany().HasForeignKey(x => x.CharterAgreementId).OnDelete(DeleteBehavior.NoAction);
        Freeze(b, nameof(AuditableEntity.UpdatedAt));
    }
    public void Configure(EntityTypeBuilder<FinanceTreasuryMovement> b)
    {
        b.ToTable("finance_treasury_movements", "commercial", t => {
            t.HasCheckConstraint("ck_treasury_movement_amount", "[receipt_amount] > 0 AND [invoice_amount] >= 0 AND [exchange_rate] > 0");
            t.HasCheckConstraint("ck_treasury_movement_shape", "([kind] IN ('Application','ApplicationReversal') AND [invoice_id] IS NOT NULL AND [invoice_amount] > 0 AND [invoice_currency] IS NOT NULL) OR ([kind] IN ('ReceiptReversal','Refund') AND [invoice_id] IS NULL AND [invoice_amount] = 0)");
            t.HasCheckConstraint("ck_treasury_reversal_shape", "([kind] = 'ApplicationReversal' AND [reverses_movement_id] IS NOT NULL) OR ([kind] <> 'ApplicationReversal' AND [reverses_movement_id] IS NULL)");
        });
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(24);
        b.Property(x => x.ReceiptAmount).HasPrecision(19, 4);
        b.Property(x => x.InvoiceAmount).HasPrecision(19, 4);
        b.Property(x => x.ExchangeRate).HasPrecision(28, 10);
        b.Property(x => x.ReceiptCurrency).HasColumnType("char(3)").IsRequired();
        b.Property(x => x.InvoiceCurrency).HasColumnType("char(3)");
        b.Property(x => x.Reference).HasMaxLength(120).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(1000).IsRequired();
        b.HasIndex(x => x.ReversesMovementId).IsUnique().HasFilter("[reverses_movement_id] IS NOT NULL");
        b.HasIndex(x => new { x.ReceiptId, x.EffectiveOn });
        b.HasIndex(x => new { x.InvoiceId, x.EffectiveOn });
        b.HasIndex(x => x.ReceiptId).IsUnique().HasDatabaseName("ux_treasury_receipt_reversal").HasFilter("[kind] = 'ReceiptReversal'");
        b.HasOne<FinanceTreasuryReceipt>().WithMany().HasForeignKey(x => x.ReceiptId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<FinanceTreasuryMovement>().WithMany().HasForeignKey(x => x.ReversesMovementId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorAccountId).OnDelete(DeleteBehavior.NoAction);
        Freeze(b);
    }
    public void Configure(EntityTypeBuilder<FinanceTreasuryInvoiceAccount> b)
    {
        b.ToTable("finance_treasury_invoice_accounts", "commercial");
        b.HasIndex(x => x.InvoiceId).IsUnique();
        b.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
    }
    public void Configure(EntityTypeBuilder<FinanceTreasuryRequest> b)
    {
        b.ToTable("finance_treasury_requests", "commercial");
        b.HasIndex(x => x.RequestId).IsUnique();
        b.Property(x => x.Operation).HasMaxLength(40).IsRequired();
        b.Property(x => x.PayloadHash).HasColumnType("char(64)").IsRequired();
        b.Property(x => x.ResultVersion).HasMaxLength(24).IsRequired();
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorAccountId).OnDelete(DeleteBehavior.NoAction);
        Freeze(b);
    }
    public void Configure(EntityTypeBuilder<FinanceTreasuryAdjustmentNote> b)
    {
        b.ToTable("finance_treasury_adjustment_notes", "commercial", t => {
            t.HasCheckConstraint("ck_treasury_adjustment_amount", "[amount] > 0");
            t.HasCheckConstraint("ck_treasury_adjustment_kind", "[kind] IN ('Credit','Debit')");
        });
        b.Property(x => x.Amount).HasPrecision(19, 4);
        b.Property(x => x.CurrencyCode).HasColumnType("char(3)").IsRequired();
        b.Property(x => x.Number).HasMaxLength(40).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(1000).IsRequired();
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
        b.HasIndex(x => x.RequestId).IsUnique(); b.HasIndex(x => x.Number).IsUnique();
        b.HasIndex(x => new { x.InvoiceId, x.EffectiveOn });
        b.HasOne<NonFiscalInvoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<FinanceTreasuryAdjustmentNote>().WithMany().HasForeignKey(x => x.RelatedNoteId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorAccountId).OnDelete(DeleteBehavior.NoAction);
        Freeze(b);
    }
    public void Configure(EntityTypeBuilder<FinanceTreasuryAdjustmentLine> b)
    {
        b.ToTable("finance_treasury_adjustment_lines", "commercial", t =>
            t.HasCheckConstraint("ck_treasury_adjustment_line_amount", "[quantity] >= 0 AND [amount] > 0"));
        b.Property(x => x.Amount).HasPrecision(19, 4); b.Property(x => x.Quantity).HasPrecision(18, 4);
        // 4-N17: the frozen fiscal breakdown of the line, with the precision of the invoice line it comes from.
        b.Property(x => x.NetAmount).HasPrecision(19, 4); b.Property(x => x.TaxAmount).HasPrecision(19, 4);
        b.Property(x => x.TaxRate).HasPrecision(9, 4);
        b.HasIndex(x => new { x.NoteId, x.InvoiceLineId }).IsUnique();
        b.HasOne<FinanceTreasuryAdjustmentNote>().WithMany().HasForeignKey(x => x.NoteId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<NonFiscalInvoiceLine>().WithMany().HasForeignKey(x => x.InvoiceLineId).OnDelete(DeleteBehavior.NoAction);
        Freeze(b);
    }
    private static void Freeze<T>(EntityTypeBuilder<T> b, params string[] mutable) where T : AuditableEntity
    {
        foreach (var p in b.Metadata.GetProperties())
            if (p.Name is not (nameof(AuditableEntity.RowVersion) or nameof(AuditableEntity.Id)) && !mutable.Contains(p.Name))
                p.SetAfterSaveBehavior(PropertySaveBehavior.Throw);
    }
}
