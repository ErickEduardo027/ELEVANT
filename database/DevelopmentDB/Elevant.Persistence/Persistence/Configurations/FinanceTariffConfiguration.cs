using System.Linq.Expressions;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

/// <summary>Finance base tariffs, charges, exchange rates and contract approval.</summary>
internal static class FinanceTariffConfiguration
{
    public static void ConfigureFinanceTariffs(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BillingUnit>(builder =>
        {
            builder.ToTable("billing_units", "ref", table =>
                table.HasCheckConstraint("ck_billing_unit_scale", "[quantity_scale] BETWEEN 0 AND 4"));
            builder.Property(unit => unit.Code).HasMaxLength(32).IsRequired();
            builder.Property(unit => unit.Name).HasMaxLength(80).IsRequired();
            builder.HasIndex(unit => unit.Code).IsUnique();
        });

        modelBuilder.Entity<ServiceTariffVersion>(builder =>
        {
            builder.ToTable("service_tariff_versions", "commercial", table => TariffVersionChecks(table, "service_tariff"));
            ConfigureTariffVersion(builder, version => version.Status, version => version.CurrencyCode,
                version => version.ValidFrom, version => version.ValidTo, version => version.Note,
                version => version.PublishedAt);
            builder.HasIndex(version => version.CurrencyCode).IsUnique()
                .HasFilter("[status] = N'Draft'").HasDatabaseName("ux_service_tariff_versions_single_draft");
            builder.HasIndex(version => new { version.CurrencyCode, version.Status, version.ValidFrom });
            Reference<ApplicationUser, ServiceTariffVersion>(builder, version => version.CreatedByAccountId);
            Reference<ApplicationUser, ServiceTariffVersion>(builder, version => version.PublishedByAccountId);
        });

        modelBuilder.Entity<ServiceTariffRate>(builder =>
        {
            builder.ToTable("service_tariff_rates", "commercial", table =>
            {
                table.HasCheckConstraint("ck_service_tariff_rate_price", "[unit_price] >= 0");
                table.HasCheckConstraint("ck_service_tariff_rate_minimum", "[minimum_billable_quantity] >= 0");
            });
            builder.Property(rate => rate.BillingUnit).HasMaxLength(32).IsRequired();
            builder.Property(rate => rate.UnitPrice).HasPrecision(19, 4);
            builder.Property(rate => rate.MinimumBillableQuantity).HasPrecision(18, 4);
            builder.HasIndex(rate => new { rate.ServiceTariffVersionId, rate.ServiceDefinitionId, rate.StationId })
                .IsUnique().HasFilter("[station_id] IS NOT NULL");
            builder.HasIndex(rate => new { rate.ServiceTariffVersionId, rate.ServiceDefinitionId })
                .IsUnique().HasFilter("[station_id] IS NULL").HasDatabaseName("ux_service_tariff_rates_all_stations");
            Reference<ServiceTariffVersion, ServiceTariffRate>(builder, rate => rate.ServiceTariffVersionId);
            Reference<ServiceDefinition, ServiceTariffRate>(builder, rate => rate.ServiceDefinitionId);
            Reference<Station, ServiceTariffRate>(builder, rate => rate.StationId);
        });

        modelBuilder.Entity<ChargeDefinition>(builder =>
        {
            builder.ToTable("charge_definitions", "commercial", table =>
            {
                table.HasCheckConstraint("ck_charge_definition_grace", "[grace_minutes] BETWEEN 0 AND 1440");
                table.HasCheckConstraint("ck_charge_definition_rounding", "[rounding_increment] >= 0");
            });
            builder.Property(charge => charge.Code).HasMaxLength(32).IsRequired();
            builder.Property(charge => charge.Name).HasMaxLength(120).IsRequired();
            builder.Property(charge => charge.Description).HasMaxLength(500);
            builder.Property(charge => charge.Category).HasConversion<string>().HasMaxLength(24);
            builder.Property(charge => charge.Method).HasConversion<string>().HasMaxLength(24);
            builder.Property(charge => charge.QuantityRule).HasConversion<string>().HasMaxLength(24);
            builder.Property(charge => charge.RoundingIncrement).HasPrecision(18, 4);
            builder.Property(charge => charge.BillingUnit).HasMaxLength(32);
            builder.HasIndex(charge => charge.Code).IsUnique();
        });

        modelBuilder.Entity<ChargeDefinitionService>(builder =>
        {
            builder.ToTable("charge_definition_services", "commercial");
            builder.HasKey(link => new { link.ChargeDefinitionId, link.ServiceDefinitionId });
            Reference<ChargeDefinition, ChargeDefinitionService>(builder, link => link.ChargeDefinitionId);
            Reference<ServiceDefinition, ChargeDefinitionService>(builder, link => link.ServiceDefinitionId);
        });

        modelBuilder.Entity<ChargeTariffVersion>(builder =>
        {
            builder.ToTable("charge_tariff_versions", "commercial", table => TariffVersionChecks(table, "charge_tariff"));
            ConfigureTariffVersion(builder, version => version.Status, version => version.CurrencyCode,
                version => version.ValidFrom, version => version.ValidTo, version => version.Note,
                version => version.PublishedAt);
            builder.HasIndex(version => version.CurrencyCode).IsUnique()
                .HasFilter("[status] = N'Draft'").HasDatabaseName("ux_charge_tariff_versions_single_draft");
            builder.HasIndex(version => new { version.CurrencyCode, version.Status, version.ValidFrom });
            Reference<ApplicationUser, ChargeTariffVersion>(builder, version => version.CreatedByAccountId);
            Reference<ApplicationUser, ChargeTariffVersion>(builder, version => version.PublishedByAccountId);
        });

        modelBuilder.Entity<ChargeRate>(builder =>
        {
            builder.ToTable("charge_rates", "commercial", table =>
            {
                table.HasCheckConstraint("ck_charge_rate_value", "[value] >= 0");
                table.HasCheckConstraint("ck_charge_rate_minimum", "[minimum_amount] >= 0");
            });
            builder.Property(rate => rate.Value).HasPrecision(19, 4);
            builder.Property(rate => rate.MinimumAmount).HasPrecision(19, 4);
            builder.HasIndex(rate => new { rate.ChargeTariffVersionId, rate.ChargeDefinitionId }).IsUnique();
            Reference<ChargeTariffVersion, ChargeRate>(builder, rate => rate.ChargeTariffVersionId);
            Reference<ChargeDefinition, ChargeRate>(builder, rate => rate.ChargeDefinitionId);
        });

        modelBuilder.Entity<ContractChargeRate>(builder =>
        {
            builder.ToTable("contract_charge_rates", "commercial", table =>
                table.HasCheckConstraint("ck_contract_charge_rate",
                    "([is_excluded] = 1 AND [value] IS NULL) OR ([is_excluded] = 0 AND [value] >= 0)"));
            builder.Property(rate => rate.Value).HasPrecision(19, 4);
            builder.Property(rate => rate.MinimumAmount).HasPrecision(19, 4);
            builder.HasIndex(rate => new { rate.ContractVersionId, rate.ChargeDefinitionId }).IsUnique();
            Reference<ContractVersion, ContractChargeRate>(builder, rate => rate.ContractVersionId);
            Reference<ChargeDefinition, ContractChargeRate>(builder, rate => rate.ChargeDefinitionId);
        });

        modelBuilder.Entity<ExchangeRate>(builder =>
        {
            builder.ToTable("exchange_rates", "commercial", table =>
            {
                table.HasCheckConstraint("ck_exchange_rate_value", "[rate] > 0");
                table.HasCheckConstraint("ck_exchange_rate_currencies",
                    "LEN([from_currency]) = 3 AND LEN([to_currency]) = 3 AND [from_currency] <> [to_currency]");
            });
            builder.Property(rate => rate.RateDate).HasColumnType("date");
            builder.Property(rate => rate.FromCurrency).HasColumnType("char(3)").IsRequired();
            builder.Property(rate => rate.ToCurrency).HasColumnType("char(3)").IsRequired();
            builder.Property(rate => rate.Rate).HasPrecision(19, 6);
            builder.Property(rate => rate.Source).HasMaxLength(120).IsRequired();
            builder.HasIndex(rate => new { rate.RateDate, rate.FromCurrency, rate.ToCurrency }).IsUnique()
                .HasFilter("[is_current] = 1").HasDatabaseName("ux_exchange_rates_current");
            Reference<ApplicationUser, ExchangeRate>(builder, rate => rate.RecordedByAccountId);
            Reference<ExchangeRate, ExchangeRate>(builder, rate => rate.SupersedesId);
        });

        modelBuilder.Entity<ContractFinanceReview>(builder =>
        {
            builder.ToTable("contract_finance_reviews", "commercial", table =>
                table.HasCheckConstraint("ck_contract_finance_review_reason",
                    "[decision] = N'Approved' OR LEN([reason]) >= 3"));
            builder.Property(review => review.Decision).HasConversion<string>().HasMaxLength(16);
            builder.Property(review => review.Reason).HasMaxLength(1000);
            builder.Property(review => review.DecidedAt).HasPrecision(3);
            builder.Property(review => review.ComparisonJson).HasColumnType("nvarchar(max)").IsRequired();
            builder.HasIndex(review => new { review.ContractVersionId, review.DecidedAt });
            Reference<ContractVersion, ContractFinanceReview>(builder, review => review.ContractVersionId);
            Reference<ApplicationUser, ContractFinanceReview>(builder, review => review.DecidedByAccountId);
        });

        modelBuilder.Entity<AirlineBillingProfile>(builder =>
        {
            builder.ToTable("airline_billing_profiles", "commercial", table =>
                table.HasCheckConstraint("ck_airline_billing_profile_terms", "[payment_term_days] BETWEEN 0 AND 365"));
            builder.Property(profile => profile.BillingEmail).HasMaxLength(256);
            builder.Property(profile => profile.Notes).HasMaxLength(1000);
            builder.HasIndex(profile => profile.AirlineId).IsUnique();
            Reference<Airline, AirlineBillingProfile>(builder, profile => profile.AirlineId);
        });

        modelBuilder.Entity<NonFiscalCreditNote>(builder =>
        {
            builder.ToTable("non_fiscal_credit_notes", "commercial", table =>
            {
                table.HasCheckConstraint("ck_non_fiscal_credit_note_amount", "[amount] > 0");
                table.HasCheckConstraint("ck_non_fiscal_credit_note_reason", "LEN([reason]) >= 3");
                table.HasCheckConstraint("ck_non_fiscal_credit_note_request_id",
                    "[request_id] <> '00000000-0000-0000-0000-000000000000'");
            });
            builder.Property(note => note.Number).HasMaxLength(35).IsRequired();
            builder.Property(note => note.CurrencyCode).HasColumnType("char(3)").IsRequired();
            builder.Property(note => note.Amount).HasPrecision(19, 4);
            builder.Property(note => note.Reason).HasMaxLength(1000).IsRequired();
            builder.HasIndex(note => note.Number).IsUnique();
            builder.HasIndex(note => note.RequestId).IsUnique();
            builder.HasIndex(note => note.InvoiceId);
            Reference<NonFiscalInvoice, NonFiscalCreditNote>(builder, note => note.InvoiceId);
            Reference<ApplicationUser, NonFiscalCreditNote>(builder, note => note.IssuedByAccountId);
        });

        modelBuilder.Entity<OperationServiceCharge>(builder =>
        {
            builder.ToTable("operation_service_charges", "ops", table =>
            {
                // Removed by exactly one: the agent or an OCC reviewer (ADR-0034).
                table.HasCheckConstraint("ck_operation_service_charge_removal",
                    "([removed_at] IS NULL AND [removed_by_ramp_agent_id] IS NULL AND [removed_by_account_id] IS NULL) OR " +
                    "([removed_at] IS NOT NULL AND (([removed_by_ramp_agent_id] IS NOT NULL AND [removed_by_account_id] IS NULL) OR ([removed_by_ramp_agent_id] IS NULL AND [removed_by_account_id] IS NOT NULL)))");
                table.HasCheckConstraint("ck_operation_service_charge_source",
                    "([source] = N'Agent' AND [applied_by_ramp_agent_id] IS NOT NULL AND [applied_by_account_id] IS NULL) OR " +
                    "([source] = N'Automatic' AND [applied_by_ramp_agent_id] IS NULL AND [applied_by_account_id] IS NULL) OR " +
                    "([source] = N'Occ' AND [applied_by_ramp_agent_id] IS NULL AND [applied_by_account_id] IS NOT NULL)");
                table.HasCheckConstraint("ck_operation_service_charge_reason",
                    "([applied_by_account_id] IS NULL AND [removed_by_account_id] IS NULL) OR [adjustment_reason] IS NOT NULL");
            });
            builder.Property(charge => charge.Source).HasConversion<string>().HasMaxLength(16)
                .HasDefaultValue(Elevant.Domain.Enumerations.ChargeMarkSource.Agent).HasSentinel((Elevant.Domain.Enumerations.ChargeMarkSource)(-1));
            builder.Property(charge => charge.AdjustmentReason).HasMaxLength(500);
            builder.Property(charge => charge.AppliedAt).HasPrecision(3);
            builder.Property(charge => charge.RemovedAt).HasPrecision(3);
            builder.HasIndex(charge => new { charge.OperationServiceId, charge.RemovedAt });
            Reference<OperationService, OperationServiceCharge>(builder, charge => charge.OperationServiceId);
            Reference<ChargeDefinition, OperationServiceCharge>(builder, charge => charge.ChargeDefinitionId);
            Reference<RampAgent, OperationServiceCharge>(builder, charge => charge.AppliedByRampAgentId);
            Reference<RampAgent, OperationServiceCharge>(builder, charge => charge.RemovedByRampAgentId);
            Reference<ApplicationUser, OperationServiceCharge>(builder, charge => charge.AppliedByAccountId);
            Reference<ApplicationUser, OperationServiceCharge>(builder, charge => charge.RemovedByAccountId);
        });

        modelBuilder.Entity<GroundTimeAllowance>(builder =>
        {
            builder.ToTable("ground_time_allowances", "commercial", table =>
                table.HasCheckConstraint("ck_ground_time_allowance_minutes", "[allowed_minutes] BETWEEN 15 AND 720"));
            builder.Property(allowance => allowance.SizeCategory).HasConversion<string>().HasMaxLength(16);
            builder.HasIndex(allowance => allowance.SizeCategory).IsUnique();
            Reference<ApplicationUser, GroundTimeAllowance>(builder, allowance => allowance.UpdatedByAccountId);
        });

        modelBuilder.Entity<FinanceHoliday>(builder =>
        {
            builder.ToTable("finance_holidays", "commercial", table =>
                table.HasCheckConstraint("ck_finance_holiday_removal",
                    "([removed_at] IS NULL AND [removed_by_account_id] IS NULL) OR " +
                    "([removed_at] IS NOT NULL AND [removed_by_account_id] IS NOT NULL)"));
            builder.Property(holiday => holiday.Name).HasMaxLength(120).IsRequired();
            builder.Property(holiday => holiday.RemovedAt).HasPrecision(3);
            builder.HasIndex(holiday => holiday.Date).IsUnique().HasFilter("[removed_at] IS NULL")
                .HasDatabaseName("ux_finance_holidays_active_date");
            Reference<ApplicationUser, FinanceHoliday>(builder, holiday => holiday.CreatedByAccountId);
            Reference<ApplicationUser, FinanceHoliday>(builder, holiday => holiday.RemovedByAccountId);
        });
    }

