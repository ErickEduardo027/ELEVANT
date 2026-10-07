using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class DepartmentGovernanceConfiguration
{
    public static void ConfigureDepartmentGovernance(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AccessProfile>(builder =>
        {
            builder.ToTable("access_profiles", "iam");
            builder.Property(profile => profile.Department).HasConversion<string>().HasMaxLength(32);
            builder.Property(profile => profile.Name).HasMaxLength(120);
            builder.Property(profile => profile.Description).HasMaxLength(500);
            builder.Property(profile => profile.IsActive).HasDefaultValue(true);
            builder.HasIndex(profile => profile.PublicId).IsUnique();
            builder.HasIndex(profile => new { profile.Department, profile.Name })
                .HasFilter("[is_active] = CAST(1 AS bit)")
                .IsUnique();
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(profile => profile.CreatedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<AccessProfileGrant>(builder =>
        {
            builder.ToTable("access_profile_grants", "iam");
            builder.HasKey(grant => new { grant.AccessProfileId, grant.PermissionCode });
            builder.Property(grant => grant.PermissionCode).HasMaxLength(120);
            builder.HasOne<AccessProfile>().WithMany().HasForeignKey(grant => grant.AccessProfileId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<DepartmentAssignment>(builder =>
        {
            builder.ToTable("department_assignments", "iam", table =>
                table.HasCheckConstraint("ck_department_assignment_kind",
                    "([kind] = N'SuperAdministrator' AND [department] IS NULL AND [access_profile_id] IS NULL) OR " +
                    "([kind] = N'Administrator' AND [department] IS NOT NULL AND [access_profile_id] IS NULL) OR " +
                    "([kind] = N'Member' AND [department] IS NOT NULL)"));
            builder.Property(assignment => assignment.Kind).HasConversion<string>().HasMaxLength(32);
            builder.Property(assignment => assignment.Department).HasConversion<string>().HasMaxLength(32);
            builder.HasIndex(assignment => assignment.PublicId).IsUnique();
            builder.HasIndex(assignment => assignment.AccountId).IsUnique();
            // Exactly one super administrator can exist; the database enforces it.
            builder.HasIndex(assignment => assignment.Kind)
                .HasDatabaseName("ux_department_assignments_single_super_administrator")
                .HasFilter("[kind] = N'SuperAdministrator'")
                .IsUnique();
            builder.HasIndex(assignment => new { assignment.Department, assignment.Kind });
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(assignment => assignment.AccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<AccessProfile>().WithMany().HasForeignKey(assignment => assignment.AccessProfileId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<AccountPermissionGrant>(builder =>
        {
            builder.ToTable("account_permission_grants", "iam");
            builder.HasKey(grant => new { grant.AccountId, grant.PermissionCode });
            builder.Property(grant => grant.PermissionCode).HasMaxLength(120);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(grant => grant.AccountId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<UserAccessRequest>(builder =>
        {
            builder.ToTable("user_access_requests", "iam", table =>
            {
                table.HasCheckConstraint("ck_user_access_request_decision",
                    "([status] = N'Pending' AND [decided_at] IS NULL AND [decided_by_account_id] IS NULL AND [created_account_id] IS NULL) OR " +
                    "([status] IN (N'Rejected', N'Cancelled') AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NULL) OR " +
                    "([status] = N'Validated' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NOT NULL)");
                table.HasCheckConstraint("ck_user_access_request_ramp_agent",
                    "[kind] <> N'RampAgent' OR ([department] = N'Operations' AND [employee_number] IS NOT NULL AND [category] IS NOT NULL AND [hire_date] IS NOT NULL)");
            });
            builder.Property(request => request.Department).HasConversion<string>().HasMaxLength(32);
            builder.Property(request => request.Kind).HasConversion<string>().HasMaxLength(32);
            builder.Property(request => request.Status).HasConversion<string>().HasMaxLength(16);
            builder.Property(request => request.RequestedAt).HasPrecision(3);
            builder.Property(request => request.DecidedAt).HasPrecision(3);
            builder.Property(request => request.FirstName).HasMaxLength(100);
            builder.Property(request => request.LastName).HasMaxLength(100);
            builder.Property(request => request.Email).HasMaxLength(256);
            builder.Property(request => request.AvatarMediaUrl).HasMaxLength(512);
            builder.Property(request => request.EmployeeNumber).HasMaxLength(32);
            builder.Property(request => request.Category).HasMaxLength(64);
            builder.Property(request => request.HireDate).HasColumnType("date");
            builder.Property(request => request.DecisionReason).HasMaxLength(500);
            builder.HasIndex(request => request.PublicId).IsUnique();
            builder.HasIndex(request => request.Email).HasFilter("[status] = N'Pending'").IsUnique();
            builder.HasIndex(request => new { request.Status, request.Department });
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(request => request.RequestedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(request => request.DecidedByAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(request => request.CreatedAccountId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<AccessProfile>().WithMany().HasForeignKey(request => request.AccessProfileId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<RampAgent>().WithMany().HasForeignKey(request => request.SupervisorRampAgentId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<UserAccessRequestGrant>(builder =>
        {
            builder.ToTable("user_access_request_grants", "iam");
            builder.HasKey(grant => new { grant.UserAccessRequestId, grant.PermissionCode });
            builder.Property(grant => grant.PermissionCode).HasMaxLength(120);
            builder.HasOne<UserAccessRequest>().WithMany().HasForeignKey(grant => grant.UserAccessRequestId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<UserAccessRequestStation>(builder =>
        {
            builder.ToTable("user_access_request_stations", "iam");
            builder.HasKey(item => new { item.UserAccessRequestId, item.StationId });
            builder.HasOne<UserAccessRequest>().WithMany().HasForeignKey(item => item.UserAccessRequestId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Station>().WithMany().HasForeignKey(item => item.StationId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<UserAccessRequestTerminal>(builder =>
        {
            builder.ToTable("user_access_request_terminals", "iam");
            builder.HasKey(item => new { item.UserAccessRequestId, item.TerminalId });
            builder.HasOne<UserAccessRequest>().WithMany().HasForeignKey(item => item.UserAccessRequestId)
                .OnDelete(DeleteBehavior.NoAction);
            builder.HasOne<Terminal>().WithMany().HasForeignKey(item => item.TerminalId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}
