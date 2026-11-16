using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDepartmentGovernance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "access_profiles",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_access_profiles", x => x.id);
                    table.ForeignKey(
                        name: "FK_access_profiles_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "account_permission_grants",
                schema: "iam",
                columns: table => new
                {
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    permission_code = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_permission_grants", x => new { x.account_id, x.permission_code });
                    table.ForeignKey(
                        name: "FK_account_permission_grants_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "access_profile_grants",
                schema: "iam",
                columns: table => new
                {
                    access_profile_id = table.Column<long>(type: "bigint", nullable: false),
                    permission_code = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_access_profile_grants", x => new { x.access_profile_id, x.permission_code });
                    table.ForeignKey(
                        name: "FK_access_profile_grants_access_profiles_access_profile_id",
                        column: x => x.access_profile_id,
                        principalSchema: "iam",
                        principalTable: "access_profiles",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "department_assignments",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    access_profile_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_department_assignments", x => x.id);
                    table.CheckConstraint("ck_department_assignment_kind", "([kind] = N'SuperAdministrator' AND [department] IS NULL AND [access_profile_id] IS NULL) OR ([kind] = N'Administrator' AND [department] IS NOT NULL AND [access_profile_id] IS NULL) OR ([kind] = N'Member' AND [department] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_department_assignments_access_profiles_access_profile_id",
                        column: x => x.access_profile_id,
                        principalSchema: "iam",
                        principalTable: "access_profiles",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_department_assignments_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "user_access_requests",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    requested_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    first_name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    last_name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    avatar_media_url = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    access_profile_id = table.Column<long>(type: "bigint", nullable: true),
                    employee_number = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    category = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    hire_date = table.Column<DateOnly>(type: "date", nullable: true),
                    supervisor_ramp_agent_id = table.Column<long>(type: "bigint", nullable: true),
                    decided_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    decision_reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    created_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_access_requests", x => x.id);
                    table.CheckConstraint("ck_user_access_request_decision", "([status] = N'Pending' AND [decided_at] IS NULL AND [decided_by_account_id] IS NULL AND [created_account_id] IS NULL) OR ([status] IN (N'Rejected', N'Cancelled') AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NULL) OR ([status] = N'Validated' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NOT NULL)");
                    table.CheckConstraint("ck_user_access_request_ramp_agent", "[kind] <> N'RampAgent' OR ([department] = N'Operations' AND [employee_number] IS NOT NULL AND [category] IS NOT NULL AND [hire_date] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_user_access_requests_access_profiles_access_profile_id",
                        column: x => x.access_profile_id,
                        principalSchema: "iam",
                        principalTable: "access_profiles",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_user_access_requests_accounts_created_account_id",
                        column: x => x.created_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_user_access_requests_accounts_decided_by_account_id",
                        column: x => x.decided_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_user_access_requests_accounts_requested_by_account_id",
                        column: x => x.requested_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_user_access_requests_ramp_agents_supervisor_ramp_agent_id",
                        column: x => x.supervisor_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "user_access_request_grants",
                schema: "iam",
                columns: table => new
                {
                    user_access_request_id = table.Column<long>(type: "bigint", nullable: false),
                    permission_code = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_access_request_grants", x => new { x.user_access_request_id, x.permission_code });
                    table.ForeignKey(
                        name: "FK_user_access_request_grants_user_access_requests_user_access_request_id",
                        column: x => x.user_access_request_id,
                        principalSchema: "iam",
                        principalTable: "user_access_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "user_access_request_stations",
                schema: "iam",
                columns: table => new
                {
                    user_access_request_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_access_request_stations", x => new { x.user_access_request_id, x.station_id });
                    table.ForeignKey(
                        name: "FK_user_access_request_stations_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_user_access_request_stations_user_access_requests_user_access_request_id",
                        column: x => x.user_access_request_id,
                        principalSchema: "iam",
                        principalTable: "user_access_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "user_access_request_terminals",
                schema: "iam",
                columns: table => new
                {
                    user_access_request_id = table.Column<long>(type: "bigint", nullable: false),
                    terminal_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_access_request_terminals", x => new { x.user_access_request_id, x.terminal_id });
                    table.ForeignKey(
                        name: "FK_user_access_request_terminals_terminals_terminal_id",
                        column: x => x.terminal_id,
                        principalSchema: "ref",
                        principalTable: "terminals",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_user_access_request_terminals_user_access_requests_user_access_request_id",
                        column: x => x.user_access_request_id,
                        principalSchema: "iam",
                        principalTable: "user_access_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_access_profiles_created_by_account_id",
                schema: "iam",
                table: "access_profiles",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_access_profiles_department_name",
                schema: "iam",
                table: "access_profiles",
                columns: new[] { "department", "name" },
                unique: true,
                filter: "[is_active] = CAST(1 AS bit)");

            migrationBuilder.CreateIndex(
                name: "IX_access_profiles_public_id",
                schema: "iam",
                table: "access_profiles",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_department_assignments_access_profile_id",
                schema: "iam",
                table: "department_assignments",
                column: "access_profile_id");

            migrationBuilder.CreateIndex(
                name: "IX_department_assignments_account_id",
                schema: "iam",
                table: "department_assignments",
                column: "account_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_department_assignments_department_kind",
                schema: "iam",
                table: "department_assignments",
                columns: new[] { "department", "kind" });

            migrationBuilder.CreateIndex(
                name: "IX_department_assignments_public_id",
                schema: "iam",
                table: "department_assignments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_department_assignments_single_super_administrator",
                schema: "iam",
                table: "department_assignments",
                column: "kind",
                unique: true,
                filter: "[kind] = N'SuperAdministrator'");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_request_stations_station_id",
                schema: "iam",
                table: "user_access_request_stations",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_request_terminals_terminal_id",
                schema: "iam",
                table: "user_access_request_terminals",
                column: "terminal_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_access_profile_id",
                schema: "iam",
                table: "user_access_requests",
                column: "access_profile_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_created_account_id",
                schema: "iam",
                table: "user_access_requests",
                column: "created_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_decided_by_account_id",
                schema: "iam",
                table: "user_access_requests",
                column: "decided_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_email",
                schema: "iam",
                table: "user_access_requests",
                column: "email",
                unique: true,
                filter: "[status] = N'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_public_id",
                schema: "iam",
                table: "user_access_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_requested_by_account_id",
                schema: "iam",
                table: "user_access_requests",
                column: "requested_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_status_department",
                schema: "iam",
                table: "user_access_requests",
                columns: new[] { "status", "department" });

            migrationBuilder.CreateIndex(
                name: "IX_user_access_requests_supervisor_ramp_agent_id",
                schema: "iam",
                table: "user_access_requests",
                column: "supervisor_ramp_agent_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "access_profile_grants",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "account_permission_grants",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "department_assignments",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "user_access_request_grants",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "user_access_request_stations",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "user_access_request_terminals",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "user_access_requests",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "access_profiles",
                schema: "iam");
        }
    }
}
