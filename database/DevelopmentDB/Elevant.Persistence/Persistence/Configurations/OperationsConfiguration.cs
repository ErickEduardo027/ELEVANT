using System.Linq.Expressions;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class OperationsConfiguration
{
    public static void ConfigureOperations(this ModelBuilder modelBuilder)
    {
        ConfigureTurnaround(modelBuilder);
        ConfigureExecution(modelBuilder);
        ConfigureChecklistsAndReview(modelBuilder);
    }

    private static void ConfigureTurnaround(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<EquipmentAsset>(builder =>
        {
            builder.ToTable("equipment_assets", "ref");
            builder.Property(asset => asset.AssetCode).HasMaxLength(40).IsRequired();
            builder.Property(asset => asset.SerialNumber).HasMaxLength(100);
            builder.Property(asset => asset.Status).HasMaxLength(32).IsRequired();
            builder.HasIndex(asset => new { asset.StationId, asset.AssetCode }).IsUnique();
            builder.HasIndex(asset => asset.SerialNumber)
                .HasFilter("[serial_number] IS NOT NULL")
                .IsUnique();
            AddReference<EquipmentType, EquipmentAsset>(builder, asset => asset.EquipmentTypeId);
            AddReference<Station, EquipmentAsset>(builder, asset => asset.StationId);
        });

        modelBuilder.Entity<Turnaround>(builder =>
        {
            builder.ToTable("turnarounds", "ops");
            builder.Property(turnaround => turnaround.OperationCode).HasMaxLength(40).IsRequired();
            builder.Property(turnaround => turnaround.OperationDate).HasColumnType("date");
            builder.Property(turnaround => turnaround.AircraftRegistration).HasMaxLength(16);
            builder.Property(turnaround => turnaround.CurrentStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(turnaround => turnaround.Source).HasConversion<string>().HasMaxLength(24);
            builder.Property(turnaround => turnaround.ExternalProvider).HasMaxLength(64);
            builder.Property(turnaround => turnaround.ExternalReference).HasMaxLength(128);
            builder.Property(turnaround => turnaround.SourceObservedAt).HasPrecision(3);
            builder.HasIndex(turnaround => turnaround.OperationCode).IsUnique();
            builder.HasIndex(turnaround => new
            {
                turnaround.StationId,
                turnaround.OperationDate,
                turnaround.CurrentStatus,
            });
            builder.HasIndex(turnaround => new { turnaround.AirlineId, turnaround.OperationDate });
            builder.HasIndex(turnaround => new { turnaround.ExternalProvider, turnaround.ExternalReference })
                .HasFilter("[external_provider] IS NOT NULL AND [external_reference] IS NOT NULL")
                .IsUnique();
            AddReference<Airline, Turnaround>(builder, turnaround => turnaround.AirlineId);
            AddReference<Station, Turnaround>(builder, turnaround => turnaround.StationId);
            AddReference<AircraftType, Turnaround>(builder, turnaround => turnaround.AircraftTypeId);
        });

        modelBuilder.Entity<FlightLeg>(builder =>
        {
            builder.ToTable("flight_legs", "ops", table =>
                table.HasCheckConstraint("ck_flight_leg_route", "[origin_airport_id] <> [destination_airport_id]"));
            builder.Property(leg => leg.Direction).HasConversion<string>().HasMaxLength(16);
            builder.Property(leg => leg.FlightNumber).HasMaxLength(16).IsRequired();
            builder.Property(leg => leg.ScheduledAt).HasPrecision(3);
            builder.Property(leg => leg.EstimatedAt).HasPrecision(3);
            builder.Property(leg => leg.ActualAt).HasPrecision(3);
            builder.Property(leg => leg.Source).HasConversion<string>().HasMaxLength(24);
            builder.Property(leg => leg.ExternalReference).HasMaxLength(128);
            builder.Property(leg => leg.SourceObservedAt).HasPrecision(3);
            builder.HasIndex(leg => new { leg.TurnaroundId, leg.Direction }).IsUnique();
            builder.HasIndex(leg => new { leg.FlightNumber, leg.ScheduledAt });
            AddReference<Turnaround, FlightLeg>(builder, leg => leg.TurnaroundId);
            AddReference<Airport, FlightLeg>(builder, leg => leg.OriginAirportId);
            AddReference<Airport, FlightLeg>(builder, leg => leg.DestinationAirportId);
        });

        modelBuilder.Entity<TurnaroundStatusEvent>(builder =>
        {
            builder.ToTable("turnaround_status_events", "ops");
            builder.Property(statusEvent => statusEvent.Id).UseIdentityColumn();
            builder.Property(statusEvent => statusEvent.FromStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.ToStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.OccurredAt).HasPrecision(3);
            builder.Property(statusEvent => statusEvent.Source).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.Reason).HasMaxLength(1000);
            builder.HasIndex(statusEvent => new { statusEvent.TurnaroundId, statusEvent.OccurredAt });
            AddReference<Turnaround, TurnaroundStatusEvent>(builder, statusEvent => statusEvent.TurnaroundId);
            AddReference<ApplicationUser, TurnaroundStatusEvent>(builder, statusEvent => statusEvent.ActorAccountId);
        });

        modelBuilder.Entity<StandAssignment>(builder =>
        {
            builder.ToTable("stand_assignments", "ops", table =>
                table.HasCheckConstraint("ck_stand_assignment_dates", "[assigned_to] IS NULL OR [assigned_to] >= [assigned_from]"));
            builder.Property(assignment => assignment.AssignedFrom).HasPrecision(3);
            builder.Property(assignment => assignment.AssignedTo).HasPrecision(3);
            builder.Property(assignment => assignment.Reason).HasMaxLength(500);
            builder.HasIndex(assignment => assignment.TurnaroundId)
                .HasFilter("[assigned_to] IS NULL")
                .IsUnique();
            builder.HasIndex(assignment => new { assignment.StandId, assignment.AssignedFrom, assignment.AssignedTo });
            AddReference<Turnaround, StandAssignment>(builder, assignment => assignment.TurnaroundId);
            AddReference<Stand, StandAssignment>(builder, assignment => assignment.StandId);
            AddReference<ApplicationUser, StandAssignment>(builder, assignment => assignment.AssignedByAccountId);
        });
    }

    private static void ConfigureExecution(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<GroundOperation>(builder =>
        {
            builder.ToTable("ground_operations", "ops", table =>
            {
                table.HasCheckConstraint("ck_ground_operation_planned_dates", "[planned_end_at] IS NULL OR [planned_start_at] IS NULL OR [planned_end_at] >= [planned_start_at]");
                table.HasCheckConstraint("ck_ground_operation_actual_dates", "[actual_end_at] IS NULL OR [actual_start_at] IS NULL OR [actual_end_at] >= [actual_start_at]");
            });
            builder.Property(operation => operation.CurrentStatus).HasConversion<string>().HasMaxLength(24);
            SetPrecision(builder, operation => operation.PlannedStartAt);
            SetPrecision(builder, operation => operation.PlannedEndAt);
            SetPrecision(builder, operation => operation.ActualStartAt);
            SetPrecision(builder, operation => operation.ActualEndAt);
            builder.HasIndex(operation => operation.TurnaroundId).IsUnique();
            builder.HasIndex(operation => operation.CurrentStatus);
            AddReference<Turnaround, GroundOperation>(builder, operation => operation.TurnaroundId);
        });

        modelBuilder.Entity<GroundOperationStatusEvent>(builder =>
        {
            builder.ToTable("ground_operation_status_events", "ops");
            builder.Property(statusEvent => statusEvent.Id).UseIdentityColumn();
            builder.Property(statusEvent => statusEvent.FromStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.ToStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.OccurredAt).HasPrecision(3);
            builder.Property(statusEvent => statusEvent.Reason).HasMaxLength(1000);
            builder.HasIndex(statusEvent => new { statusEvent.GroundOperationId, statusEvent.OccurredAt });
            AddReference<GroundOperation, GroundOperationStatusEvent>(builder, statusEvent => statusEvent.GroundOperationId);
            AddReference<ApplicationUser, GroundOperationStatusEvent>(builder, statusEvent => statusEvent.ActorAccountId);
        });

        modelBuilder.Entity<OperationAgentAssignment>(builder =>
        {
            builder.ToTable("operation_agent_assignments", "ops", table =>
                table.HasCheckConstraint("ck_agent_assignment_dates", "[released_at] IS NULL OR [released_at] >= [assigned_at]"));
            builder.Property(assignment => assignment.AssignmentRole).HasMaxLength(64).IsRequired();
            builder.Property(assignment => assignment.AssignedAt).HasPrecision(3);
            builder.Property(assignment => assignment.ReleasedAt).HasPrecision(3);
            builder.HasIndex(assignment => new { assignment.GroundOperationId, assignment.RampAgentId })
                .HasFilter("[released_at] IS NULL")
                .IsUnique();
            builder.HasIndex(assignment => new { assignment.RampAgentId, assignment.AssignedAt, assignment.ReleasedAt });
            AddReference<GroundOperation, OperationAgentAssignment>(builder, assignment => assignment.GroundOperationId);
            AddReference<RampAgent, OperationAgentAssignment>(builder, assignment => assignment.RampAgentId);
            AddReference<OperationalPosition, OperationAgentAssignment>(builder, assignment => assignment.OperationalPositionId);
            AddReference<ApplicationUser, OperationAgentAssignment>(builder, assignment => assignment.AssignedByAccountId);
        });

        modelBuilder.Entity<OperationAttendanceContributionRevision>(builder =>
        {
            builder.ToTable("operation_attendance_contribution_revisions", "ops", table =>
            {
                table.HasCheckConstraint("ck_attendance_contribution_revision_positive", "[revision_number] > 0");
                table.HasCheckConstraint("ck_attendance_contribution_lane", "[lane] IN ('Occ', 'RampAgent')");
                table.HasCheckConstraint("ck_attendance_contribution_observation", "[observed_start_at] IS NOT NULL OR [observed_end_at] IS NOT NULL OR [incident_note] IS NOT NULL");
                table.HasCheckConstraint("ck_attendance_contribution_chronology", "[observed_start_at] IS NULL OR [observed_end_at] IS NULL OR [observed_end_at] >= [observed_start_at]");
            });
            builder.Property(item => item.Lane).HasMaxLength(16).IsRequired();
            builder.Property(item => item.PayloadSha256).HasMaxLength(64).IsRequired();
            builder.Property(item => item.IncidentNote).HasMaxLength(2000);
            builder.Property(item => item.ObservedStartAt).HasPrecision(3);
            builder.Property(item => item.ObservedEndAt).HasPrecision(3);
            builder.Property(item => item.RecordedAt).HasPrecision(3);
            builder.HasIndex(item => new { item.OperationAgentAssignmentId, item.Lane,
                item.RevisionNumber }).IsUnique();
            builder.HasIndex(item => new { item.AuthorAccountId, item.IdempotencyKey }).IsUnique();
            AddReference<OperationAgentAssignment, OperationAttendanceContributionRevision>(builder,
                item => item.OperationAgentAssignmentId);
            AddReference<ApplicationUser, OperationAttendanceContributionRevision>(builder,
                item => item.AuthorAccountId);
        });

        modelBuilder.Entity<OperationAttendanceValidation>(builder =>
        {
            builder.ToTable("operation_attendance_validations", "ops", table =>
            {
                table.HasCheckConstraint("ck_attendance_validation_sources",
                    "[start_source] IN ('Occ', 'RampAgent') AND [end_source] IN ('Occ', 'RampAgent')");
                table.HasCheckConstraint("ck_attendance_validation_chronology",
                    "[end_at] >= [start_at]");
            });
            builder.Property(item => item.StartSource).HasMaxLength(16).IsRequired();
            builder.Property(item => item.EndSource).HasMaxLength(16).IsRequired();
            builder.Property(item => item.Reason).HasMaxLength(1000);
            builder.Property(item => item.PayloadSha256).HasMaxLength(64).IsRequired();
            builder.Property(item => item.StartAt).HasPrecision(3);
            builder.Property(item => item.EndAt).HasPrecision(3);
            builder.Property(item => item.ValidatedAt).HasPrecision(3);
            builder.HasIndex(item => new
            {
                item.OperationAgentAssignmentId,
                item.OccContributionRevisionId,
                item.RampAgentContributionRevisionId,
            }).IsUnique();
            builder.HasIndex(item => new { item.ValidatedByAccountId,
                item.IdempotencyKey }).IsUnique();
            AddReference<OperationAgentAssignment, OperationAttendanceValidation>(builder,
                item => item.OperationAgentAssignmentId);
            AddReference<OperationAttendanceContributionRevision, OperationAttendanceValidation>(
                builder, item => item.OccContributionRevisionId);
            AddReference<OperationAttendanceContributionRevision, OperationAttendanceValidation>(
                builder, item => item.RampAgentContributionRevisionId);
            AddReference<ApplicationUser, OperationAttendanceValidation>(builder,
                item => item.ValidatedByAccountId);
        });

        modelBuilder.Entity<OperationEquipmentAssignment>(builder =>
        {
            builder.ToTable("operation_equipment_assignments", "ops", table =>
                table.HasCheckConstraint("ck_equipment_assignment_dates", "[released_at] IS NULL OR [released_at] >= [assigned_at]"));
            builder.Property(assignment => assignment.AssignedAt).HasPrecision(3);
            builder.Property(assignment => assignment.ReleasedAt).HasPrecision(3);
            builder.HasIndex(assignment => assignment.EquipmentAssetId)
                .HasFilter("[released_at] IS NULL")
                .IsUnique();
            builder.HasIndex(assignment => new { assignment.GroundOperationId, assignment.EquipmentAssetId });
            AddReference<GroundOperation, OperationEquipmentAssignment>(builder, assignment => assignment.GroundOperationId);
            AddReference<EquipmentAsset, OperationEquipmentAssignment>(builder, assignment => assignment.EquipmentAssetId);
            AddReference<ApplicationUser, OperationEquipmentAssignment>(builder, assignment => assignment.AssignedByAccountId);
        });

        modelBuilder.Entity<OperationService>(builder =>
        {
            builder.ToTable("operation_services", "ops", table =>
            {
                table.HasCheckConstraint("ck_operation_service_line", "[line_number] > 0");
                table.HasCheckConstraint("ck_operation_service_quantities", "[contracted_quantity] >= 0 AND [executed_quantity] >= 0");
                table.HasCheckConstraint("ck_operation_service_price", "[unit_price_snapshot] IS NULL OR [unit_price_snapshot] >= 0");
                table.HasCheckConstraint("ck_operation_service_currency", "[currency_code_snapshot] IS NULL OR LEN([currency_code_snapshot]) = 3");
            });
            builder.Property(service => service.ContractedQuantity).HasPrecision(18, 4);
            builder.Property(service => service.ExecutedQuantity).HasPrecision(18, 4);
            builder.Property(service => service.BillingUnitSnapshot).HasMaxLength(32).IsRequired();
            builder.Property(service => service.UnitPriceSnapshot).HasPrecision(19, 4);
            builder.Property(service => service.CurrencyCodeSnapshot).HasColumnType("char(3)");
            builder.Property(service => service.CurrentStatus).HasConversion<string>().HasMaxLength(24);
            builder.HasIndex(service => new { service.GroundOperationId, service.LineNumber }).IsUnique();
            builder.HasIndex(service => new { service.GroundOperationId, service.CurrentStatus });
            AddReference<GroundOperation, OperationService>(builder, service => service.GroundOperationId);
            AddReference<ServiceDefinition, OperationService>(builder, service => service.ServiceDefinitionId);
            AddReference<ContractServiceRate, OperationService>(builder, service => service.ContractServiceRateId);
        });

        modelBuilder.Entity<OperationServiceStatusEvent>(builder =>
        {
            builder.ToTable("operation_service_status_events", "ops");
            builder.Property(statusEvent => statusEvent.Id).UseIdentityColumn();
            builder.Property(statusEvent => statusEvent.FromStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.ToStatus).HasConversion<string>().HasMaxLength(24);
            builder.Property(statusEvent => statusEvent.OccurredAt).HasPrecision(3);
            builder.Property(statusEvent => statusEvent.Note).HasMaxLength(1000);
            builder.HasIndex(statusEvent => new { statusEvent.OperationServiceId, statusEvent.OccurredAt });
            AddReference<OperationService, OperationServiceStatusEvent>(builder, statusEvent => statusEvent.OperationServiceId);
            AddReference<RampAgent, OperationServiceStatusEvent>(builder, statusEvent => statusEvent.RampAgentId);
        });

        modelBuilder.Entity<OperationMilestone>(builder =>
        {
            builder.ToTable("operation_milestones", "ops");
            builder.Property(milestone => milestone.Code).HasMaxLength(48).IsRequired();
            SetPrecision(builder, milestone => milestone.PlannedAt);
            SetPrecision(builder, milestone => milestone.EstimatedAt);
            SetPrecision(builder, milestone => milestone.ActualAt);
            builder.Property(milestone => milestone.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(milestone => milestone.Source).HasConversion<string>().HasMaxLength(24);
            builder.HasIndex(milestone => new { milestone.GroundOperationId, milestone.Code }).IsUnique();
            AddReference<GroundOperation, OperationMilestone>(builder, milestone => milestone.GroundOperationId);
        });

        modelBuilder.Entity<OperationalServiceRequest>(builder =>
        {
            builder.ToTable("operational_service_requests", "ops", table =>
                table.HasCheckConstraint("ck_operational_request_resolution", "[resolved_at] IS NULL OR [resolved_at] >= [requested_at]"));
            builder.Property(request => request.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(request => request.RequestedServiceName).HasMaxLength(160).IsRequired();
            builder.Property(request => request.Description).HasMaxLength(2000).IsRequired();
            builder.Property(request => request.RequestedAt).HasPrecision(3);
            builder.Property(request => request.NeededAt).HasPrecision(3);
            builder.Property(request => request.ResolvedAt).HasPrecision(3);
            builder.Property(request => request.ResolutionNote).HasMaxLength(1000);
            builder.HasIndex(request => new { request.AirlineId, request.Status, request.RequestedAt });
            builder.HasIndex(request => new { request.StationId, request.Status, request.NeededAt });
            AddReference<Airline, OperationalServiceRequest>(builder, request => request.AirlineId);
            AddReference<Station, OperationalServiceRequest>(builder, request => request.StationId);
            AddReference<Turnaround, OperationalServiceRequest>(builder, request => request.TurnaroundId);
            AddReference<ServiceDefinition, OperationalServiceRequest>(builder, request => request.ServiceDefinitionId);
            AddReference<ApplicationUser, OperationalServiceRequest>(builder, request => request.RequestedByAccountId);
            AddReference<ApplicationUser, OperationalServiceRequest>(builder, request => request.ResolvedByAccountId);
        });
    }

    private static void ConfigureChecklistsAndReview(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ChecklistTemplate>(builder =>
        {
            builder.ToTable("checklist_templates", "ops");
            builder.Property(template => template.Code).HasMaxLength(40).IsRequired();
            builder.Property(template => template.Name).HasMaxLength(160).IsRequired();
            builder.HasIndex(template => template.Code).IsUnique();
        });

        modelBuilder.Entity<ChecklistTemplateVersion>(builder =>
        {
            builder.ToTable("checklist_template_versions", "ops", table =>
            {
                table.HasCheckConstraint("ck_checklist_template_version", "[version_number] > 0");
                table.HasCheckConstraint("ck_checklist_template_dates", "[effective_to] IS NULL OR [effective_to] >= [effective_from]");
            });
            builder.Property(version => version.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(version => version.EffectiveFrom).HasColumnType("date");
            builder.Property(version => version.EffectiveTo).HasColumnType("date");
            builder.Property(version => version.PublishedAt).HasPrecision(3);
            builder.HasIndex(version => new { version.ChecklistTemplateId, version.VersionNumber }).IsUnique();
            AddReference<ChecklistTemplate, ChecklistTemplateVersion>(builder, version => version.ChecklistTemplateId);
            AddReference<ApplicationUser, ChecklistTemplateVersion>(builder, version => version.PublishedByAccountId);
        });

        modelBuilder.Entity<ChecklistTemplateItem>(builder =>
        {
            builder.ToTable("checklist_template_items", "ops", table =>
                table.HasCheckConstraint("ck_checklist_item_sort", "[sort_order] >= 0"));
            builder.Property(item => item.ItemCode).HasMaxLength(48).IsRequired();
            builder.Property(item => item.SectionName).HasMaxLength(120).IsRequired();
            builder.Property(item => item.Label).HasMaxLength(500).IsRequired();
            builder.HasIndex(item => new { item.ChecklistTemplateVersionId, item.ItemCode }).IsUnique();
            builder.HasIndex(item => new { item.ChecklistTemplateVersionId, item.SortOrder }).IsUnique();
            AddReference<ChecklistTemplateVersion, ChecklistTemplateItem>(builder, item => item.ChecklistTemplateVersionId);
        });

        modelBuilder.Entity<OperationChecklist>(builder =>
        {
            builder.ToTable("operation_checklists", "ops", table =>
            {
                table.HasCheckConstraint("ck_operation_checklist_dates", "[submitted_at] IS NULL OR [started_at] IS NULL OR [submitted_at] >= [started_at]");
                table.HasCheckConstraint("ck_operation_checklist_revision", "[revision_number] > 0");
            });
            builder.Property(checklist => checklist.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(checklist => checklist.StartedAt).HasPrecision(3);
            builder.Property(checklist => checklist.SubmittedAt).HasPrecision(3);
            builder.HasIndex(checklist => new { checklist.GroundOperationId, checklist.ChecklistTemplateVersionId, checklist.RevisionNumber }).IsUnique();
            AddReference<GroundOperation, OperationChecklist>(builder, checklist => checklist.GroundOperationId);
            AddReference<ChecklistTemplateVersion, OperationChecklist>(builder, checklist => checklist.ChecklistTemplateVersionId);
            AddReference<RampAgent, OperationChecklist>(builder, checklist => checklist.SubmittedByRampAgentId);
        });

        modelBuilder.Entity<ChecklistAnswer>(builder =>
        {
            builder.ToTable("checklist_answers", "ops");
            builder.Property(answer => answer.Value).HasConversion<string>().HasMaxLength(24);
            builder.Property(answer => answer.Note).HasMaxLength(1000);
            builder.Property(answer => answer.AnsweredAt).HasPrecision(3);
            builder.HasIndex(answer => new { answer.OperationChecklistId, answer.ChecklistTemplateItemId }).IsUnique();
            AddReference<OperationChecklist, ChecklistAnswer>(builder, answer => answer.OperationChecklistId);
            AddReference<ChecklistTemplateItem, ChecklistAnswer>(builder, answer => answer.ChecklistTemplateItemId);
            AddReference<RampAgent, ChecklistAnswer>(builder, answer => answer.RampAgentId);
        });

        modelBuilder.Entity<Incident>(builder =>
        {
            builder.ToTable("incidents", "ops", table =>
            {
                table.HasCheckConstraint("ck_incident_reported", "[reported_at] >= [occurred_at]");
                table.HasCheckConstraint("ck_incident_resolved", "[resolved_at] IS NULL OR [resolved_at] >= [reported_at]");
            });
            builder.Property(incident => incident.IncidentType).HasMaxLength(80).IsRequired();
            builder.Property(incident => incident.Severity).HasConversion<string>().HasMaxLength(16);
            builder.Property(incident => incident.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(incident => incident.Description).HasMaxLength(4000).IsRequired();
            builder.Property(incident => incident.OccurredAt).HasPrecision(3);
            builder.Property(incident => incident.ReportedAt).HasPrecision(3);
            builder.Property(incident => incident.ResolvedAt).HasPrecision(3);
            builder.Property(incident => incident.ResolutionNote).HasMaxLength(2000);
            builder.HasIndex(incident => new { incident.GroundOperationId, incident.Status, incident.ReportedAt });
            AddReference<GroundOperation, Incident>(builder, incident => incident.GroundOperationId);
            AddReference<RampAgent, Incident>(builder, incident => incident.ReportedByRampAgentId);
            AddReference<ApplicationUser, Incident>(builder, incident => incident.ResolvedByAccountId);
        });

        modelBuilder.Entity<OperationSubmission>(builder =>
        {
            builder.ToTable("operation_submissions", "ops", table =>
                table.HasCheckConstraint("ck_operation_submission_revision", "[revision_number] > 0"));
            builder.Property(submission => submission.Status).HasConversion<string>().HasMaxLength(24);
            builder.Property(submission => submission.SubmittedAt).HasPrecision(3);
            builder.Property(submission => submission.AgentNote).HasMaxLength(2000);
            builder.Property(submission => submission.EvidenceJson).HasColumnType("nvarchar(max)");
            builder.HasIndex(submission => new { submission.GroundOperationId, submission.RevisionNumber }).IsUnique();
            builder.HasIndex(submission => new { submission.Status, submission.SubmittedAt });
            AddReference<GroundOperation, OperationSubmission>(builder, submission => submission.GroundOperationId);
            AddReference<OperationChecklist, OperationSubmission>(builder, submission => submission.OperationChecklistId);
            AddReference<RampAgent, OperationSubmission>(builder, submission => submission.SubmittedByRampAgentId);
        });

        modelBuilder.Entity<ReviewDecision>(builder =>
        {
            builder.ToTable("review_decisions", "ops");
            builder.Property(decision => decision.Outcome).HasConversion<string>().HasMaxLength(16);
            builder.Property(decision => decision.DecidedAt).HasPrecision(3);
            builder.Property(decision => decision.Reason).HasMaxLength(2000);
            builder.HasIndex(decision => decision.OperationSubmissionId).IsUnique();
            AddReference<OperationSubmission, ReviewDecision>(builder, decision => decision.OperationSubmissionId);
            AddReference<ApplicationUser, ReviewDecision>(builder, decision => decision.ReviewerAccountId);
        });

        modelBuilder.Entity<OperationMessage>(builder =>
        {
            builder.ToTable("operation_messages", "ops", table =>
                table.HasCheckConstraint("ck_operation_message_content", "LEN([content]) BETWEEN 1 AND 2000"));
            builder.Property(message => message.SenderRole).HasMaxLength(16).IsRequired();
            builder.Property(message => message.Content).HasMaxLength(2000).IsRequired();
            builder.Property(message => message.SentAt).HasPrecision(3);
            builder.HasIndex(message => new { message.GroundOperationId, message.SentAt });
            builder.HasIndex(message => new { message.SenderAccountId, message.ClientMessageId }).IsUnique();
            AddReference<GroundOperation, OperationMessage>(builder, message => message.GroundOperationId);
            AddReference<ApplicationUser, OperationMessage>(builder, message => message.SenderAccountId);
            AddReference<MobileDevice, OperationMessage>(builder, message => message.MobileDeviceId);
        });

        modelBuilder.Entity<OperationalNotification>(builder =>
        {
            builder.ToTable("operational_notifications", "ops");
            builder.Property(notification => notification.Kind).HasMaxLength(40).IsRequired();
            builder.Property(notification => notification.OccurredAt).HasPrecision(3);
            builder.Property(notification => notification.ReadAt).HasPrecision(3);
            builder.HasIndex(notification => new { notification.RecipientAccountId, notification.OccurredAt });
            builder.HasIndex(notification => new { notification.RecipientAccountId, notification.Kind, notification.SourceId }).IsUnique();
            AddReference<ApplicationUser, OperationalNotification>(builder, notification => notification.RecipientAccountId);
            AddReference<Station, OperationalNotification>(builder, notification => notification.StationId);
            AddReference<GroundOperation, OperationalNotification>(builder, notification => notification.GroundOperationId);
        });
    }

    private static void AddReference<TPrincipal, TDependent>(
        EntityTypeBuilder<TDependent> builder,
        Expression<Func<TDependent, object?>> foreignKey)
        where TPrincipal : class
        where TDependent : class
    {
        builder.HasOne<TPrincipal>()
            .WithMany()
            .HasForeignKey(foreignKey)
            .OnDelete(DeleteBehavior.NoAction);
    }

    private static void SetPrecision<TEntity>(
        EntityTypeBuilder<TEntity> builder,
        Expression<Func<TEntity, DateTimeOffset?>> property)
        where TEntity : class => builder.Property(property).HasPrecision(3);
}
