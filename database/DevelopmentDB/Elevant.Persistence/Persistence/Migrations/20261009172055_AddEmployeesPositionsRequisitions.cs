using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeesPositionsRequisitions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "category",
                schema: "iam",
                table: "user_access_requests",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AddColumn<long>(
                name: "employee_id",
                schema: "iam",
                table: "user_access_requests",
                type: "bigint",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "category",
                schema: "hr",
                table: "ramp_agents",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(64)",
                oldMaxLength: 64);

            migrationBuilder.AddColumn<string>(
                name: "department",
                schema: "audit",
                table: "audit_entries",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "job_positions",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    is_ramp_position = table.Column<bool>(type: "bit", nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    suggested_access_profile_id = table.Column<long>(type: "bigint", nullable: true),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_job_positions", x => x.id);
                    table.CheckConstraint("ck_job_position_ramp_department", "[is_ramp_position] = CAST(0 AS bit) OR [department] = N'Operations'");
                    table.ForeignKey(
                        name: "FK_job_positions_access_profiles_suggested_access_profile_id",
                        column: x => x.suggested_access_profile_id,
                        principalSchema: "iam",
                        principalTable: "access_profiles",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_job_positions_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "personnel_requisitions",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    job_position_id = table.Column<long>(type: "bigint", nullable: false),
                    quantity = table.Column<int>(type: "int", nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    desired_start_on = table.Column<DateOnly>(type: "date", nullable: true),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    requested_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    attended_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    closed_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    closed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    closure_reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_personnel_requisitions", x => x.id);
                    table.CheckConstraint("ck_personnel_requisition_closure", "([status] IN (N'Open', N'InProgress') AND [closed_at] IS NULL AND [closed_by_account_id] IS NULL) OR ([status] = N'Fulfilled' AND [closed_at] IS NOT NULL AND [closed_by_account_id] IS NOT NULL) OR ([status] IN (N'Rejected', N'Cancelled') AND [closed_at] IS NOT NULL AND [closed_by_account_id] IS NOT NULL AND [closure_reason] IS NOT NULL)");
                    table.CheckConstraint("ck_personnel_requisition_quantity", "[quantity] BETWEEN 1 AND 50");
                    table.ForeignKey(
                        name: "FK_personnel_requisitions_accounts_attended_by_account_id",
                        column: x => x.attended_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_personnel_requisitions_accounts_closed_by_account_id",
                        column: x => x.closed_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_personnel_requisitions_accounts_requested_by_account_id",
                        column: x => x.requested_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_personnel_requisitions_job_positions_job_position_id",
                        column: x => x.job_position_id,
                        principalSchema: "hr",
                        principalTable: "job_positions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_personnel_requisitions_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "employees",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    person_id = table.Column<long>(type: "bigint", nullable: false),
                    employee_number = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    job_position_id = table.Column<long>(type: "bigint", nullable: false),
                    hire_date = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    terminated_on = table.Column<DateOnly>(type: "date", nullable: true),
                    termination_reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    terminated_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    requisition_id = table.Column<long>(type: "bigint", nullable: true),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employees", x => x.id);
                    table.CheckConstraint("ck_employee_termination", "([status] = N'Active' AND [terminated_on] IS NULL AND [termination_reason] IS NULL AND [terminated_by_account_id] IS NULL) OR ([status] = N'Terminated' AND [terminated_on] IS NOT NULL AND [termination_reason] IS NOT NULL AND [terminated_by_account_id] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_employees_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employees_accounts_terminated_by_account_id",
                        column: x => x.terminated_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employees_job_positions_job_position_id",
                        column: x => x.job_position_id,
                        principalSchema: "hr",
                        principalTable: "job_positions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employees_personnel_requisitions_requisition_id",
                        column: x => x.requisition_id,
                        principalSchema: "hr",
                        principalTable: "personnel_requisitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employees_persons_person_id",
                        column: x => x.person_id,
                        principalSchema: "iam",
                        principalTable: "persons",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "employee_assignments",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    employee_id = table.Column<long>(type: "bigint", nullable: false),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    job_position_id = table.Column<long>(type: "bigint", nullable: false),
                    valid_from = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    valid_to = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    changed_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_assignments", x => x.id);
                    table.CheckConstraint("ck_employee_assignment_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.ForeignKey(
                        name: "FK_employee_assignments_accounts_changed_by_account_id",
                        column: x => x.changed_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_assignments_employees_employee_id",
                        column: x => x.employee_id,
                        principalSchema: "hr",
                        principalTable: "employees",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_assignments_job_positions_job_position_id",
                        column: x => x.job_position_id,
                        principalSchema: "hr",
                        principalTable: "job_positions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "employee_stations",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    employee_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_stations", x => x.id);
                    table.CheckConstraint("ck_employee_station_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.ForeignKey(
                        name: "FK_employee_stations_employees_employee_id",
                        column: x => x.employee_id,
                        principalSchema: "hr",
                        principalTable: "employees",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_stations_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "ux_user_access_requests_employee_pending",
                schema: "iam",
                table: "user_access_requests",
                column: "employee_id",
                unique: true,
                filter: "[status] = N'Pending' AND [employee_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_department_occurred_at",
                schema: "audit",
                table: "audit_entries",
                columns: new[] { "department", "occurred_at" },
                filter: "[department] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_employee_assignments_changed_by_account_id",
                schema: "hr",
                table: "employee_assignments",
                column: "changed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_assignments_department_valid_from",
                schema: "hr",
                table: "employee_assignments",
                columns: new[] { "department", "valid_from" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_assignments_job_position_id",
                schema: "hr",
                table: "employee_assignments",
                column: "job_position_id");

            migrationBuilder.CreateIndex(
                name: "ux_employee_assignments_open",
                schema: "hr",
                table: "employee_assignments",
                column: "employee_id",
                unique: true,
                filter: "[valid_to] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_employee_stations_station_id",
                schema: "hr",
                table: "employee_stations",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "ux_employee_stations_open",
                schema: "hr",
                table: "employee_stations",
                columns: new[] { "employee_id", "station_id" },
                unique: true,
                filter: "[valid_to] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_employees_created_by_account_id",
                schema: "hr",
                table: "employees",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_employees_department_status",
                schema: "hr",
                table: "employees",
                columns: new[] { "department", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_employees_employee_number",
                schema: "hr",
                table: "employees",
                column: "employee_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employees_job_position_id",
                schema: "hr",
                table: "employees",
                column: "job_position_id");

            migrationBuilder.CreateIndex(
                name: "IX_employees_person_id",
                schema: "hr",
                table: "employees",
                column: "person_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employees_public_id",
                schema: "hr",
                table: "employees",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employees_requisition_id",
                schema: "hr",
                table: "employees",
                column: "requisition_id");

            migrationBuilder.CreateIndex(
                name: "IX_employees_terminated_by_account_id",
                schema: "hr",
                table: "employees",
                column: "terminated_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_job_positions_created_by_account_id",
                schema: "hr",
                table: "job_positions",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_job_positions_department_name",
                schema: "hr",
                table: "job_positions",
                columns: new[] { "department", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_job_positions_public_id",
                schema: "hr",
                table: "job_positions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_job_positions_suggested_access_profile_id",
                schema: "hr",
                table: "job_positions",
                column: "suggested_access_profile_id");

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_attended_by_account_id",
                schema: "hr",
                table: "personnel_requisitions",
                column: "attended_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_closed_by_account_id",
                schema: "hr",
                table: "personnel_requisitions",
                column: "closed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_department_status",
                schema: "hr",
                table: "personnel_requisitions",
                columns: new[] { "department", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_job_position_id",
                schema: "hr",
                table: "personnel_requisitions",
                column: "job_position_id");

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_public_id",
                schema: "hr",
                table: "personnel_requisitions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_requested_by_account_id",
                schema: "hr",
                table: "personnel_requisitions",
                column: "requested_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_personnel_requisitions_station_id",
                schema: "hr",
                table: "personnel_requisitions",
                column: "station_id");

            migrationBuilder.AddForeignKey(
                name: "FK_user_access_requests_employees_employee_id",
                schema: "iam",
                table: "user_access_requests",
                column: "employee_id",
                principalSchema: "hr",
                principalTable: "employees",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                IF EXISTS (SELECT 1 FROM [hr].[employees] WHERE [status] <> N'Active')
                    OR EXISTS (SELECT 1 FROM [hr].[employee_assignments] GROUP BY [employee_id] HAVING COUNT(*) > 1)
                    OR EXISTS (SELECT 1 FROM [hr].[personnel_requisitions] WHERE [status] NOT IN (N'Open', N'InProgress'))
                    OR EXISTS (SELECT 1 FROM [iam].[user_access_requests] WHERE [employee_id] IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM [audit].[audit_entries] WHERE [department] IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM [hr].[ramp_agents] WHERE LEN([category]) > 64)
                    OR EXISTS (SELECT 1 FROM [iam].[user_access_requests] WHERE LEN([category]) > 64)
                BEGIN
                    THROW 51070, 'Employee history must be retained (terminations, transfers, closed requisitions, access decisions and department audit); restore a verified backup instead of reversing this migration.', 1;
                END
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_user_access_requests_employees_employee_id",
                schema: "iam",
                table: "user_access_requests");

            migrationBuilder.DropTable(
                name: "employee_assignments",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "employee_stations",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "employees",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "personnel_requisitions",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "job_positions",
                schema: "hr");

            migrationBuilder.DropIndex(
                name: "ux_user_access_requests_employee_pending",
                schema: "iam",
                table: "user_access_requests");

            migrationBuilder.DropIndex(
                name: "IX_audit_entries_department_occurred_at",
                schema: "audit",
                table: "audit_entries");

            migrationBuilder.DropColumn(
                name: "employee_id",
                schema: "iam",
                table: "user_access_requests");

            migrationBuilder.DropColumn(
                name: "department",
                schema: "audit",
                table: "audit_entries");

            migrationBuilder.AlterColumn<string>(
                name: "category",
                schema: "iam",
                table: "user_access_requests",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(120)",
                oldMaxLength: 120,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "category",
                schema: "hr",
                table: "ramp_agents",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(120)",
                oldMaxLength: 120);
        }
    }
}
