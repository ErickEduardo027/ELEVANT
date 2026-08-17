using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence.Configurations;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence;

/// <summary>EF Core boundary for Elevant-owned data.</summary>
public sealed class ElevantDbContext(DbContextOptions<ElevantDbContext> options)
    : IdentityDbContext<ApplicationUser, ApplicationRole, long>(options)
{
    public DbSet<DatabaseInstance> DatabaseInstances => Set<DatabaseInstance>();

    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    public DbSet<Organization> Organizations => Set<Organization>();

    public DbSet<Person> Persons => Set<Person>();

    public DbSet<OrganizationMembership> OrganizationMemberships => Set<OrganizationMembership>();

    public DbSet<PermissionDefinition> Permissions => Set<PermissionDefinition>();

    public DbSet<AccountStationScope> AccountStationScopes => Set<AccountStationScope>();

    public DbSet<Airline> Airlines => Set<Airline>();

    public DbSet<Airport> Airports => Set<Airport>();

    public DbSet<Station> Stations => Set<Station>();

    public DbSet<Terminal> Terminals => Set<Terminal>();

    public DbSet<Stand> Stands => Set<Stand>();

    public DbSet<ServiceDefinition> ServiceDefinitions => Set<ServiceDefinition>();

    public DbSet<EquipmentType> EquipmentTypes => Set<EquipmentType>();

    public DbSet<AircraftType> AircraftTypes => Set<AircraftType>();

    public DbSet<OperationalPosition> OperationalPositions => Set<OperationalPosition>();

    public DbSet<RampAgent> RampAgents => Set<RampAgent>();

    public DbSet<QualificationCycle> QualificationCycles => Set<QualificationCycle>();

    public DbSet<AirportPermitCycle> AirportPermitCycles => Set<AirportPermitCycle>();

    public DbSet<ShiftAssignment> ShiftAssignments => Set<ShiftAssignment>();

    public DbSet<AvailabilityRequest> AvailabilityRequests => Set<AvailabilityRequest>();

    public DbSet<CoverageRequirement> CoverageRequirements => Set<CoverageRequirement>();

    public DbSet<ServiceRequest> ServiceRequests => Set<ServiceRequest>();

    public DbSet<Contract> Contracts => Set<Contract>();

    public DbSet<ContractVersion> ContractVersions => Set<ContractVersion>();

    public DbSet<ContractServiceRate> ContractServiceRates => Set<ContractServiceRate>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        base.OnModelCreating(builder);
        builder.ConfigurePlatform();
        builder.ConfigureIdentityAndReference();
        builder.ConfigureWorkforceAndCommercial();
        builder.ApplyConfigurationsFromAssembly(typeof(ElevantDbContext).Assembly);
        builder.ConfigureElevantConventions();
    }
}
