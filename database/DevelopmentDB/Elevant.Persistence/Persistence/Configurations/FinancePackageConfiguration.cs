using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class FinancePackageConfiguration
{
    public static void ConfigureFinancePackages(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FinancePricingCommand>(b =>
        {
            b.ToTable("finance_pricing_commands", "commercial");
            b.Property(x => x.Action).HasMaxLength(80);
            b.Property(x => x.PayloadHash).HasMaxLength(64);
            b.HasIndex(x => x.RequestId).IsUnique();
            b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorAccountId).OnDelete(DeleteBehavior.NoAction);
        });
        modelBuilder.Entity<ServicePackageVersion>(b =>
        {
            b.ToTable("service_package_versions", "commercial", t =>
            {
                t.HasCheckConstraint("ck_package_version_price", "[base_price] >= 0 AND [version_number] > 0");
                t.HasCheckConstraint("ck_package_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                t.HasCheckConstraint("ck_package_version_currency", "[currency_code] IN ('USD','DOP')");
                t.HasCheckConstraint("ck_package_version_scope", "([scope] = N'Turnaround' AND [flight_direction] IS NULL AND [period_days] IS NULL) OR ([scope] = N'Flight' AND [flight_direction] IS NOT NULL AND [period_days] IS NULL) OR ([scope] = N'Period' AND [flight_direction] IS NULL AND [period_days] BETWEEN 1 AND 366)");
            });
            b.Property(x => x.Code).HasMaxLength(32).IsRequired();
            b.Property(x => x.Name).HasMaxLength(120).IsRequired();
            b.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            b.Property(x => x.Scope).HasConversion<string>().HasMaxLength(16);
            b.Property(x => x.FlightDirection).HasConversion<string>().HasMaxLength(16);
            b.Property(x => x.CurrencyCode).HasColumnType("char(3)");
            b.Property(x => x.BasePrice).HasPrecision(19,4);
            b.HasIndex(x => new { x.Code, x.VersionNumber }).IsUnique();
            b.HasIndex(x => new { x.Code, x.CurrencyCode }).IsUnique().HasFilter("[status] = N'Draft'");
            b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedByAccountId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.PublishedByAccountId).OnDelete(DeleteBehavior.NoAction);
        });
        modelBuilder.Entity<ServicePackageComponent>(b =>
        {
            b.ToTable("service_package_components", "commercial", t => t.HasCheckConstraint("ck_package_component_rules", "[included_quantity] >= 0 AND [excess_block_size] > 0 AND [excess_block_price] >= 0"));
            b.Property(x => x.BillingUnit).HasMaxLength(32).IsRequired();
            b.Property(x => x.IncludedQuantity).HasPrecision(18,4);
            b.Property(x => x.ExcessBlockSize).HasPrecision(18,4);
            b.Property(x => x.ExcessBlockPrice).HasPrecision(19,4);
            b.HasIndex(x => new { x.PackageVersionId, x.ServiceDefinitionId }).IsUnique();
            b.HasOne<ServicePackageVersion>().WithMany().HasForeignKey(x => x.PackageVersionId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<ServiceDefinition>().WithMany().HasForeignKey(x => x.ServiceDefinitionId).OnDelete(DeleteBehavior.NoAction);
        });
        modelBuilder.Entity<ContractServicePackage>(b =>
        {
            b.ToTable("contract_service_packages", "commercial");
            b.HasIndex(x => new { x.ContractVersionId, x.PackageVersionId }).IsUnique();
            b.HasOne<ContractVersion>().WithMany().HasForeignKey(x => x.ContractVersionId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<ServicePackageVersion>().WithMany().HasForeignKey(x => x.PackageVersionId).OnDelete(DeleteBehavior.NoAction);
        });
        modelBuilder.Entity<PackageConsumption>(b =>
        {
            b.ToTable("package_consumptions", "commercial");
            b.Property(x => x.ScopeKey).HasMaxLength(100).IsRequired();
            b.HasIndex(x => new { x.ContractPackageId, x.StationId, x.ScopeKey }).IsUnique();
            b.HasOne<ContractServicePackage>().WithMany().HasForeignKey(x => x.ContractPackageId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<Station>().WithMany().HasForeignKey(x => x.StationId).OnDelete(DeleteBehavior.NoAction);
        });
        modelBuilder.Entity<PackageConsumptionEntry>(b =>
        {
            b.ToTable("package_consumption_entries", "commercial", t => t.HasCheckConstraint("ck_package_entry_amounts", "[quantity] > 0 AND [included_quantity] >= 0 AND [excess_quantity] >= 0 AND [base_amount] >= 0 AND [excess_amount] >= 0"));
            b.Property(x => x.Quantity).HasPrecision(18,4);
            b.Property(x => x.IncludedQuantity).HasPrecision(18,4);
            b.Property(x => x.ExcessQuantity).HasPrecision(18,4);
            b.Property(x => x.BaseAmount).HasPrecision(19,4);
            b.Property(x => x.ExcessAmount).HasPrecision(19,4);
            b.Property(x => x.CalculationJson).HasColumnType("nvarchar(max)");
            b.HasIndex(x => new { x.ConsumptionId, x.OperationServiceId, x.PreinvoiceLineId }).IsUnique();
            b.HasOne<PackageConsumption>().WithMany().HasForeignKey(x => x.ConsumptionId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<ServicePackageComponent>().WithMany().HasForeignKey(x => x.ComponentId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<OperationService>().WithMany().HasForeignKey(x => x.OperationServiceId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<OperationSubmission>().WithMany().HasForeignKey(x => x.ApprovedSubmissionId).OnDelete(DeleteBehavior.NoAction);
            b.HasOne<PreinvoiceLine>().WithMany().HasForeignKey(x => x.PreinvoiceLineId).OnDelete(DeleteBehavior.NoAction);
        });
    }
}
