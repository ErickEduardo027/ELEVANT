using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OperationAttendanceValidation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "operation_attendance_validations",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_agent_assignment_id = table.Column<long>(type: "bigint", nullable: false),
                    occ_contribution_revision_id = table.Column<long>(type: "bigint", nullable: false),
                    ramp_agent_contribution_revision_id = table.Column<long>(type: "bigint", nullable: false),
                    start_source = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    end_source = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    start_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    end_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    validated_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    validated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    idempotency_key = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payload_sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_attendance_validations", x => x.id);
                    table.CheckConstraint("ck_attendance_validation_chronology", "[end_at] >= [start_at]");
                    table.CheckConstraint("ck_attendance_validation_sources", "[start_source] IN ('Occ', 'RampAgent') AND [end_source] IN ('Occ', 'RampAgent')");
                    table.ForeignKey(
                        name: "FK_operation_attendance_validations_accounts_validated_by_account_id",
                        column: x => x.validated_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_attendance_validations_operation_agent_assignments_operation_agent_assignment_id",
                        column: x => x.operation_agent_assignment_id,
                        principalSchema: "ops",
                        principalTable: "operation_agent_assignments",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_attendance_validations_operation_attendance_contribution_revisions_occ_contribution_revision_id",
                        column: x => x.occ_contribution_revision_id,
                        principalSchema: "ops",
                        principalTable: "operation_attendance_contribution_revisions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_attendance_validations_operation_attendance_contribution_revisions_ramp_agent_contribution_revision_id",
                        column: x => x.ramp_agent_contribution_revision_id,
                        principalSchema: "ops",
                        principalTable: "operation_attendance_contribution_revisions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_validations_occ_contribution_revision_id",
                schema: "ops",
                table: "operation_attendance_validations",
                column: "occ_contribution_revision_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_validations_operation_agent_assignment_id_occ_contribution_revision_id_ramp_agent_contribution_revision~",
                schema: "ops",
                table: "operation_attendance_validations",
                columns: new[] { "operation_agent_assignment_id", "occ_contribution_revision_id", "ramp_agent_contribution_revision_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_validations_public_id",
                schema: "ops",
                table: "operation_attendance_validations",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_validations_ramp_agent_contribution_revision_id",
                schema: "ops",
                table: "operation_attendance_validations",
                column: "ramp_agent_contribution_revision_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_attendance_validations_validated_by_account_id_idempotency_key",
                schema: "ops",
                table: "operation_attendance_validations",
                columns: new[] { "validated_by_account_id", "idempotency_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "operation_attendance_validations",
                schema: "ops");
        }
    }
}
