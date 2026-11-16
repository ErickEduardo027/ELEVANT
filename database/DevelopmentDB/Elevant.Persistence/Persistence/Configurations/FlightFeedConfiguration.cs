using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

/// <summary>Paid flight feed: usage ledger, sync lease, proposed legs and airlines seen (ADR-0028).</summary>
internal sealed class ProviderUsageEntryConfiguration : IEntityTypeConfiguration<ProviderUsageEntry>
{
    public void Configure(EntityTypeBuilder<ProviderUsageEntry> builder)
    {
        builder.ToTable("provider_usage_entries", "integration", table =>
        {
            table.HasCheckConstraint("ck_provider_usage_units", "[units] >= 0");
            table.HasCheckConstraint("ck_provider_usage_flights", "[flights_received] >= 0");
            table.HasCheckConstraint("ck_provider_usage_window",
                "([window_from] IS NULL AND [window_to] IS NULL) OR ([window_from] IS NOT NULL AND [window_to] > [window_from])");
        });
        builder.Property(entry => entry.Provider).HasMaxLength(32).IsRequired();
        builder.Property(entry => entry.Operation).HasMaxLength(48).IsRequired();
        builder.Property(entry => entry.Outcome).HasConversion<string>().HasMaxLength(24);
        builder.Property(entry => entry.Trigger).HasConversion<string>().HasMaxLength(16);
        builder.Property(entry => entry.WindowFrom).HasPrecision(3);
        builder.Property(entry => entry.WindowTo).HasPrecision(3);
        builder.Property(entry => entry.OccurredAt).HasPrecision(3);
        builder.HasIndex(entry => new { entry.Provider, entry.OccurredAt });
        builder.HasIndex(entry => new { entry.StationId, entry.OccurredAt });
        builder.HasOne<Station>().WithMany().HasForeignKey(entry => entry.StationId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(entry => entry.RequestedByAccountId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class ProviderSyncLeaseConfiguration : IEntityTypeConfiguration<ProviderSyncLease>
{
    public void Configure(EntityTypeBuilder<ProviderSyncLease> builder)
    {
        builder.ToTable("provider_sync_leases", "integration", table =>
        {
            table.HasCheckConstraint("ck_provider_lease_holder",
                "([holder_id] IS NULL AND [leased_until] IS NULL) OR ([holder_id] IS NOT NULL AND [leased_until] IS NOT NULL)");
            table.HasCheckConstraint("ck_provider_lease_failures", "[consecutive_failures] >= 0");
        });
        builder.Property(lease => lease.Provider).HasMaxLength(32).IsRequired();
        builder.Property(lease => lease.LeasedUntil).HasPrecision(3);
        builder.Property(lease => lease.PausedUntil).HasPrecision(3);
        builder.Property(lease => lease.LastError).HasMaxLength(200);
        builder.HasIndex(lease => lease.Provider).IsUnique();
    }
}

internal sealed class ExternalFlightProposalConfiguration : IEntityTypeConfiguration<ExternalFlightProposal>
{
    public void Configure(EntityTypeBuilder<ExternalFlightProposal> builder)
    {
        builder.ToTable("external_flight_proposals", "integration", table =>
        {
            table.HasCheckConstraint("ck_flight_proposal_decision",
                "([status] = 'Proposed' AND [decided_at] IS NULL) OR ([status] <> 'Proposed' AND [decided_at] IS NOT NULL)");
            table.HasCheckConstraint("ck_flight_proposal_confirmed",
                "[status] <> 'Confirmed' OR ([turnaround_id] IS NOT NULL AND [flight_leg_id] IS NOT NULL)");
            table.HasCheckConstraint("ck_flight_proposal_seen", "[last_seen_at] >= [first_seen_at]");
        });
        builder.Property(proposal => proposal.Provider).HasMaxLength(32).IsRequired();
        builder.Property(proposal => proposal.ExternalReference).HasMaxLength(96).IsRequired();
        builder.Property(proposal => proposal.Direction).HasConversion<string>().HasMaxLength(16);
        builder.Property(proposal => proposal.FlightNumber).HasMaxLength(16).IsRequired();
        builder.Property(proposal => proposal.CounterpartIata).HasMaxLength(3);
        builder.Property(proposal => proposal.CounterpartName).HasMaxLength(180);
        builder.Property(proposal => proposal.ScheduledAt).HasPrecision(3);
        builder.Property(proposal => proposal.RevisedAt).HasPrecision(3);
        builder.Property(proposal => proposal.RunwayAt).HasPrecision(3);
        builder.Property(proposal => proposal.ProviderStatus).HasMaxLength(32).IsRequired();
        builder.Property(proposal => proposal.AircraftRegistration).HasMaxLength(16);
        builder.Property(proposal => proposal.AircraftModel).HasMaxLength(80);
        builder.Property(proposal => proposal.Terminal).HasMaxLength(16);
        builder.Property(proposal => proposal.Gate).HasMaxLength(16);
        builder.Property(proposal => proposal.FirstSeenAt).HasPrecision(3);
        builder.Property(proposal => proposal.LastSeenAt).HasPrecision(3);
        builder.Property(proposal => proposal.Status).HasConversion<string>().HasMaxLength(16);
        builder.Property(proposal => proposal.DecidedAt).HasPrecision(3);
        builder.HasIndex(proposal => new { proposal.Provider, proposal.ExternalReference }).IsUnique();
        builder.HasIndex(proposal => new { proposal.StationId, proposal.OperationDate, proposal.Status });
        builder.HasIndex(proposal => proposal.TurnaroundId);
        builder.HasOne<Station>().WithMany().HasForeignKey(proposal => proposal.StationId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<Airline>().WithMany().HasForeignKey(proposal => proposal.AirlineId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<Airport>().WithMany().HasForeignKey(proposal => proposal.CounterpartAirportId)
            .OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<Turnaround>().WithMany().HasForeignKey(proposal => proposal.TurnaroundId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<FlightLeg>().WithMany().HasForeignKey(proposal => proposal.FlightLegId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(proposal => proposal.DecidedByAccountId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class AirlineRegistryEntryConfiguration : IEntityTypeConfiguration<AirlineRegistryEntry>
{
    public void Configure(EntityTypeBuilder<AirlineRegistryEntry> builder)
    {
        builder.ToTable("airline_registry_entries", "ref", table =>
        {
            table.HasCheckConstraint("ck_airline_registry_codes", "[iata_code] IS NOT NULL OR [icao_code] IS NOT NULL");
            table.HasCheckConstraint("ck_airline_registry_iata", "[iata_code] IS NULL OR LEN([iata_code]) = 2");
            table.HasCheckConstraint("ck_airline_registry_icao", "[icao_code] IS NULL OR LEN([icao_code]) = 3");
            table.HasCheckConstraint("ck_airline_registry_seen", "[last_seen_at] >= [first_seen_at]");
        });
        builder.Property(entry => entry.RegistryKey).HasMaxLength(8).IsRequired();
        builder.Property(entry => entry.IataCode).HasMaxLength(2);
        builder.Property(entry => entry.IcaoCode).HasMaxLength(3);
        builder.Property(entry => entry.Name).HasMaxLength(180).IsRequired();
        builder.Property(entry => entry.Source).HasMaxLength(32).IsRequired();
        builder.Property(entry => entry.FirstSeenAt).HasPrecision(3);
        builder.Property(entry => entry.LastSeenAt).HasPrecision(3);
        builder.HasIndex(entry => entry.RegistryKey).IsUnique();
        builder.HasIndex(entry => entry.IataCode);
        builder.HasIndex(entry => entry.IcaoCode);
    }
}