    private static void TariffVersionChecks(TableBuilder table, string prefix)
    {
        table.HasCheckConstraint($"ck_{prefix}_version_currency", "LEN([currency_code]) = 3");
        table.HasCheckConstraint($"ck_{prefix}_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
        table.HasCheckConstraint($"ck_{prefix}_version_published",
            "([status] = N'Draft' AND [published_at] IS NULL) OR ([status] <> N'Draft' AND [published_at] IS NOT NULL)");
    }

    private static void ConfigureTariffVersion<TVersion>(EntityTypeBuilder<TVersion> builder,
        Expression<Func<TVersion, Elevant.Domain.Enumerations.TariffVersionStatus>> status,
        Expression<Func<TVersion, string>> currency, Expression<Func<TVersion, DateOnly>> validFrom,
        Expression<Func<TVersion, DateOnly?>> validTo, Expression<Func<TVersion, string?>> note,
        Expression<Func<TVersion, DateTimeOffset?>> publishedAt)
        where TVersion : class
    {
        builder.Property(status).HasConversion<string>().HasMaxLength(16);
        builder.Property(currency).HasColumnType("char(3)").IsRequired();
        builder.Property(validFrom).HasColumnType("date");
        builder.Property(validTo).HasColumnType("date");
        builder.Property(note).HasMaxLength(500);
        builder.Property(publishedAt).HasPrecision(3);
    }

    private static void Reference<TPrincipal, TDependent>(EntityTypeBuilder<TDependent> builder,
        Expression<Func<TDependent, object?>> foreignKey)
        where TPrincipal : class
        where TDependent : class =>
        builder.HasOne<TPrincipal>().WithMany().HasForeignKey(foreignKey).OnDelete(DeleteBehavior.NoAction);
}
