using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class WorkforceCommercialConfiguration
{
    public static void ConfigureWorkforceAndCommercial(this ModelBuilder modelBuilder)
    {
        ConfigureWorkforce(modelBuilder);
        ConfigureCommercial(modelBuilder);
    }

    private static void ConfigureWorkforce(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RampAgent>(builder =>
        {
            builder.ToTable("ramp_agents", "hr");
            builder.Property(agent => agent.EmployeeNumber).HasMaxLength(32).IsRequired();
            builder.Property(agent => agent.Category).HasMaxLength(120).IsRequired();
            builder.Property(agent => agent.HireDate).HasColumnType("date");
            builder.HasIndex(agent => agent.PersonId).IsUnique();
            builder.HasIndex(agent => agent.EmployeeNumber).IsUnique();
            builder.HasOne<Person>()
                .WithMany()
                .HasForeignKey(agent => agent.PersonId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<RampAgent>()
                .WithMany()
                .HasForeignKey(agent => agent.SupervisorAgentId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<RampMobileAccessRequest>(builder =>
        {
            builder.ToTable("ramp_mobile_access_requests", "hr", table =>
                table.HasCheckConstraint("ck_ramp_mobile_access_request_decision",
                    "([status] = N'Pending' AND [decided_at] IS NULL AND [decided_by_account_id] IS NULL AND [created_account_id] IS NULL) OR " +
                    "([status] = N'Rejected' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NULL) OR " +
                    "([status] = N'Fulfilled' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NOT NULL)"));
            builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(item => item.RequestedAt).HasPrecision(3);
            builder.Property(item => item.DecidedAt).HasPrecision(3);
            builder.Property(item => item.DecisionReason).HasMaxLength(500);
            builder.HasIndex(item => item.RampAgentId).HasFilter("[status] = N'Pending'").IsUnique();
            builder.HasIndex(item => item.PublicId).IsUnique();
            builder.HasOne<RampAgent>().WithMany().HasForeignKey(item => item.RampAgentId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.RequestedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.DecidedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.CreatedAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<RampAgentStationScope>(builder =>
        {
            builder.ToTable("ramp_agent_station_scopes", "hr", table =>
                table.HasCheckConstraint("ck_agent_station_scope_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]"));
            builder.Property(scope => scope.Id).UseIdentityColumn();
            builder.Property(scope => scope.ValidFrom).HasColumnType("date");
            builder.Property(scope => scope.ValidTo).HasColumnType("date");
            builder.HasIndex(scope => new { scope.RampAgentId, scope.StationId, scope.ValidFrom }).IsUnique();
            builder.HasIndex(scope => new { scope.RampAgentId, scope.StationId })
                .HasFilter("[valid_to] IS NULL")
                .IsUnique();
            builder.HasOne<RampAgent>()
                .WithMany()
                .HasForeignKey(scope => scope.RampAgentId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>()
                .WithMany()
                .HasForeignKey(scope => scope.StationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<RampAgentTerminalScope>(builder =>
        {
            builder.ToTable("ramp_agent_terminal_scopes", "hr", table =>
                table.HasCheckConstraint("ck_agent_terminal_scope_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]"));
            builder.Property(scope => scope.Id).UseIdentityColumn();
            builder.Property(scope => scope.ValidFrom).HasColumnType("date");
            builder.Property(scope => scope.ValidTo).HasColumnType("date");
            builder.HasIndex(scope => new { scope.RampAgentId, scope.TerminalId, scope.ValidFrom }).IsUnique();
            builder.HasIndex(scope => new { scope.RampAgentId, scope.TerminalId })
                .HasFilter("[valid_to] IS NULL")
                .IsUnique();
            builder.HasOne<RampAgent>()
                .WithMany()
                .HasForeignKey(scope => scope.RampAgentId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Terminal>()
                .WithMany()
                .HasForeignKey(scope => scope.TerminalId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<QualificationCycle>(builder =>
        {
            builder.ToTable("qualification_cycles", "hr", table =>
            {
                table.HasCheckConstraint("ck_qualification_cycle_number", "[cycle_number] > 0");
                table.HasCheckConstraint("ck_qualification_dates", "[training_date] <= [obtained_on] AND [expires_on] >= [obtained_on]");
            });
            builder.Property(cycle => cycle.TrainingDate).HasColumnType("date");
            builder.Property(cycle => cycle.ObtainedOn).HasColumnType("date");
            builder.Property(cycle => cycle.ExpiresOn).HasColumnType("date");
            builder.Property(cycle => cycle.CertifyingEntity).HasMaxLength(160).IsRequired();
            builder.Property(cycle => cycle.InstructorName).HasMaxLength(160).IsRequired();
            builder.Property(cycle => cycle.Notes).HasMaxLength(1000);
            builder.HasIndex(cycle => new { cycle.RampAgentId, cycle.EquipmentTypeId, cycle.CycleNumber }).IsUnique();
            builder.HasIndex(cycle => new { cycle.RampAgentId, cycle.EquipmentTypeId })
                .HasFilter("[is_current] = 1")
                .IsUnique();
            builder.HasIndex(cycle => new { cycle.IsCurrent, cycle.ExpiresOn });
            builder.HasOne<RampAgent>()
                .WithMany()
                .HasForeignKey(cycle => cycle.RampAgentId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<EquipmentType>()
                .WithMany()
                .HasForeignKey(cycle => cycle.EquipmentTypeId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<QualificationCycle>()
                .WithMany()
                .HasForeignKey(cycle => cycle.SupersedesQualificationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<AirportPermitCycle>(builder =>
        {
            builder.ToTable("airport_permit_cycles", "hr", table =>
            {
                table.HasCheckConstraint("ck_permit_cycle_number", "[cycle_number] > 0");
                table.HasCheckConstraint("ck_permit_dates", "[expires_on] >= [issued_on]");
            });
            builder.Property(cycle => cycle.DocumentType).HasConversion<string>().HasMaxLength(32);
            builder.Property(cycle => cycle.DocumentNumber).HasMaxLength(64).IsRequired();
            builder.Property(cycle => cycle.IssuedOn).HasColumnType("date");
            builder.Property(cycle => cycle.ExpiresOn).HasColumnType("date");
            builder.HasIndex(cycle => new { cycle.RampAgentId, cycle.DocumentType, cycle.CycleNumber }).IsUnique();
            builder.HasIndex(cycle => new { cycle.RampAgentId, cycle.DocumentType })
                .HasFilter("[is_current] = 1")
                .IsUnique();
            builder.HasIndex(cycle => new { cycle.IsCurrent, cycle.ExpiresOn });
            builder.HasOne<RampAgent>()
                .WithMany()
                .HasForeignKey(cycle => cycle.RampAgentId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<AirportPermitCycle>()
                .WithMany()
                .HasForeignKey(cycle => cycle.SupersedesPermitId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<ShiftAssignment>(builder =>
        {
            builder.ToTable("shift_assignments", "hr");
            builder.Property(shift => shift.WorkDate).HasColumnType("date");
            builder.Property(shift => shift.StartsAtLocal).HasColumnType("time(0)");
            builder.Property(shift => shift.EndsAtLocal).HasColumnType("time(0)");
            builder.Property(shift => shift.Block).HasConversion<string>().HasMaxLength(16);
            builder.Property(shift => shift.Notes).HasMaxLength(500);
            builder.HasIndex(shift => new { shift.RampAgentId, shift.WorkDate }).IsUnique();
            builder.HasIndex(shift => new { shift.StationId, shift.WorkDate, shift.Block });
            AddNoActionReference<RampAgent, ShiftAssignment>(builder, shift => shift.RampAgentId);
            AddNoActionReference<Station, ShiftAssignment>(builder, shift => shift.StationId);
            AddNoActionReference<Terminal, ShiftAssignment>(builder, shift => shift.TerminalId);
            AddNoActionReference<OperationalPosition, ShiftAssignment>(builder, shift => shift.OperationalPositionId);
        });

        modelBuilder.Entity<AvailabilityRequest>(builder =>
        {
            builder.ToTable("availability_requests", "hr", table =>
                table.HasCheckConstraint("ck_availability_dates", "[ends_on] >= [starts_on]"));
            builder.Property(request => request.StartsOn).HasColumnType("date");
            builder.Property(request => request.EndsOn).HasColumnType("date");
            builder.Property(request => request.Type).HasConversion<string>().HasMaxLength(24);
            builder.Property(request => request.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(request => request.Reason).HasMaxLength(1000).IsRequired();
            builder.Property(request => request.RequestedAt).HasPrecision(3);
            builder.Property(request => request.ResolvedAt).HasPrecision(3);
            builder.Property(request => request.ResolutionNote).HasMaxLength(1000);
            builder.HasIndex(request => new { request.RampAgentId, request.Status, request.StartsOn });
            AddNoActionReference<RampAgent, AvailabilityRequest>(builder, request => request.RampAgentId);
            AddNoActionReference<ApplicationUser, AvailabilityRequest>(builder, request => request.ResolvedByAccountId);
        });

        modelBuilder.Entity<CoverageRequirement>(builder =>
        {
            builder.ToTable("coverage_requirements", "hr", table =>
            {
                table.HasCheckConstraint("ck_coverage_dates", "[effective_to] IS NULL OR [effective_to] >= [effective_from]");
                table.HasCheckConstraint("ck_coverage_required_count", "[required_agent_count] > 0");
            });
            builder.Property(requirement => requirement.Block).HasConversion<string>().HasMaxLength(16);
            builder.Property(requirement => requirement.EffectiveFrom).HasColumnType("date");
            builder.Property(requirement => requirement.EffectiveTo).HasColumnType("date");
            builder.HasIndex(requirement => new
            {
                requirement.StationId,
                requirement.TerminalId,
                requirement.OperationalPositionId,
                requirement.Block,
                requirement.EffectiveFrom,
            }).IsUnique();
            AddNoActionReference<Station, CoverageRequirement>(builder, requirement => requirement.StationId);
            AddNoActionReference<Terminal, CoverageRequirement>(builder, requirement => requirement.TerminalId);
            AddNoActionReference<OperationalPosition, CoverageRequirement>(builder, requirement => requirement.OperationalPositionId);
        });
    }

    private static void ConfigureCommercial(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ServiceClosureRequest>(builder =>
        {
            builder.ToTable("service_closure_requests", "commercial", table =>
            {
                table.HasCheckConstraint("ck_service_closure_decision",
                    "([status] = N'Pending' AND [decided_at] IS NULL AND [decided_by_account_id] IS NULL AND [decision_reason] IS NULL) OR " +
                    "([status] = N'Approved' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL) OR " +
                    "([status] = N'Denied' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [decision_reason] IS NOT NULL AND LEN([decision_reason]) >= 10)");
                table.HasCheckConstraint("ck_service_closure_reopen",
                    "([reopened_at] IS NULL AND [reopened_by_account_id] IS NULL AND [reopen_reason] IS NULL) OR " +
                    "([status] = N'Approved' AND [reopened_at] IS NOT NULL AND [reopened_by_account_id] IS NOT NULL AND [reopen_reason] IS NOT NULL AND LEN([reopen_reason]) >= 10)");
            });
            builder.Property(item => item.ServiceNameSnapshot).HasMaxLength(160).IsRequired();
            builder.Property(item => item.Reason).HasMaxLength(1000).IsRequired();
            builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(item => item.RequestedAt).HasPrecision(3);
            builder.Property(item => item.DecidedAt).HasPrecision(3);
            builder.Property(item => item.DecisionReason).HasMaxLength(1000);
            builder.Property(item => item.ReopenedAt).HasPrecision(3);
            builder.Property(item => item.ReopenReason).HasMaxLength(1000);
            builder.HasIndex(item => item.ServiceDefinitionId)
                .HasFilter("[status] = N'Pending'").IsUnique();
            builder.HasIndex(item => item.PublicId).IsUnique();
            builder.HasOne<ServiceDefinition>().WithMany()
                .HasForeignKey(item => item.ServiceDefinitionId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(item => item.RequestedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(item => item.DecidedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(item => item.ReopenedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<CommercialAirlineProfile>(builder =>
        {
            builder.ToTable("airline_profiles", "commercial");
            builder.Property(profile => profile.SourceName).HasMaxLength(160).IsRequired();
            builder.Property(profile => profile.DisplayName).HasMaxLength(160).IsRequired();
            builder.Property(profile => profile.LegalName).HasMaxLength(200);
            builder.Property(profile => profile.Region).HasMaxLength(64).IsRequired();
            builder.Property(profile => profile.CountryCode).HasMaxLength(2);
            builder.Property(profile => profile.IataCode).HasMaxLength(2);
            builder.Property(profile => profile.IcaoCode).HasMaxLength(3);
            builder.Property(profile => profile.LogoObjectKey).HasMaxLength(512);
            builder.Property(profile => profile.SourceUrl).HasMaxLength(512).IsRequired();
            builder.Property(profile => profile.VerifiedAt).HasPrecision(3);
            builder.Property(profile => profile.VerificationSourceUrl).HasMaxLength(512);
            builder.HasIndex(profile => profile.SourceName).IsUnique();
            // A verified profile is a real airline: its designators cannot belong to another one.
            builder.HasIndex(profile => profile.IataCode).IsUnique()
                .HasFilter("[iata_code] IS NOT NULL AND [verified_at] IS NOT NULL")
                .HasDatabaseName("ux_airline_profiles_verified_iata");
            builder.HasIndex(profile => profile.IcaoCode).IsUnique()
                .HasFilter("[icao_code] IS NOT NULL AND [verified_at] IS NOT NULL")
                .HasDatabaseName("ux_airline_profiles_verified_icao");
            AddNoActionReference<Airline, CommercialAirlineProfile>(builder,
                profile => profile.CanonicalAirlineId);
            AddNoActionReference<ApplicationUser, CommercialAirlineProfile>(builder,
                profile => profile.VerifiedByAccountId);
        });

        modelBuilder.Entity<ServiceRequest>(builder =>
        {
            builder.ToTable("service_requests", "commercial");
            builder.Property(request => request.RequestCode).HasMaxLength(32).IsRequired();
            builder.Property(request => request.RequestedAirlineName).HasMaxLength(160).IsRequired();
            builder.Property(request => request.AirlineLegalNameSnapshot).HasMaxLength(200);
            builder.Property(request => request.SubmissionHash).HasMaxLength(64);
            builder.Property(request => request.Type).HasConversion<string>().HasMaxLength(32);
            builder.Property(request => request.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(request => request.ContactName).HasMaxLength(160).IsRequired();
            builder.Property(request => request.ContactTitle).HasMaxLength(120);
            builder.Property(request => request.ContactEmail).HasMaxLength(256).IsRequired();
            builder.Property(request => request.ContactPhone).HasMaxLength(32);
            builder.Property(request => request.ContactNationalityCode).HasMaxLength(2);
            builder.Property(request => request.ContactAddress).HasMaxLength(250);
            builder.Property(request => request.ContactCountry).HasMaxLength(80);
            builder.Property(request => request.ContactProvince).HasMaxLength(80);
            builder.Property(request => request.ContactMunicipality).HasMaxLength(80);
            builder.Property(request => request.ContactDistrict).HasMaxLength(80);
            builder.Property(request => request.ContactDocumentType).HasMaxLength(24);
            builder.Property(request => request.ContactDocumentNumber).HasMaxLength(40);
            builder.Property(request => request.SubmittedAt).HasPrecision(3);
            builder.Property(request => request.ReviewedAt).HasPrecision(3);
            builder.Property(request => request.DecisionReason).HasMaxLength(1000);
            builder.Property(request => request.CancelledAt).HasPrecision(3);
            builder.HasIndex(request => request.RequestCode).IsUnique();
            builder.HasIndex(request => new { request.AirlineId, request.Status, request.SubmittedAt });
            AddNoActionReference<Airline, ServiceRequest>(builder, request => request.AirlineId);
            AddNoActionReference<CommercialAirlineProfile, ServiceRequest>(builder,
                request => request.AirlineProfileId);
            AddNoActionReference<ApplicationUser, ServiceRequest>(builder, request => request.ReviewedByAccountId);
            AddNoActionReference<ApplicationUser, ServiceRequest>(builder, request => request.ProvisionedAccountId);
        });

        modelBuilder.Entity<ServiceRequestStation>(builder =>
        {
            builder.ToTable("service_request_stations", "commercial");
            builder.HasKey(station => new { station.ServiceRequestId, station.StationId });
            AddNoActionReference<ServiceRequest, ServiceRequestStation>(builder, station => station.ServiceRequestId);
            AddNoActionReference<Station, ServiceRequestStation>(builder, station => station.StationId);
        });

        modelBuilder.Entity<ServiceRequestItem>(builder =>
        {
            builder.ToTable("service_request_items", "commercial", table =>
            {
                table.HasCheckConstraint("ck_service_request_item_dates", "[requested_to] IS NULL OR [requested_from] IS NULL OR [requested_to] >= [requested_from]");
                table.HasCheckConstraint("ck_service_request_item_quantity", "[estimated_quantity] IS NULL OR [estimated_quantity] > 0");
            });
            builder.Property(item => item.RequestedServiceName).HasMaxLength(160).IsRequired();
            builder.Property(item => item.EstimatedQuantity).HasPrecision(18, 4);
            builder.Property(item => item.RequestedUnit).HasMaxLength(32);
            builder.Property(item => item.RequestedFrom).HasColumnType("date");
            builder.Property(item => item.RequestedTo).HasColumnType("date");
            builder.Property(item => item.Notes).HasMaxLength(1000);
            builder.HasOne(item => item.ServiceRequest)
                .WithMany()
                .HasForeignKey(item => item.ServiceRequestId)
                .OnDelete(DeleteBehavior.NoAction);
            AddNoActionReference<ServiceDefinition, ServiceRequestItem>(builder, item => item.ServiceDefinitionId);
        });

        modelBuilder.Entity<ServiceRequestStatusEvent>(builder =>
        {
            builder.ToTable("service_request_status_events", "commercial");
            builder.Property(statusEvent => statusEvent.Id).UseIdentityColumn();
            builder.Property(statusEvent => statusEvent.FromStatus).HasConversion<string>().HasMaxLength(16);
            builder.Property(statusEvent => statusEvent.ToStatus).HasConversion<string>().HasMaxLength(16);
            builder.Property(statusEvent => statusEvent.OccurredAt).HasPrecision(3);
            builder.Property(statusEvent => statusEvent.Reason).HasMaxLength(1000);
            builder.HasIndex(statusEvent => new { statusEvent.ServiceRequestId, statusEvent.OccurredAt });
            AddNoActionReference<ServiceRequest, ServiceRequestStatusEvent>(builder, statusEvent => statusEvent.ServiceRequestId);
            AddNoActionReference<ApplicationUser, ServiceRequestStatusEvent>(builder, statusEvent => statusEvent.ActorAccountId);
        });

        modelBuilder.Entity<Contract>(builder =>
        {
            builder.ToTable("contracts", "commercial", table =>
                table.HasCheckConstraint("ck_contract_dates", "[terminated_on] IS NULL OR [signed_on] IS NULL OR [terminated_on] >= [signed_on]"));
            builder.Property(contract => contract.ContractCode).HasMaxLength(40).IsRequired();
            builder.Property(contract => contract.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(contract => contract.SignedOn).HasColumnType("date");
            builder.Property(contract => contract.TerminatedOn).HasColumnType("date");
            builder.HasIndex(contract => contract.ContractCode).IsUnique();
            builder.HasIndex(contract => new { contract.AirlineId, contract.Status });
            AddNoActionReference<Airline, Contract>(builder, contract => contract.AirlineId);
            AddNoActionReference<ServiceRequest, Contract>(builder, contract => contract.OriginatingServiceRequestId);
        });

        modelBuilder.Entity<ContractVersion>(builder =>
        {
            builder.ToTable("contract_versions", "commercial", table =>
            {
                table.HasCheckConstraint("ck_contract_version_number", "[version_number] > 0");
                table.HasCheckConstraint("ck_contract_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                table.HasCheckConstraint("ck_contract_version_currency", "LEN([currency_code]) = 3");
            });
            builder.Property(version => version.Status).HasConversion<string>().HasMaxLength(32);
            builder.Property(version => version.ValidFrom).HasColumnType("date");
            builder.Property(version => version.ValidTo).HasColumnType("date");
            builder.Property(version => version.CurrencyCode).HasColumnType("char(3)");
            builder.Property(version => version.Terms).HasColumnType("nvarchar(max)");
            builder.Property(version => version.ApprovedAt).HasPrecision(3);
            builder.HasIndex(version => new { version.ContractId, version.VersionNumber }).IsUnique();
            builder.HasIndex(version => new { version.ContractId, version.Status, version.ValidFrom });
            AddNoActionReference<Contract, ContractVersion>(builder, version => version.ContractId);
            AddNoActionReference<ApplicationUser, ContractVersion>(builder, version => version.ApprovedByAccountId);
        });

        modelBuilder.Entity<ContractVersionStation>(builder =>
        {
            builder.ToTable("contract_version_stations", "commercial");
            builder.HasKey(station => new { station.ContractVersionId, station.StationId });
            AddNoActionReference<ContractVersion, ContractVersionStation>(builder, station => station.ContractVersionId);
            AddNoActionReference<Station, ContractVersionStation>(builder, station => station.StationId);
        });

        modelBuilder.Entity<ContractDraftComment>(builder =>
        {
            builder.ToTable("contract_draft_comments", "commercial");
            builder.Property(comment => comment.Body).HasMaxLength(2000).IsRequired();
            builder.HasIndex(comment => new { comment.ContractVersionId, comment.CreatedAt });
            AddNoActionReference<ContractVersion, ContractDraftComment>(builder,
                comment => comment.ContractVersionId);
            AddNoActionReference<ApplicationUser, ContractDraftComment>(builder,
                comment => comment.AuthorAccountId);
        });

        modelBuilder.Entity<ContractServiceRate>(builder =>
        {
            builder.ToTable("contract_service_rates", "commercial", table =>
            {
                table.HasCheckConstraint("ck_contract_rate_price", "[unit_price] >= 0");
                table.HasCheckConstraint("ck_contract_rate_minimum", "[minimum_quantity] >= 0");
            });
            builder.Property(rate => rate.BillingUnit).HasMaxLength(32).IsRequired();
            builder.Property(rate => rate.UnitPrice).HasPrecision(19, 4);
            builder.Property(rate => rate.MinimumQuantity).HasPrecision(18, 4);
            builder.HasIndex(rate => new { rate.ContractVersionId, rate.ServiceDefinitionId }).IsUnique();
            AddNoActionReference<ContractVersion, ContractServiceRate>(builder, rate => rate.ContractVersionId);
            AddNoActionReference<ServiceDefinition, ContractServiceRate>(builder, rate => rate.ServiceDefinitionId);
        });

        modelBuilder.Entity<ContractStatusEvent>(builder =>
        {
            builder.ToTable("contract_status_events", "commercial");
            builder.Property(statusEvent => statusEvent.Id).UseIdentityColumn();
            builder.Property(statusEvent => statusEvent.FromStatus).HasConversion<string>().HasMaxLength(16);
            builder.Property(statusEvent => statusEvent.ToStatus).HasConversion<string>().HasMaxLength(16);
            builder.Property(statusEvent => statusEvent.OccurredAt).HasPrecision(3);
            builder.Property(statusEvent => statusEvent.Reason).HasMaxLength(1000);
            builder.HasIndex(statusEvent => new { statusEvent.ContractId, statusEvent.OccurredAt });
            AddNoActionReference<Contract, ContractStatusEvent>(builder, statusEvent => statusEvent.ContractId);
            AddNoActionReference<ApplicationUser, ContractStatusEvent>(builder, statusEvent => statusEvent.ActorAccountId);
        });
    }

    private static void AddNoActionReference<TPrincipal, TDependent>(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TDependent> builder,
        System.Linq.Expressions.Expression<Func<TDependent, object?>> foreignKey)
        where TPrincipal : class
        where TDependent : class
    {
        builder.HasOne<TPrincipal>()
            .WithMany()
            .HasForeignKey(foreignKey)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
