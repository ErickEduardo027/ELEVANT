using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class IdentityReferenceConfiguration
{
    public static void ConfigureIdentityAndReference(this ModelBuilder modelBuilder)
    {
        ConfigureIdentity(modelBuilder);
        ConfigureOrganizations(modelBuilder);
        ConfigureReferenceCatalogs(modelBuilder);
    }

    private static void ConfigureIdentity(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ApplicationUser>(builder =>
        {
            builder.ToTable("accounts", "iam");
            builder.Property(account => account.PublicId).HasDefaultValueSql("NEWSEQUENTIALID()");
            builder.Property(account => account.Status).HasConversion<string>().HasMaxLength(32);
            builder.Property(account => account.InvitationStatus).HasConversion<string>().HasMaxLength(32);
            builder.Property(account => account.MustChangePassword).HasDefaultValue(false);
            builder.Property(account => account.InvitationSentAt).HasPrecision(3);
            builder.Property(account => account.LastLoginAt).HasPrecision(3);
            builder.Property(account => account.CreatedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()");
            builder.Property(account => account.UpdatedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()");
            builder.Property(account => account.RowVersion).IsRowVersion();
            builder.HasIndex(account => account.PublicId).IsUnique();
            builder.HasIndex(account => account.PersonId).IsUnique();
            builder.HasIndex(account => account.NormalizedUserName)
                .HasDatabaseName("ux_accounts_normalized_user_name")
                .HasFilter("[normalized_user_name] IS NOT NULL")
                .IsUnique();
            builder.HasIndex(account => account.NormalizedEmail)
                .HasDatabaseName("ux_accounts_normalized_email")
                .HasFilter("[normalized_email] IS NOT NULL")
                .IsUnique();
            builder.HasOne(account => account.Person)
                .WithOne()
                .HasForeignKey<ApplicationUser>(account => account.PersonId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<ApplicationRole>(builder =>
        {
            builder.ToTable("roles", "iam");
            builder.Property(role => role.PublicId).HasDefaultValueSql("NEWSEQUENTIALID()");
            builder.Property(role => role.Portal).HasConversion<string>().HasMaxLength(32);
            builder.Property(role => role.UserType).HasMaxLength(64).IsRequired();
            builder.Property(role => role.Description).HasMaxLength(500);
            builder.Property(role => role.IsActive).HasDefaultValue(true);
            builder.Property(role => role.IsCustom).HasDefaultValue(false);
            builder.HasIndex(role => role.PublicId).IsUnique();
            builder.HasIndex(role => role.NormalizedName)
                .HasDatabaseName("ux_roles_normalized_name")
                .HasFilter("[normalized_name] IS NOT NULL")
                .IsUnique();
        });

        modelBuilder.Entity<IdentityUserRole<long>>(builder =>
        {
            builder.ToTable("account_roles", "iam");
            foreach (var foreignKey in builder.Metadata.GetForeignKeys())
            {
                foreignKey.DeleteBehavior = DeleteBehavior.NoAction;
            }
        });
        modelBuilder.Entity<IdentityUserClaim<long>>().ToTable("account_claims", "iam");
        modelBuilder.Entity<IdentityUserLogin<long>>().ToTable("account_logins", "iam");
        modelBuilder.Entity<IdentityUserToken<long>>().ToTable("account_tokens", "iam");
        modelBuilder.Entity<IdentityRoleClaim<long>>().ToTable("role_claims", "iam");

        foreach (var entityType in new[]
                 {
                     typeof(IdentityUserClaim<long>),
                     typeof(IdentityUserLogin<long>),
                     typeof(IdentityUserToken<long>),
                     typeof(IdentityRoleClaim<long>),
                 })
        {
            foreach (var foreignKey in modelBuilder.Entity(entityType).Metadata.GetForeignKeys())
            {
                foreignKey.DeleteBehavior = DeleteBehavior.NoAction;
            }
        }
    }

    private static void ConfigureOrganizations(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Organization>(builder =>
        {
            builder.ToTable("organizations", "iam");
            builder.Property(organization => organization.Code).HasMaxLength(32).IsRequired();
            builder.Property(organization => organization.LegalName).HasMaxLength(200).IsRequired();
            builder.Property(organization => organization.DisplayName).HasMaxLength(120).IsRequired();
            builder.Property(organization => organization.Type).HasConversion<string>().HasMaxLength(32);
            builder.Property(organization => organization.Status).HasConversion<string>().HasMaxLength(16);
            builder.HasIndex(organization => organization.Code).IsUnique();
        });

        modelBuilder.Entity<Person>(builder =>
        {
            builder.ToTable("persons", "iam");
            builder.Property(person => person.FirstName).HasMaxLength(100).IsRequired();
            builder.Property(person => person.LastName).HasMaxLength(100).IsRequired();
            builder.Property(person => person.PrimaryEmail).HasMaxLength(256);
            builder.Property(person => person.PhoneNumber).HasMaxLength(32);
            builder.Property(person => person.AvatarMediaUrl).HasMaxLength(512);
            builder.Property(person => person.IdentificationType).HasMaxLength(32).IsRequired();
            builder.Property(person => person.IdentificationNumber).HasMaxLength(64).IsRequired();
            builder.HasIndex(person => new { person.IdentificationType, person.IdentificationNumber }).IsUnique();
            builder.HasIndex(person => person.PrimaryEmail)
                .HasFilter("[primary_email] IS NOT NULL")
                .IsUnique();
        });

        modelBuilder.Entity<OrganizationMembership>(builder =>
        {
            builder.ToTable("organization_memberships", "iam", table =>
                table.HasCheckConstraint("ck_membership_dates", "[valid_to] IS NULL OR [valid_from] IS NULL OR [valid_to] >= [valid_from]"));
            builder.Property(membership => membership.Kind).HasConversion<string>().HasMaxLength(32);
            builder.Property(membership => membership.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(membership => membership.JobTitle).HasMaxLength(120);
            builder.HasIndex(membership => new { membership.AccountId, membership.OrganizationId }).IsUnique();
            builder.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(membership => membership.AccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Organization>()
                .WithMany()
                .HasForeignKey(membership => membership.OrganizationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PermissionDefinition>(builder =>
        {
            builder.ToTable("permissions", "iam");
            builder.Property(permission => permission.Id).UseIdentityColumn();
            builder.Property(permission => permission.PublicId).HasDefaultValueSql("NEWSEQUENTIALID()");
            builder.Property(permission => permission.Code).HasMaxLength(120).IsRequired();
            builder.Property(permission => permission.Name).HasMaxLength(120).IsRequired();
            builder.Property(permission => permission.Description).HasMaxLength(500);
            builder.HasIndex(permission => permission.PublicId).IsUnique();
            builder.HasIndex(permission => permission.Code).IsUnique();
        });

        modelBuilder.Entity<RolePermissionGrant>(builder =>
        {
            builder.ToTable("role_permissions", "iam");
            builder.HasKey(rolePermission => new { rolePermission.RoleId, rolePermission.PermissionId });
            builder.HasOne<ApplicationRole>()
                .WithMany()
                .HasForeignKey(rolePermission => rolePermission.RoleId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<PermissionDefinition>()
                .WithMany()
                .HasForeignKey(rolePermission => rolePermission.PermissionId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<AccountStationScope>(builder =>
        {
            builder.ToTable("account_station_scopes", "iam", table =>
                table.HasCheckConstraint("ck_account_station_scope_dates", "[revoked_at] IS NULL OR [revoked_at] >= [granted_at]"));
            builder.Property(scope => scope.Id).UseIdentityColumn();
            builder.Property(scope => scope.GrantedAt).HasPrecision(3);
            builder.Property(scope => scope.RevokedAt).HasPrecision(3);
            builder.HasIndex(scope => new { scope.AccountId, scope.StationId })
                .HasFilter("[revoked_at] IS NULL")
                .IsUnique();
            builder.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(scope => scope.AccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>()
                .WithMany()
                .HasForeignKey(scope => scope.StationId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureReferenceCatalogs(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Airline>(builder =>
        {
            builder.ToTable("airlines", "ref", table =>
            {
                table.HasCheckConstraint("ck_airline_iata", "LEN([iata_code]) = 2");
                table.HasCheckConstraint("ck_airline_icao", "LEN([icao_code]) = 3");
            });
            builder.Property(airline => airline.IataCode).HasColumnType("char(2)").IsRequired();
            builder.Property(airline => airline.IcaoCode).HasColumnType("char(3)").IsRequired();
            builder.Property(airline => airline.Name).HasMaxLength(160).IsRequired();
            builder.HasIndex(airline => airline.OrganizationId).IsUnique();
            builder.HasIndex(airline => airline.IataCode).IsUnique();
            builder.HasIndex(airline => airline.IcaoCode).IsUnique();
            builder.HasOne<Organization>()
                .WithMany()
                .HasForeignKey(airline => airline.OrganizationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Airport>(builder =>
        {
            builder.ToTable("airports", "ref", table =>
            {
                table.HasCheckConstraint("ck_airport_iata", "LEN([iata_code]) = 3");
                table.HasCheckConstraint("ck_airport_icao", "LEN([icao_code]) = 4");
                table.HasCheckConstraint("ck_airport_country", "LEN([country_code]) = 2");
                table.HasCheckConstraint("ck_airport_latitude", "[latitude] IS NULL OR [latitude] BETWEEN -90 AND 90");
                table.HasCheckConstraint("ck_airport_longitude", "[longitude] IS NULL OR [longitude] BETWEEN -180 AND 180");
            });
            builder.Property(airport => airport.IataCode).HasColumnType("char(3)").IsRequired();
            builder.Property(airport => airport.IcaoCode).HasColumnType("char(4)").IsRequired();
            builder.Property(airport => airport.CountryCode).HasColumnType("char(2)").IsRequired();
            builder.Property(airport => airport.Name).HasMaxLength(180).IsRequired();
            builder.Property(airport => airport.City).HasMaxLength(120).IsRequired();
            builder.Property(airport => airport.IanaTimeZone).HasMaxLength(64);
            builder.Property(airport => airport.Latitude).HasPrecision(9, 6);
            builder.Property(airport => airport.Longitude).HasPrecision(9, 6);
            builder.HasIndex(airport => airport.IataCode).IsUnique();
            builder.HasIndex(airport => airport.IcaoCode).IsUnique();
        });

        modelBuilder.Entity<Station>(builder =>
        {
            builder.ToTable("stations", "ref");
            builder.Property(station => station.Code).HasMaxLength(16).IsRequired();
            builder.Property(station => station.Name).HasMaxLength(120).IsRequired();
            builder.Property(station => station.IanaTimeZone).HasMaxLength(64).IsRequired();
            builder.HasIndex(station => station.Code).IsUnique();
            builder.HasIndex(station => station.AirportId).IsUnique();
            builder.HasOne<Airport>()
                .WithMany()
                .HasForeignKey(station => station.AirportId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Terminal>(builder =>
        {
            builder.ToTable("terminals", "ref");
            builder.Property(terminal => terminal.Code).HasMaxLength(16).IsRequired();
            builder.Property(terminal => terminal.Name).HasMaxLength(120).IsRequired();
            builder.HasIndex(terminal => new { terminal.StationId, terminal.Code }).IsUnique();
            builder.HasOne<Station>()
                .WithMany()
                .HasForeignKey(terminal => terminal.StationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Stand>(builder =>
        {
            builder.ToTable("stands", "ref", table =>
            {
                table.HasCheckConstraint("ck_stands_latitude", "[latitude] IS NULL OR [latitude] BETWEEN -90 AND 90");
                table.HasCheckConstraint("ck_stands_longitude", "[longitude] IS NULL OR [longitude] BETWEEN -180 AND 180");
                table.HasCheckConstraint("ck_stands_location_pair", "([latitude] IS NULL AND [longitude] IS NULL) OR ([latitude] IS NOT NULL AND [longitude] IS NOT NULL)");
            });
            builder.Property(stand => stand.Latitude).HasPrecision(9, 6);
            builder.Property(stand => stand.Longitude).HasPrecision(9, 6);
            builder.Property(stand => stand.LocatedAt).HasPrecision(3);
            builder.Property(stand => stand.Code).HasMaxLength(24).IsRequired();
            builder.Property(stand => stand.StandType).HasMaxLength(32);
            builder.HasIndex(stand => new { stand.StationId, stand.Code }).IsUnique();
            builder.HasOne<Station>()
                .WithMany()
                .HasForeignKey(stand => stand.StationId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Terminal>()
                .WithMany()
                .HasForeignKey(stand => stand.TerminalId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        ConfigureCodeCatalog<ServiceDefinition>(modelBuilder, "service_definitions", builder =>
        {
            builder.Property(service => service.Description).HasMaxLength(500);
            builder.Property(service => service.ImageUrl).HasMaxLength(512);
            builder.Property(service => service.VideoUrl).HasMaxLength(512);
            builder.Property(service => service.DefaultBillingUnit).HasMaxLength(32).IsRequired();
        });

        ConfigureCodeCatalog<EquipmentType>(modelBuilder, "equipment_types", _ => { });

        modelBuilder.Entity<AircraftType>(builder =>
        {
            builder.ToTable("aircraft_types", "ref", table =>
                table.HasCheckConstraint("ck_aircraft_type_icao", "LEN([icao_code]) = 4"));
            builder.Property(type => type.IcaoCode).HasColumnType("char(4)").IsRequired();
            builder.Property(type => type.IataCode).HasColumnType("char(3)");
            builder.Property(type => type.Manufacturer).HasMaxLength(100).IsRequired();
            builder.Property(type => type.Model).HasMaxLength(100).IsRequired();
            builder.HasIndex(type => type.IcaoCode).IsUnique();
        });

        ConfigureCodeCatalog<OperationalPosition>(modelBuilder, "operational_positions", builder =>
        {
            builder.HasOne<EquipmentType>()
                .WithMany()
                .HasForeignKey(position => position.RequiredEquipmentTypeId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }

    private static void ConfigureCodeCatalog<TEntity>(
        ModelBuilder modelBuilder,
        string tableName,
        Action<Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity>> configure)
        where TEntity : Elevant.Domain.Entities.AuditableEntity
    {
        var builder = modelBuilder.Entity<TEntity>();
        builder.ToTable(tableName, "ref");
        builder.Property("Code").HasMaxLength(40).IsRequired();
        builder.Property("Name").HasMaxLength(160).IsRequired();
        builder.HasIndex("Code").IsUnique();
        configure(builder);
    }
}
