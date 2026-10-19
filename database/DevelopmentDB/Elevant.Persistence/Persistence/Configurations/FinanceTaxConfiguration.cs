using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal sealed class FinanceTaxPolicyConfiguration : IEntityTypeConfiguration<FinanceTaxPolicy>
{
    public void Configure(EntityTypeBuilder<FinanceTaxPolicy> b)
    {
        b.ToTable("finance_tax_policies", "commercial", t =>
        {
            t.HasCheckConstraint("ck_tax_policy_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
            t.HasCheckConstraint("ck_tax_policy_treatment", "([treatment] = N'Taxable' AND [rate] IS NOT NULL AND [rate] BETWEEN 0 AND 100) OR ([treatment] IN (N'Exempt',N'NotSubject') AND [rate] IS NULL AND [basis] IS NOT NULL AND LEN(LTRIM(RTRIM([basis]))) >= 3)");
            t.HasCheckConstraint("ck_tax_policy_currency", "[currency_code] IN ('USD','DOP')");
        });
        b.Property(p => p.CurrencyCode).HasColumnType("char(3)");
        b.Property(p => p.ConceptKind).HasConversion<string>().HasMaxLength(16);
        b.Property(p => p.ConceptCode).HasMaxLength(40).IsRequired();
        b.Property(p => p.Treatment).HasConversion<string>().HasMaxLength(20);
        b.Property(p => p.Status).HasConversion<string>().HasMaxLength(16);
        b.Property(p => p.Rate).HasPrecision(9, 4);
        b.Property(p => p.Basis).HasMaxLength(500);
        b.HasIndex(p => new { p.AirlineId, p.StationId, p.CurrencyCode, p.ConceptKind, p.ConceptCode, p.ValidFrom });
        b.HasOne<Airline>().WithMany().HasForeignKey(p => p.AirlineId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<Station>().WithMany().HasForeignKey(p => p.StationId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<FinanceTaxPolicy>().WithMany().HasForeignKey(p => p.ReplacesPolicyId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(p => p.CreatedByAccountId).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(p => p.PublishedByAccountId).OnDelete(DeleteBehavior.NoAction);
        foreach (var name in new[] { "AirlineId", "StationId", "CurrencyCode", "ConceptKind", "ConceptCode", "Treatment", "Rate", "Basis", "ValidFrom", "ValidTo", "ReplacesPolicyId", "CreatedByAccountId" })
            b.Property(name).Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Throw);
    }
}
internal sealed class FinanceTaxCommandConfiguration : IEntityTypeConfiguration<FinanceTaxCommand>
{
    public void Configure(EntityTypeBuilder<FinanceTaxCommand> b)
    {
        b.ToTable("finance_tax_commands", "commercial");
        b.Property(p => p.Action).HasMaxLength(80);
        b.Property(p => p.PayloadHash).HasMaxLength(64);
        b.HasIndex(p => p.RequestId).IsUnique();
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(p => p.ActorAccountId).OnDelete(DeleteBehavior.NoAction);
    }
}
internal sealed class FinanceTaxPreinvoiceLineConfiguration : IEntityTypeConfiguration<PreinvoiceLine>
{
    public void Configure(EntityTypeBuilder<PreinvoiceLine> b)
    {
        b.Property(p => p.TaxTreatment).HasConversion<string>().HasMaxLength(20).HasDefaultValue(FinanceTaxTreatment.Unconfigured);
        b.Property(p => p.TaxBasis).HasMaxLength(500);
        b.Property(p => p.TaxRate).HasPrecision(9, 4);
        b.Property(p => p.NetAmount).HasPrecision(19, 4);
        b.Property(p => p.DiscountAmount).HasPrecision(19, 4);
        b.Property(p => p.TaxAmount).HasPrecision(19, 4);
        b.Property(p => p.GrossAmount).HasPrecision(19, 4);
    }
}
internal sealed class FinanceTaxInvoiceLineConfiguration : IEntityTypeConfiguration<NonFiscalInvoiceLine>
{
    public void Configure(EntityTypeBuilder<NonFiscalInvoiceLine> b)
    {
        b.Property(p => p.TaxTreatment).HasConversion<string>().HasMaxLength(20).HasDefaultValue(FinanceTaxTreatment.Unconfigured);
        b.Property(p => p.TaxBasis).HasMaxLength(500);
        b.Property(p => p.TaxRate).HasPrecision(9, 4);
        b.Property(p => p.NetAmount).HasPrecision(19, 4);
        b.Property(p => p.DiscountAmount).HasPrecision(19, 4);
        b.Property(p => p.TaxAmount).HasPrecision(19, 4);
        b.Property(p => p.GrossAmount).HasPrecision(19, 4);
        foreach (var name in new[] { "TaxTreatment", "TaxPolicyPublicId", "TaxBasis", "TaxRate", "NetAmount", "DiscountAmount", "TaxAmount", "GrossAmount", "TaxCapturedAt", "Amount", "UnitPrice" })
            b.Property(name).Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Throw);
    }
}
internal sealed class FinanceTaxInvoiceConfiguration : IEntityTypeConfiguration<NonFiscalInvoice>
{
    public void Configure(EntityTypeBuilder<NonFiscalInvoice> b)
    {
        b.Property(p => p.NetTotal).HasPrecision(19, 4);
        b.Property(p => p.DiscountTotal).HasPrecision(19, 4);
        b.Property(p => p.TaxTotal).HasPrecision(19, 4);
        b.Property(p => p.CommercialSnapshotJson).HasColumnType("nvarchar(max)");
        foreach (var name in new[] { "NetTotal", "DiscountTotal", "TaxTotal", "TaxTreatmentsConfigured", "CommercialSnapshotJson", "Total", "CurrencyCode", "PaymentTermDays", "DueDate" })
            b.Property(name).Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Throw);
    }
}
