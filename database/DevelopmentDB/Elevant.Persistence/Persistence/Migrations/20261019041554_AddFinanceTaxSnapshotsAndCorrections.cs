using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFinanceTaxSnapshotsAndCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_treasury_adjustment_line_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines");

            migrationBuilder.AddColumn<decimal>(
                name: "discount_amount",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "gross_amount",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "net_amount",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_amount",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_basis",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "tax_captured_at",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "tax_policy_public_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_rate",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(9,4)",
                precision: 9,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_treatment",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Unconfigured");

            migrationBuilder.AddColumn<string>(
                name: "commercial_snapshot_json",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "discount_total",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "net_total",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_total",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "tax_treatments_configured",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "discount_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "gross_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "net_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_basis",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "tax_captured_at",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "tax_policy_public_id",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_rate",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "decimal(9,4)",
                precision: 9,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_treatment",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Unconfigured");

            migrationBuilder.CreateTable(
                name: "finance_tax_commands",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    action = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    payload_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    result_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_tax_commands", x => x.id);
                    table.ForeignKey(
                        name: "FK_finance_tax_commands_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_tax_policies",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    concept_kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    concept_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    treatment = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    rate = table.Column<decimal>(type: "decimal(9,4)", precision: 9, scale: 4, nullable: true),
                    basis = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true),
                    replaces_policy_id = table.Column<long>(type: "bigint", nullable: true),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    published_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    published_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_tax_policies", x => x.id);
                    table.CheckConstraint("ck_tax_policy_currency", "[currency_code] IN ('USD','DOP')");
                    table.CheckConstraint("ck_tax_policy_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.CheckConstraint("ck_tax_policy_treatment", "([treatment] = N'Taxable' AND [rate] IS NOT NULL AND [rate] BETWEEN 0 AND 100) OR ([treatment] IN (N'Exempt',N'NotSubject') AND [rate] IS NULL AND [basis] IS NOT NULL AND LEN(LTRIM(RTRIM([basis]))) >= 3)");
                    table.ForeignKey(
                        name: "FK_finance_tax_policies_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_tax_policies_accounts_published_by_account_id",
                        column: x => x.published_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_tax_policies_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_tax_policies_finance_tax_policies_replaces_policy_id",
                        column: x => x.replaces_policy_id,
                        principalSchema: "commercial",
                        principalTable: "finance_tax_policies",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_tax_policies_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_treasury_adjustment_line_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                sql: "[quantity] >= 0 AND [amount] > 0");

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_commands_actor_account_id",
                schema: "commercial",
                table: "finance_tax_commands",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_commands_public_id",
                schema: "commercial",
                table: "finance_tax_commands",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_commands_request_id",
                schema: "commercial",
                table: "finance_tax_commands",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_policies_airline_id_station_id_currency_code_concept_kind_concept_code_valid_from",
                schema: "commercial",
                table: "finance_tax_policies",
                columns: new[] { "airline_id", "station_id", "currency_code", "concept_kind", "concept_code", "valid_from" });

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_policies_created_by_account_id",
                schema: "commercial",
                table: "finance_tax_policies",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_policies_public_id",
                schema: "commercial",
                table: "finance_tax_policies",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_policies_published_by_account_id",
                schema: "commercial",
                table: "finance_tax_policies",
                column: "published_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_policies_replaces_policy_id",
                schema: "commercial",
                table: "finance_tax_policies",
                column: "replaces_policy_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_tax_policies_station_id",
                schema: "commercial",
                table: "finance_tax_policies",
                column: "station_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [commercial].[finance_tax_policies])
                    OR EXISTS (SELECT 1 FROM [commercial].[preinvoice_lines] WHERE [tax_captured_at] IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM [commercial].[non_fiscal_invoices] WHERE [commercial_snapshot_json] IS NOT NULL)
                BEGIN
                    THROW 51081, 'Finance tax and issued snapshot history must be retained; restore a verified backup instead of reversing this migration.', 1;
                END
                """);
            migrationBuilder.DropTable(
                name: "finance_tax_commands",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_tax_policies",
                schema: "commercial");

            migrationBuilder.DropCheckConstraint(
                name: "ck_treasury_adjustment_line_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines");

            migrationBuilder.DropColumn(
                name: "discount_amount",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "gross_amount",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "net_amount",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_amount",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_basis",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_captured_at",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_policy_public_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_rate",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_treatment",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "commercial_snapshot_json",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "discount_total",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "net_total",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "tax_total",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "tax_treatments_configured",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "discount_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "gross_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "net_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_amount",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_basis",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_captured_at",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_policy_public_id",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_rate",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "tax_treatment",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.AddCheckConstraint(
                name: "ck_treasury_adjustment_line_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                sql: "[quantity] > 0 AND [amount] > 0");
        }
    }
}
