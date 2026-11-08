using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOccIncidentsReviewReopenAndServiceOrderCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "reopen_reason",
                schema: "ops",
                table: "operation_submissions",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "reopened_by_account_id",
                schema: "ops",
                table: "operation_submissions",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "reopened_from_submission_id",
                schema: "ops",
                table: "operation_submissions",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "billing_excluded_at",
                schema: "ops",
                table: "operation_services",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "billing_excluded_by_account_id",
                schema: "ops",
                table: "operation_services",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "billing_exclusion_reason",
                schema: "ops",
                table: "operation_services",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "corrected_at",
                schema: "ops",
                table: "operation_document_versions",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "corrected_by_account_id",
                schema: "ops",
                table: "operation_document_versions",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "correction_reason",
                schema: "ops",
                table: "operation_document_versions",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "corrects_version_id",
                schema: "ops",
                table: "operation_document_versions",
                type: "bigint",
                nullable: true);

            migrationBuilder.AlterColumn<long>(
                name: "reported_by_ramp_agent_id",
                schema: "ops",
                table: "incidents",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.AddColumn<long>(
                name: "reported_by_account_id",
                schema: "ops",
                table: "incidents",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "incident_status_events",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    incident_id = table.Column<long>(type: "bigint", nullable: false),
                    from_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    to_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    note = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incident_status_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_incident_status_events_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_incident_status_events_incidents_incident_id",
                        column: x => x.incident_id,
                        principalSchema: "ops",
                        principalTable: "incidents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_reopened_by_account_id",
                schema: "ops",
                table: "operation_submissions",
                column: "reopened_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_reopened_from_submission_id",
                schema: "ops",
                table: "operation_submissions",
                column: "reopened_from_submission_id",
                unique: true,
                filter: "[reopened_from_submission_id] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_submission_reopening",
                schema: "ops",
                table: "operation_submissions",
                sql: "([reopened_from_submission_id] IS NULL AND [reopened_by_account_id] IS NULL AND [reopen_reason] IS NULL) OR ([reopened_from_submission_id] IS NOT NULL AND [reopened_by_account_id] IS NOT NULL AND [reopen_reason] IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_operation_services_billing_excluded_by_account_id",
                schema: "ops",
                table: "operation_services",
                column: "billing_excluded_by_account_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_service_billing_exclusion",
                schema: "ops",
                table: "operation_services",
                sql: "([billing_excluded_at] IS NULL AND [billing_excluded_by_account_id] IS NULL AND [billing_exclusion_reason] IS NULL) OR ([billing_excluded_at] IS NOT NULL AND [billing_excluded_by_account_id] IS NOT NULL AND [billing_exclusion_reason] IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_versions_corrected_by_account_id",
                schema: "ops",
                table: "operation_document_versions",
                column: "corrected_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_versions_corrects_version_id",
                schema: "ops",
                table: "operation_document_versions",
                column: "corrects_version_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_document_version_correction",
                schema: "ops",
                table: "operation_document_versions",
                sql: "([corrects_version_id] IS NULL AND [correction_reason] IS NULL AND [corrected_by_account_id] IS NULL AND [corrected_at] IS NULL) OR ([corrects_version_id] IS NOT NULL AND [correction_reason] IS NOT NULL AND [corrected_by_account_id] IS NOT NULL AND [corrected_at] IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_incidents_reported_by_account_id",
                schema: "ops",
                table: "incidents",
                column: "reported_by_account_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_incident_reporter",
                schema: "ops",
                table: "incidents",
                sql: "[reported_by_ramp_agent_id] IS NOT NULL OR [reported_by_account_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_incident_status_events_actor_account_id",
                schema: "ops",
                table: "incident_status_events",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_incident_status_events_incident_id_occurred_at",
                schema: "ops",
                table: "incident_status_events",
                columns: new[] { "incident_id", "occurred_at" });

            migrationBuilder.AddForeignKey(
                name: "FK_incidents_accounts_reported_by_account_id",
                schema: "ops",
                table: "incidents",
                column: "reported_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_document_versions_accounts_corrected_by_account_id",
                schema: "ops",
                table: "operation_document_versions",
                column: "corrected_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_document_versions_operation_document_versions_corrects_version_id",
                schema: "ops",
                table: "operation_document_versions",
                column: "corrects_version_id",
                principalSchema: "ops",
                principalTable: "operation_document_versions",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_services_accounts_billing_excluded_by_account_id",
                schema: "ops",
                table: "operation_services",
                column: "billing_excluded_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_submissions_accounts_reopened_by_account_id",
                schema: "ops",
                table: "operation_submissions",
                column: "reopened_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_submissions_operation_submissions_reopened_from_submission_id",
                schema: "ops",
                table: "operation_submissions",
                column: "reopened_from_submission_id",
                principalSchema: "ops",
                principalTable: "operation_submissions",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // OCC's incidents and their history, reopened reviews, Service Orders OCC corrected after the signature and
            // services OCC excluded from billing are operational and billing history (reviews, Finance and the airline
            // portal refer to them): the downgrade stops instead of dropping that history or inventing a reporter.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM ops.incidents
                           WHERE reported_by_ramp_agent_id IS NULL OR reported_by_account_id IS NOT NULL)
                   OR EXISTS (SELECT 1 FROM ops.incident_status_events)
                    THROW 52380, 'Incidents reported by OCC or incident status history exist; operational history must be retained.', 1;
                IF EXISTS (SELECT 1 FROM ops.operation_submissions WHERE reopened_from_submission_id IS NOT NULL)
                    THROW 52381, 'Reopened OCC reviews exist; review history must be retained.', 1;
                IF EXISTS (SELECT 1 FROM ops.operation_document_versions WHERE corrects_version_id IS NOT NULL)
                    THROW 52382, 'Service Orders corrected by OCC after the signature exist; signed-document history must be retained.', 1;
                IF EXISTS (SELECT 1 FROM ops.operation_services WHERE billing_excluded_at IS NOT NULL)
                    THROW 52383, 'Services excluded from billing in an OCC review exist; billing history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_incidents_accounts_reported_by_account_id",
                schema: "ops",
                table: "incidents");

            migrationBuilder.DropForeignKey(
                name: "FK_operation_document_versions_accounts_corrected_by_account_id",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropForeignKey(
                name: "FK_operation_document_versions_operation_document_versions_corrects_version_id",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropForeignKey(
                name: "FK_operation_services_accounts_billing_excluded_by_account_id",
                schema: "ops",
                table: "operation_services");

            migrationBuilder.DropForeignKey(
                name: "FK_operation_submissions_accounts_reopened_by_account_id",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropForeignKey(
                name: "FK_operation_submissions_operation_submissions_reopened_from_submission_id",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropTable(
                name: "incident_status_events",
                schema: "ops");

            migrationBuilder.DropIndex(
                name: "IX_operation_submissions_reopened_by_account_id",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropIndex(
                name: "IX_operation_submissions_reopened_from_submission_id",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_submission_reopening",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropIndex(
                name: "IX_operation_services_billing_excluded_by_account_id",
                schema: "ops",
                table: "operation_services");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_service_billing_exclusion",
                schema: "ops",
                table: "operation_services");

            migrationBuilder.DropIndex(
                name: "IX_operation_document_versions_corrected_by_account_id",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropIndex(
                name: "IX_operation_document_versions_corrects_version_id",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_document_version_correction",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropIndex(
                name: "IX_incidents_reported_by_account_id",
                schema: "ops",
                table: "incidents");

            migrationBuilder.DropCheckConstraint(
                name: "ck_incident_reporter",
                schema: "ops",
                table: "incidents");

            migrationBuilder.DropColumn(
                name: "reopen_reason",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropColumn(
                name: "reopened_by_account_id",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropColumn(
                name: "reopened_from_submission_id",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropColumn(
                name: "billing_excluded_at",
                schema: "ops",
                table: "operation_services");

            migrationBuilder.DropColumn(
                name: "billing_excluded_by_account_id",
                schema: "ops",
                table: "operation_services");

            migrationBuilder.DropColumn(
                name: "billing_exclusion_reason",
                schema: "ops",
                table: "operation_services");

            migrationBuilder.DropColumn(
                name: "corrected_at",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropColumn(
                name: "corrected_by_account_id",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropColumn(
                name: "correction_reason",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropColumn(
                name: "corrects_version_id",
                schema: "ops",
                table: "operation_document_versions");

            migrationBuilder.DropColumn(
                name: "reported_by_account_id",
                schema: "ops",
                table: "incidents");

            // No default value: the guard above already proved every incident has its reporting agent.
            migrationBuilder.AlterColumn<long>(
                name: "reported_by_ramp_agent_id",
                schema: "ops",
                table: "incidents",
                type: "bigint",
                nullable: false,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);
        }
    }
}
