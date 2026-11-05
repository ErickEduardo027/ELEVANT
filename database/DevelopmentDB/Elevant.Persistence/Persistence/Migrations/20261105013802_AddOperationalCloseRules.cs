using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOperationalCloseRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_service_charge_removal",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.AddColumn<string>(
                name: "approved_evidence_json",
                schema: "ops",
                table: "review_decisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AlterColumn<long>(
                name: "applied_by_ramp_agent_id",
                schema: "ops",
                table: "operation_service_charges",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.AddColumn<string>(
                name: "adjustment_reason",
                schema: "ops",
                table: "operation_service_charges",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "applied_by_account_id",
                schema: "ops",
                table: "operation_service_charges",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "removed_by_account_id",
                schema: "ops",
                table: "operation_service_charges",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source",
                schema: "ops",
                table: "operation_service_charges",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Agent");

            migrationBuilder.CreateTable(
                name: "finance_holidays",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    date = table.Column<DateOnly>(type: "date", nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    removed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    removed_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_holidays", x => x.id);
                    table.CheckConstraint("ck_finance_holiday_removal", "([removed_at] IS NULL AND [removed_by_account_id] IS NULL) OR ([removed_at] IS NOT NULL AND [removed_by_account_id] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_finance_holidays_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_holidays_accounts_removed_by_account_id",
                        column: x => x.removed_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ground_time_allowances",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    size_category = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    allowed_minutes = table.Column<int>(type: "int", nullable: false),
                    updated_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ground_time_allowances", x => x.id);
                    table.CheckConstraint("ck_ground_time_allowance_minutes", "[allowed_minutes] BETWEEN 15 AND 720");
                    table.ForeignKey(
                        name: "FK_ground_time_allowances_accounts_updated_by_account_id",
                        column: x => x.updated_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_applied_by_account_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "applied_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_removed_by_account_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "removed_by_account_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_service_charge_reason",
                schema: "ops",
                table: "operation_service_charges",
                sql: "([applied_by_account_id] IS NULL AND [removed_by_account_id] IS NULL) OR [adjustment_reason] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_service_charge_removal",
                schema: "ops",
                table: "operation_service_charges",
                sql: "([removed_at] IS NULL AND [removed_by_ramp_agent_id] IS NULL AND [removed_by_account_id] IS NULL) OR ([removed_at] IS NOT NULL AND (([removed_by_ramp_agent_id] IS NOT NULL AND [removed_by_account_id] IS NULL) OR ([removed_by_ramp_agent_id] IS NULL AND [removed_by_account_id] IS NOT NULL)))");

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_service_charge_source",
                schema: "ops",
                table: "operation_service_charges",
                sql: "([source] = N'Agent' AND [applied_by_ramp_agent_id] IS NOT NULL AND [applied_by_account_id] IS NULL) OR ([source] = N'Automatic' AND [applied_by_ramp_agent_id] IS NULL AND [applied_by_account_id] IS NULL) OR ([source] = N'Occ' AND [applied_by_ramp_agent_id] IS NULL AND [applied_by_account_id] IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_finance_holidays_created_by_account_id",
                schema: "commercial",
                table: "finance_holidays",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_holidays_public_id",
                schema: "commercial",
                table: "finance_holidays",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_holidays_removed_by_account_id",
                schema: "commercial",
                table: "finance_holidays",
                column: "removed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "ux_finance_holidays_active_date",
                schema: "commercial",
                table: "finance_holidays",
                column: "date",
                unique: true,
                filter: "[removed_at] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ground_time_allowances_public_id",
                schema: "commercial",
                table: "ground_time_allowances",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ground_time_allowances_size_category",
                schema: "commercial",
                table: "ground_time_allowances",
                column: "size_category",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ground_time_allowances_updated_by_account_id",
                schema: "commercial",
                table: "ground_time_allowances",
                column: "updated_by_account_id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_service_charges_accounts_applied_by_account_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "applied_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_operation_service_charges_accounts_removed_by_account_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "removed_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ADR-0034: automatic and OCC charge marks, approved evidence and the holiday calendar are history.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM ops.operation_service_charges WHERE source <> N'Agent' OR removed_by_account_id IS NOT NULL)
                   OR EXISTS (SELECT 1 FROM ops.review_decisions WHERE approved_evidence_json IS NOT NULL)
                   OR EXISTS (SELECT 1 FROM commercial.finance_holidays)
                    THROW 52340, 'Operational close records already exist; closed history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_operation_service_charges_accounts_applied_by_account_id",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropForeignKey(
                name: "FK_operation_service_charges_accounts_removed_by_account_id",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropTable(
                name: "finance_holidays",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "ground_time_allowances",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_operation_service_charges_applied_by_account_id",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropIndex(
                name: "IX_operation_service_charges_removed_by_account_id",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_service_charge_reason",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_service_charge_removal",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_service_charge_source",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropColumn(
                name: "approved_evidence_json",
                schema: "ops",
                table: "review_decisions");

            migrationBuilder.DropColumn(
                name: "adjustment_reason",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropColumn(
                name: "applied_by_account_id",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropColumn(
                name: "removed_by_account_id",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.DropColumn(
                name: "source",
                schema: "ops",
                table: "operation_service_charges");

            migrationBuilder.AlterColumn<long>(
                name: "applied_by_ramp_agent_id",
                schema: "ops",
                table: "operation_service_charges",
                type: "bigint",
                nullable: false,
                defaultValue: 0L,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_service_charge_removal",
                schema: "ops",
                table: "operation_service_charges",
                sql: "([removed_at] IS NULL AND [removed_by_ramp_agent_id] IS NULL) OR ([removed_at] IS NOT NULL AND [removed_by_ramp_agent_id] IS NOT NULL)");
        }
    }
}
