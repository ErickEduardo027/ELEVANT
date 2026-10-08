using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFinanceTariffsAndCharges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_price",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_quantity",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_non_fiscal_payments_invoice_id",
                schema: "commercial",
                table: "non_fiscal_payments");

            migrationBuilder.DropCheckConstraint(
                name: "ck_non_fiscal_invoice_line_price",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_non_fiscal_invoice_line_quantity",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_financial_documents_invoice_id_kind",
                schema: "commercial",
                table: "financial_documents");

            migrationBuilder.AlterColumn<long>(
                name: "operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.AlterColumn<long>(
                name: "approved_submission_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.AddColumn<string>(
                name: "adjustment_reason",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "computed_amount",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "computed_quantity",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "edited_at",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "edited_by_account_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_excluded",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Service");

            migrationBuilder.AddColumn<long>(
                name: "parent_line_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "method",
                schema: "commercial",
                table: "non_fiscal_payments",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Transfer");

            migrationBuilder.AddColumn<DateOnly>(
                name: "paid_on",
                schema: "commercial",
                table: "non_fiscal_payments",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "due_date",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "payment_term_days",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Service");

            migrationBuilder.AddColumn<int>(
                name: "parent_line_number",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reason",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "status",
                schema: "commercial",
                table: "contract_versions",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(16)",
                oldMaxLength: 16);

            migrationBuilder.CreateTable(
                name: "airline_billing_profiles",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    payment_term_days = table.Column<int>(type: "int", nullable: false),
                    billing_email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airline_billing_profiles", x => x.id);
                    table.CheckConstraint("ck_airline_billing_profile_terms", "[payment_term_days] BETWEEN 0 AND 365");
                    table.ForeignKey(
                        name: "FK_airline_billing_profiles_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "billing_units",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    quantity_scale = table.Column<byte>(type: "tinyint", nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_units", x => x.id);
                    table.CheckConstraint("ck_billing_unit_scale", "[quantity_scale] BETWEEN 0 AND 4");
                });

            migrationBuilder.CreateTable(
                name: "charge_definitions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    category = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    method = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    quantity_rule = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    grace_minutes = table.Column<int>(type: "int", nullable: false),
                    rounding_increment = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    applies_to_all_services = table.Column<bool>(type: "bit", nullable: false),
                    allow_multiple = table.Column<bool>(type: "bit", nullable: false),
                    visible_to_agents = table.Column<bool>(type: "bit", nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    billing_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_charge_definitions", x => x.id);
                    table.CheckConstraint("ck_charge_definition_grace", "[grace_minutes] BETWEEN 0 AND 1440");
                    table.CheckConstraint("ck_charge_definition_rounding", "[rounding_increment] >= 0");
                });

            migrationBuilder.CreateTable(
                name: "charge_tariff_versions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    published_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    published_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_charge_tariff_versions", x => x.id);
                    table.CheckConstraint("ck_charge_tariff_version_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_charge_tariff_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.CheckConstraint("ck_charge_tariff_version_published", "([status] = N'Draft' AND [published_at] IS NULL) OR ([status] <> N'Draft' AND [published_at] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_charge_tariff_versions_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_charge_tariff_versions_accounts_published_by_account_id",
                        column: x => x.published_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_finance_reviews",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    decision = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    decided_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    comparison_json = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_finance_reviews", x => x.id);
                    table.CheckConstraint("ck_contract_finance_review_reason", "[decision] = N'Approved' OR LEN([reason]) >= 3");
                    table.ForeignKey(
                        name: "FK_contract_finance_reviews_accounts_decided_by_account_id",
                        column: x => x.decided_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_finance_reviews_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "exchange_rates",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    rate_date = table.Column<DateOnly>(type: "date", nullable: false),
                    from_currency = table.Column<string>(type: "char(3)", nullable: false),
                    to_currency = table.Column<string>(type: "char(3)", nullable: false),
                    rate = table.Column<decimal>(type: "decimal(19,6)", precision: 19, scale: 6, nullable: false),
                    source = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    recorded_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    supersedes_id = table.Column<long>(type: "bigint", nullable: true),
                    is_current = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exchange_rates", x => x.id);
                    table.CheckConstraint("ck_exchange_rate_currencies", "LEN([from_currency]) = 3 AND LEN([to_currency]) = 3 AND [from_currency] <> [to_currency]");
                    table.CheckConstraint("ck_exchange_rate_value", "[rate] > 0");
                    table.ForeignKey(
                        name: "FK_exchange_rates_accounts_recorded_by_account_id",
                        column: x => x.recorded_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_exchange_rates_exchange_rates_supersedes_id",
                        column: x => x.supersedes_id,
                        principalSchema: "commercial",
                        principalTable: "exchange_rates",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "non_fiscal_credit_notes",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    issued_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    number = table.Column<string>(type: "nvarchar(35)", maxLength: 35, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_non_fiscal_credit_notes", x => x.id);
                    table.CheckConstraint("ck_non_fiscal_credit_note_amount", "[amount] > 0");
                    table.CheckConstraint("ck_non_fiscal_credit_note_reason", "LEN([reason]) >= 3");
                    table.CheckConstraint("ck_non_fiscal_credit_note_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.ForeignKey(
                        name: "FK_non_fiscal_credit_notes_accounts_issued_by_account_id",
                        column: x => x.issued_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_non_fiscal_credit_notes_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_tariff_versions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    published_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    published_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_tariff_versions", x => x.id);
                    table.CheckConstraint("ck_service_tariff_version_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_service_tariff_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.CheckConstraint("ck_service_tariff_version_published", "([status] = N'Draft' AND [published_at] IS NULL) OR ([status] <> N'Draft' AND [published_at] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_service_tariff_versions_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_tariff_versions_accounts_published_by_account_id",
                        column: x => x.published_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "charge_definition_services",
                schema: "commercial",
                columns: table => new
                {
                    charge_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_charge_definition_services", x => new { x.charge_definition_id, x.service_definition_id });
                    table.ForeignKey(
                        name: "FK_charge_definition_services_charge_definitions_charge_definition_id",
                        column: x => x.charge_definition_id,
                        principalSchema: "commercial",
                        principalTable: "charge_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_charge_definition_services_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_charge_rates",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    charge_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    is_excluded = table.Column<bool>(type: "bit", nullable: false),
                    value = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    minimum_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_charge_rates", x => x.id);
                    table.CheckConstraint("ck_contract_charge_rate", "([is_excluded] = 1 AND [value] IS NULL) OR ([is_excluded] = 0 AND [value] >= 0)");
                    table.ForeignKey(
                        name: "FK_contract_charge_rates_charge_definitions_charge_definition_id",
                        column: x => x.charge_definition_id,
                        principalSchema: "commercial",
                        principalTable: "charge_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_charge_rates_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_service_charges",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_service_id = table.Column<long>(type: "bigint", nullable: false),
                    charge_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    applied_by_ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    applied_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    removed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    removed_by_ramp_agent_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_service_charges", x => x.id);
                    table.CheckConstraint("ck_operation_service_charge_removal", "([removed_at] IS NULL AND [removed_by_ramp_agent_id] IS NULL) OR ([removed_at] IS NOT NULL AND [removed_by_ramp_agent_id] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_operation_service_charges_charge_definitions_charge_definition_id",
                        column: x => x.charge_definition_id,
                        principalSchema: "commercial",
                        principalTable: "charge_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_service_charges_operation_services_operation_service_id",
                        column: x => x.operation_service_id,
                        principalSchema: "ops",
                        principalTable: "operation_services",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_service_charges_ramp_agents_applied_by_ramp_agent_id",
                        column: x => x.applied_by_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_service_charges_ramp_agents_removed_by_ramp_agent_id",
                        column: x => x.removed_by_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "charge_rates",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    charge_tariff_version_id = table.Column<long>(type: "bigint", nullable: false),
                    charge_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    value = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    minimum_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_charge_rates", x => x.id);
                    table.CheckConstraint("ck_charge_rate_minimum", "[minimum_amount] >= 0");
                    table.CheckConstraint("ck_charge_rate_value", "[value] >= 0");
                    table.ForeignKey(
                        name: "FK_charge_rates_charge_definitions_charge_definition_id",
                        column: x => x.charge_definition_id,
                        principalSchema: "commercial",
                        principalTable: "charge_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_charge_rates_charge_tariff_versions_charge_tariff_version_id",
                        column: x => x.charge_tariff_version_id,
                        principalSchema: "commercial",
                        principalTable: "charge_tariff_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_tariff_rates",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    service_tariff_version_id = table.Column<long>(type: "bigint", nullable: false),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    billing_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    unit_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    minimum_billable_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_tariff_rates", x => x.id);
                    table.CheckConstraint("ck_service_tariff_rate_minimum", "[minimum_billable_quantity] >= 0");
                    table.CheckConstraint("ck_service_tariff_rate_price", "[unit_price] >= 0");
                    table.ForeignKey(
                        name: "FK_service_tariff_rates_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_tariff_rates_service_tariff_versions_service_tariff_version_id",
                        column: x => x.service_tariff_version_id,
                        principalSchema: "commercial",
                        principalTable: "service_tariff_versions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_tariff_rates_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "charge_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_edited_by_account_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "edited_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "operation_service_id",
                unique: true,
                filter: "[released_at] IS NULL AND [kind] = N'Service'");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_operation_service_id_charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines",
                columns: new[] { "operation_service_id", "charge_definition_id" });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_parent_line_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "parent_line_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_excluded",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "[is_excluded] = 0 OR [amount] = 0");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_kind",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "([kind] = N'Service' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NULL) OR ([kind] = N'Charge' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NOT NULL AND [parent_line_id] IS NOT NULL) OR ([kind] = N'Adjustment' AND [charge_definition_id] IS NULL AND LEN([adjustment_reason]) >= 3)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_price",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "[unit_price] >= 0 AND ([kind] = N'Adjustment' OR [amount] >= 0)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_quantity",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "[executed_quantity] > 0 OR ([kind] <> N'Service' AND [executed_quantity] >= 0)");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_invoice_id",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "invoice_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_non_fiscal_invoice_line_price",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                sql: "[unit_price] >= 0 AND ([kind] = N'Adjustment' OR [amount] >= 0)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_non_fiscal_invoice_line_quantity",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                sql: "[executed_quantity] > 0 OR ([kind] <> N'Service' AND [executed_quantity] >= 0)");

            migrationBuilder.CreateIndex(
                name: "IX_financial_documents_invoice_id_kind",
                schema: "commercial",
                table: "financial_documents",
                columns: new[] { "invoice_id", "kind" },
                unique: true,
                filter: "[kind] = 'Invoice'");

            migrationBuilder.CreateIndex(
                name: "IX_airline_billing_profiles_airline_id",
                schema: "commercial",
                table: "airline_billing_profiles",
                column: "airline_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airline_billing_profiles_public_id",
                schema: "commercial",
                table: "airline_billing_profiles",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_billing_units_code",
                schema: "ref",
                table: "billing_units",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_billing_units_public_id",
                schema: "ref",
                table: "billing_units",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charge_definition_services_service_definition_id",
                schema: "commercial",
                table: "charge_definition_services",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_charge_definitions_code",
                schema: "commercial",
                table: "charge_definitions",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charge_definitions_public_id",
                schema: "commercial",
                table: "charge_definitions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charge_rates_charge_definition_id",
                schema: "commercial",
                table: "charge_rates",
                column: "charge_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_charge_rates_charge_tariff_version_id_charge_definition_id",
                schema: "commercial",
                table: "charge_rates",
                columns: new[] { "charge_tariff_version_id", "charge_definition_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charge_rates_public_id",
                schema: "commercial",
                table: "charge_rates",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charge_tariff_versions_created_by_account_id",
                schema: "commercial",
                table: "charge_tariff_versions",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_charge_tariff_versions_currency_code_status_valid_from",
                schema: "commercial",
                table: "charge_tariff_versions",
                columns: new[] { "currency_code", "status", "valid_from" });

            migrationBuilder.CreateIndex(
                name: "IX_charge_tariff_versions_public_id",
                schema: "commercial",
                table: "charge_tariff_versions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charge_tariff_versions_published_by_account_id",
                schema: "commercial",
                table: "charge_tariff_versions",
                column: "published_by_account_id");

            migrationBuilder.CreateIndex(
                name: "ux_charge_tariff_versions_single_draft",
                schema: "commercial",
                table: "charge_tariff_versions",
                column: "currency_code",
                unique: true,
                filter: "[status] = N'Draft'");

            migrationBuilder.CreateIndex(
                name: "IX_contract_charge_rates_charge_definition_id",
                schema: "commercial",
                table: "contract_charge_rates",
                column: "charge_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_charge_rates_contract_version_id_charge_definition_id",
                schema: "commercial",
                table: "contract_charge_rates",
                columns: new[] { "contract_version_id", "charge_definition_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_charge_rates_public_id",
                schema: "commercial",
                table: "contract_charge_rates",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_finance_reviews_contract_version_id_decided_at",
                schema: "commercial",
                table: "contract_finance_reviews",
                columns: new[] { "contract_version_id", "decided_at" });

            migrationBuilder.CreateIndex(
                name: "IX_contract_finance_reviews_decided_by_account_id",
                schema: "commercial",
                table: "contract_finance_reviews",
                column: "decided_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_finance_reviews_public_id",
                schema: "commercial",
                table: "contract_finance_reviews",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_exchange_rates_public_id",
                schema: "commercial",
                table: "exchange_rates",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_exchange_rates_recorded_by_account_id",
                schema: "commercial",
                table: "exchange_rates",
                column: "recorded_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_exchange_rates_supersedes_id",
                schema: "commercial",
                table: "exchange_rates",
                column: "supersedes_id");

            migrationBuilder.CreateIndex(
                name: "ux_exchange_rates_current",
                schema: "commercial",
                table: "exchange_rates",
                columns: new[] { "rate_date", "from_currency", "to_currency" },
                unique: true,
                filter: "[is_current] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_credit_notes_invoice_id",
                schema: "commercial",
                table: "non_fiscal_credit_notes",
                column: "invoice_id");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_credit_notes_issued_by_account_id",
                schema: "commercial",
                table: "non_fiscal_credit_notes",
                column: "issued_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_credit_notes_number",
                schema: "commercial",
                table: "non_fiscal_credit_notes",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_credit_notes_public_id",
                schema: "commercial",
                table: "non_fiscal_credit_notes",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_credit_notes_request_id",
                schema: "commercial",
                table: "non_fiscal_credit_notes",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_applied_by_ramp_agent_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "applied_by_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_charge_definition_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "charge_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_operation_service_id_removed_at",
                schema: "ops",
                table: "operation_service_charges",
                columns: new[] { "operation_service_id", "removed_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_public_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_charges_removed_by_ramp_agent_id",
                schema: "ops",
                table: "operation_service_charges",
                column: "removed_by_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_rates_public_id",
                schema: "commercial",
                table: "service_tariff_rates",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_rates_service_definition_id",
                schema: "commercial",
                table: "service_tariff_rates",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_rates_service_tariff_version_id_service_definition_id_station_id",
                schema: "commercial",
                table: "service_tariff_rates",
                columns: new[] { "service_tariff_version_id", "service_definition_id", "station_id" },
                unique: true,
                filter: "[station_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_rates_station_id",
                schema: "commercial",
                table: "service_tariff_rates",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "ux_service_tariff_rates_all_stations",
                schema: "commercial",
                table: "service_tariff_rates",
                columns: new[] { "service_tariff_version_id", "service_definition_id" },
                unique: true,
                filter: "[station_id] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_versions_created_by_account_id",
                schema: "commercial",
                table: "service_tariff_versions",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_versions_currency_code_status_valid_from",
                schema: "commercial",
                table: "service_tariff_versions",
                columns: new[] { "currency_code", "status", "valid_from" });

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_versions_public_id",
                schema: "commercial",
                table: "service_tariff_versions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_tariff_versions_published_by_account_id",
                schema: "commercial",
                table: "service_tariff_versions",
                column: "published_by_account_id");

            migrationBuilder.CreateIndex(
                name: "ux_service_tariff_versions_single_draft",
                schema: "commercial",
                table: "service_tariff_versions",
                column: "currency_code",
                unique: true,
                filter: "[status] = N'Draft'");

            migrationBuilder.AddForeignKey(
                name: "FK_preinvoice_lines_accounts_edited_by_account_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "edited_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_preinvoice_lines_charge_definitions_charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "charge_definition_id",
                principalSchema: "commercial",
                principalTable: "charge_definitions",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_preinvoice_lines_preinvoice_lines_parent_line_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "parent_line_id",
                principalSchema: "commercial",
                principalTable: "preinvoice_lines",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [commercial].[preinvoice_lines] WHERE [kind] <> N'Service')
                    OR EXISTS (SELECT 1 FROM [ops].[operation_service_charges])
                    OR EXISTS (SELECT 1 FROM [commercial].[non_fiscal_credit_notes])
                    OR EXISTS (SELECT 1 FROM [commercial].[non_fiscal_payments] GROUP BY [invoice_id] HAVING COUNT(*) > 1)
                BEGIN
                    THROW 51060, 'Finance charge and receivable history must be retained; restore a verified backup instead of reversing this migration.', 1;
                END
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_preinvoice_lines_accounts_edited_by_account_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_preinvoice_lines_charge_definitions_charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_preinvoice_lines_preinvoice_lines_parent_line_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropTable(
                name: "airline_billing_profiles",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "billing_units",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "charge_definition_services",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "charge_rates",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "contract_charge_rates",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "contract_finance_reviews",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "exchange_rates",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "non_fiscal_credit_notes",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "operation_service_charges",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "service_tariff_rates",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "charge_tariff_versions",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "charge_definitions",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "service_tariff_versions",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_edited_by_account_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_operation_service_id_charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_parent_line_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_excluded",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_kind",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_price",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_quantity",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_non_fiscal_payments_invoice_id",
                schema: "commercial",
                table: "non_fiscal_payments");

            migrationBuilder.DropCheckConstraint(
                name: "ck_non_fiscal_invoice_line_price",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropCheckConstraint(
                name: "ck_non_fiscal_invoice_line_quantity",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropIndex(
                name: "IX_financial_documents_invoice_id_kind",
                schema: "commercial",
                table: "financial_documents");

            migrationBuilder.DropColumn(
                name: "adjustment_reason",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "charge_definition_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "computed_amount",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "computed_quantity",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "edited_at",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "edited_by_account_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "is_excluded",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "kind",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "parent_line_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "method",
                schema: "commercial",
                table: "non_fiscal_payments");

            migrationBuilder.DropColumn(
                name: "paid_on",
                schema: "commercial",
                table: "non_fiscal_payments");

            migrationBuilder.DropColumn(
                name: "due_date",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "payment_term_days",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "kind",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "parent_line_number",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.DropColumn(
                name: "reason",
                schema: "commercial",
                table: "non_fiscal_invoice_lines");

            migrationBuilder.AlterColumn<long>(
                name: "operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.AlterColumn<long>(
                name: "approved_submission_id",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "status",
                schema: "commercial",
                table: "contract_versions",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(32)",
                oldMaxLength: 32);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "operation_service_id",
                unique: true,
                filter: "[released_at] IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_price",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "[unit_price] >= 0 AND [amount] >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_quantity",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "[executed_quantity] > 0");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_invoice_id",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "invoice_id",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_non_fiscal_invoice_line_price",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                sql: "[unit_price] >= 0 AND [amount] >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "ck_non_fiscal_invoice_line_quantity",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                sql: "[executed_quantity] > 0");

            migrationBuilder.CreateIndex(
                name: "IX_financial_documents_invoice_id_kind",
                schema: "commercial",
                table: "financial_documents",
                columns: new[] { "invoice_id", "kind" },
                unique: true);
        }
    }
}
