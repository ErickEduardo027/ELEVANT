using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

/// <summary>Human Resources employees, job positions and personnel requisitions (ADR-0017).</summary>
internal static class EmployeeGovernanceConfiguration
{
    public static void ConfigureEmployeeGovernance(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<JobPosition>(builder =>
        {
            builder.ToTable("job_positions", "hr", table =>
                table.HasCheckConstraint("ck_job_position_ramp_department",
                    "[is_ramp_position] = CAST(0 AS bit) OR [department] = N'Operations'"));
            builder.Property(position => position.Department).HasConversion<string>().HasMaxLength(32);
            builder.Property(position => position.Name).HasMaxLength(120);
            builder.Property(position => position.Description).HasMaxLength(500);
            builder.Property(position => position.IsActive).HasDefaultValue(true);
            builder.HasIndex(position => position.PublicId).IsUnique();
            builder.HasIndex(position => new { position.Department, position.Name }).IsUnique();
            builder.HasOne<AccessProfile>().WithMany().HasForeignKey(position => position.SuggestedAccessProfileId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(position => position.CreatedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Employee>(builder =>
        {
            builder.ToTable("employees", "hr", table =>
                table.HasCheckConstraint("ck_employee_termination",
                    "([status] = N'Active' AND [terminated_on] IS NULL AND [termination_reason] IS NULL AND [terminated_by_account_id] IS NULL) OR " +
                    "([status] = N'Terminated' AND [terminated_on] IS NOT NULL AND [termination_reason] IS NOT NULL AND [terminated_by_account_id] IS NOT NULL)"));
            builder.Property(employee => employee.EmployeeNumber).HasMaxLength(32);
            builder.Property(employee => employee.Department).HasConversion<string>().HasMaxLength(32);
            builder.Property(employee => employee.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(employee => employee.HireDate).HasColumnType("date");
            builder.Property(employee => employee.TerminatedOn).HasColumnType("date");
            builder.Property(employee => employee.TerminationReason).HasMaxLength(500);
            builder.HasIndex(employee => employee.PublicId).IsUnique();
            builder.HasIndex(employee => employee.PersonId).IsUnique();
            builder.HasIndex(employee => employee.EmployeeNumber).IsUnique();
            builder.HasIndex(employee => new { employee.Department, employee.Status });
            builder.HasOne<Person>().WithMany().HasForeignKey(employee => employee.PersonId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<JobPosition>().WithMany().HasForeignKey(employee => employee.JobPositionId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<PersonnelRequisition>().WithMany().HasForeignKey(employee => employee.RequisitionId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(employee => employee.TerminatedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(employee => employee.CreatedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<EmployeeAssignment>(builder =>
        {
            builder.ToTable("employee_assignments", "hr", table =>
                table.HasCheckConstraint("ck_employee_assignment_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]"));
            builder.Property(assignment => assignment.Id).UseIdentityColumn();
            builder.Property(assignment => assignment.Department).HasConversion<string>().HasMaxLength(32);
            builder.Property(assignment => assignment.ValidFrom).HasPrecision(3);
            builder.Property(assignment => assignment.ValidTo).HasPrecision(3);
            builder.Property(assignment => assignment.Reason).HasMaxLength(500);
            builder.HasIndex(assignment => assignment.EmployeeId)
                .HasDatabaseName("ux_employee_assignments_open")
                .HasFilter("[valid_to] IS NULL")
                .IsUnique();
            builder.HasIndex(assignment => new { assignment.Department, assignment.ValidFrom });
            builder.HasOne<Employee>().WithMany().HasForeignKey(assignment => assignment.EmployeeId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<JobPosition>().WithMany().HasForeignKey(assignment => assignment.JobPositionId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(assignment => assignment.ChangedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<EmployeeStation>(builder =>
        {
            builder.ToTable("employee_stations", "hr", table =>
                table.HasCheckConstraint("ck_employee_station_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]"));
            builder.Property(item => item.Id).UseIdentityColumn();
            builder.Property(item => item.ValidFrom).HasColumnType("date");
            builder.Property(item => item.ValidTo).HasColumnType("date");
            builder.HasIndex(item => new { item.EmployeeId, item.StationId })
                .HasDatabaseName("ux_employee_stations_open")
                .HasFilter("[valid_to] IS NULL")
                .IsUnique();
            builder.HasOne<Employee>().WithMany().HasForeignKey(item => item.EmployeeId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>().WithMany().HasForeignKey(item => item.StationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<PersonnelRequisition>(builder =>
        {
            builder.ToTable("personnel_requisitions", "hr", table =>
            {
                table.HasCheckConstraint("ck_personnel_requisition_quantity", "[quantity] BETWEEN 1 AND 50");
                table.HasCheckConstraint("ck_personnel_requisition_closure",
                    "([status] IN (N'Open', N'InProgress') AND [closed_at] IS NULL AND [closed_by_account_id] IS NULL) OR " +
                    "([status] = N'Fulfilled' AND [closed_at] IS NOT NULL AND [closed_by_account_id] IS NOT NULL) OR " +
                    "([status] IN (N'Rejected', N'Cancelled') AND [closed_at] IS NOT NULL AND [closed_by_account_id] IS NOT NULL AND [closure_reason] IS NOT NULL)");
            });
            builder.Property(item => item.Department).HasConversion<string>().HasMaxLength(32);
            builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(item => item.Reason).HasMaxLength(1000);
            builder.Property(item => item.DesiredStartOn).HasColumnType("date");
            builder.Property(item => item.RequestedAt).HasPrecision(3);
            builder.Property(item => item.ClosedAt).HasPrecision(3);
            builder.Property(item => item.ClosureReason).HasMaxLength(500);
            builder.HasIndex(item => item.PublicId).IsUnique();
            builder.HasIndex(item => new { item.Department, item.Status });
            builder.HasOne<JobPosition>().WithMany().HasForeignKey(item => item.JobPositionId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>().WithMany().HasForeignKey(item => item.StationId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.RequestedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.AttendedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.ClosedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}
