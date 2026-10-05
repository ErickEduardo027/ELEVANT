using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OperationAttendanceContributionRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "operation_attendance_contribution_revisions",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_agent_assignment_id = table.Column<long>(type: "bigint", nullable: false),
                    lane = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    revision_number = table.Column<int>(type: "int", nullable: false),
                    author_account_id = table.Column<long>(type: "bigint", nullable: false),
                    installation_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    idempotency_key = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payload_sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    observed_start_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    observed_end_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    incident_note = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    recorded_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_attendance_contribution_revisions", x => x.id);
                    table.CheckConstraint("ck_attendance_contribution_chronology", "[observed_start_at] IS NULL OR [observed_end_at] IS NULL OR [observed_end_at] >= [observed_start_at]");
                    table.CheckConstraint("ck_attendance_contribution_lane", "[lane] IN ('Occ', 'RampAgent')");
                    table.CheckConstraint("ck_attendance_contribution_observation", "[observed_start_at] IS NOT NULL OR [observed_end_at] IS NOT NULL OR [incident_note] IS NOT NULL");
                    table.CheckConstraint("ck_attendance_contribution_revision_positive", "[revision_number] > 0");
                    table.ForeignKey(
                        name: "FK_operation_attendance_contribution_revisions_accounts_author_account_id",
                        column: x => x.author_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_attendance_contribution_revisions_operation_agent_assignments_operation_agent_assignment_id",
                        column: x => x.operation_agent_assignment_id,
                        principalSchema: "ops",
                        principalTable: "operation_agent_assignments",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_contribution_revisions_author_account_id_idempotency_key",
                schema: "ops",
                table: "operation_attendance_contribution_revisions",
                columns: new[] { "author_account_id", "idempotency_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_contribution_revisions_operation_agent_assignment_id_lane_revision_number",
                schema: "ops",
                table: "operation_attendance_contribution_revisions",
                columns: new[] { "operation_agent_assignment_id", "lane", "revision_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_contribution_revisions_public_id",
                schema: "ops",
                table: "operation_attendance_contribution_revisions",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "operation_attendance_contribution_revisions",
                schema: "ops");
        }
    }
}
