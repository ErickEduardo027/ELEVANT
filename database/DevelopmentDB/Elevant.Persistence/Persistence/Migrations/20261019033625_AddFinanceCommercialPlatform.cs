using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFinanceCommercialPlatform : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_kind",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.AddColumn<string>(
                name: "calculation_json",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "computed_is_excluded",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "pricing_policy_version",
                schema: "commercial",
                table: "contract_versions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "definition_snapshot_json",
                schema: "commercial",
                table: "contract_charge_rates",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "employee_expense_claims",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    employee_id = table.Column<long>(type: "bigint", nullable: false),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    expense_date = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    scope_station_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    airline_id = table.Column<long>(type: "bigint", nullable: true),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: true),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: true),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    fx_to_dop = table.Column<decimal>(type: "decimal(19,8)", precision: 19, scale: 8, nullable: false),
                    fx_source = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    fx_date = table.Column<DateOnly>(type: "date", nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    total_dop = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_expense_claims", x => x.id);
                    table.CheckConstraint("ck_employee_expense_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
                    table.CheckConstraint("ck_employee_expense_money", "[total] > 0 AND [total_dop] > 0 AND [fx_to_dop] > 0");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_employees_employee_id",
                        column: x => x.employee_id,
                        principalSchema: "hr",
                        principalTable: "employees",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_stations_scope_station_id",
                        column: x => x.scope_station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_claims_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_fiscal_documents",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    request_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    mode = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    environment = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    outcome = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    canonical_snapshot = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    snapshot_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    state = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    artifact_completion = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    provider_document_id = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                    dgii_response_id = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                    encf = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    last_provider_sequence = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_fiscal_documents", x => x.id);
                    table.CheckConstraint("ck_fiscal_document_currency", "[currency_code] IN ('USD', 'DOP')");
                    table.CheckConstraint("ck_fiscal_document_request", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.CheckConstraint("ck_fiscal_document_simulation", "[mode] = N'LocalSimulation' AND [environment] IN (N'Development', N'Test') AND [encf] IS NULL AND [dgii_response_id] IS NULL");
                    table.CheckConstraint("ck_fiscal_document_snapshot", "ISJSON([canonical_snapshot]) = 1 AND LEN([snapshot_hash]) = 64 AND LEN([request_hash]) = 64");
                    table.CheckConstraint("ck_fiscal_document_total", "[total] >= 0");
                    table.ForeignKey(
                        name: "FK_finance_fiscal_documents_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_fiscal_documents_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_payables_commands",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    content_hash = table.Column<string>(type: "char(64)", nullable: false),
                    resource_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    operation = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_payables_commands", x => x.id);
                    table.ForeignKey(
                        name: "FK_finance_payables_commands_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_pricing_commands",
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
                    table.PrimaryKey("PK_finance_pricing_commands", x => x.id);
                    table.ForeignKey(
                        name: "FK_finance_pricing_commands_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_treasury_adjustment_notes",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    related_note_id = table.Column<long>(type: "bigint", nullable: true),
                    number = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    kind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    effective_on = table.Column<DateOnly>(type: "date", nullable: false),
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
                    table.PrimaryKey("PK_finance_treasury_adjustment_notes", x => x.id);
                    table.CheckConstraint("ck_treasury_adjustment_amount", "[amount] > 0");
                    table.CheckConstraint("ck_treasury_adjustment_kind", "[kind] IN ('Credit','Debit')");
                    table.ForeignKey(
                        name: "FK_finance_treasury_adjustment_notes_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_adjustment_notes_finance_treasury_adjustment_notes_related_note_id",
                        column: x => x.related_note_id,
                        principalSchema: "commercial",
                        principalTable: "finance_treasury_adjustment_notes",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_adjustment_notes_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_treasury_invoice_accounts",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_treasury_invoice_accounts", x => x.id);
                    table.ForeignKey(
                        name: "FK_finance_treasury_invoice_accounts_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_treasury_receipts",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    reference = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    method = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    received_on = table.Column<DateOnly>(type: "date", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_treasury_receipts", x => x.id);
                    table.CheckConstraint("ck_treasury_receipt_amount", "[amount] > 0");
                    table.CheckConstraint("ck_treasury_receipt_currency", "[currency_code] IN ('USD','DOP')");
                    table.ForeignKey(
                        name: "FK_finance_treasury_receipts_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_receipts_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_receipts_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_treasury_requests",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    resource_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    operation = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    payload_hash = table.Column<string>(type: "char(64)", nullable: false),
                    result_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    result_version = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_treasury_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_finance_treasury_requests_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_package_versions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    version_number = table.Column<int>(type: "int", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    base_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    scope = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    flight_direction = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    period_days = table.Column<int>(type: "int", nullable: true),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true),
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
                    table.PrimaryKey("PK_service_package_versions", x => x.id);
                    table.CheckConstraint("ck_package_version_currency", "[currency_code] IN ('USD','DOP')");
                    table.CheckConstraint("ck_package_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.CheckConstraint("ck_package_version_price", "[base_price] >= 0 AND [version_number] > 0");
                    table.CheckConstraint("ck_package_version_scope", "([scope] = N'Turnaround' AND [flight_direction] IS NULL AND [period_days] IS NULL) OR ([scope] = N'Flight' AND [flight_direction] IS NOT NULL AND [period_days] IS NULL) OR ([scope] = N'Period' AND [flight_direction] IS NULL AND [period_days] BETWEEN 1 AND 366)");
                    table.ForeignKey(
                        name: "FK_service_package_versions_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_package_versions_accounts_published_by_account_id",
                        column: x => x.published_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "suppliers",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    scope_station_id = table.Column<long>(type: "bigint", nullable: false),
                    code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    tax_reference = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    contact_email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_suppliers", x => x.id);
                    table.ForeignKey(
                        name: "FK_suppliers_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_suppliers_stations_scope_station_id",
                        column: x => x.scope_station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "employee_expense_lines",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    line_number = table.Column<int>(type: "int", nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    unit_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    tax_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_expense_lines", x => x.id);
                    table.CheckConstraint("ck_employee_expense_lines_amounts", "[quantity] > 0 AND [unit_price] >= 0 AND [tax_amount] >= 0 AND [total] >= 0");
                    table.ForeignKey(
                        name: "FK_employee_expense_lines_employee_expense_claims_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "employee_expense_claims",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "employee_expense_payments",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    expense_claim_id = table.Column<long>(type: "bigint", nullable: false),
                    reference = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    paid_on = table.Column<DateOnly>(type: "date", nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    fx_to_dop = table.Column<decimal>(type: "decimal(19,8)", precision: 19, scale: 8, nullable: false),
                    fx_source = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    fx_date = table.Column<DateOnly>(type: "date", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    amount_dop = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    expense_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    rate_to_expense = table.Column<decimal>(type: "decimal(19,8)", precision: 19, scale: 8, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_expense_payments", x => x.id);
                    table.CheckConstraint("ck_employee_expense_payment_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
                    table.CheckConstraint("ck_employee_expense_payment_money", "[amount] > 0 AND [amount_dop] > 0 AND [expense_amount] > 0 AND [rate_to_expense] > 0 AND [fx_to_dop] > 0");
                    table.ForeignKey(
                        name: "FK_employee_expense_payments_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_payments_employee_expense_claims_expense_claim_id",
                        column: x => x.expense_claim_id,
                        principalSchema: "commercial",
                        principalTable: "employee_expense_claims",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "employee_expense_reviews",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    stage = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    decision = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_expense_reviews", x => x.id);
                    table.ForeignKey(
                        name: "FK_employee_expense_reviews_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_employee_expense_reviews_employee_expense_claims_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "employee_expense_claims",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_fiscal_artifacts",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    object_key = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    content_type = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    file_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    length = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_fiscal_artifacts", x => x.id);
                    table.CheckConstraint("ck_fiscal_artifact_integrity", "[length] > 0 AND LEN([sha256]) = 64");
                    table.ForeignKey(
                        name: "FK_finance_fiscal_artifacts_finance_fiscal_documents_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "finance_fiscal_documents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_fiscal_events",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    event_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    payload_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    provider_sequence = table.Column<long>(type: "bigint", nullable: true),
                    state = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    applied = table.Column<bool>(type: "bit", nullable: false),
                    detail = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_fiscal_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_finance_fiscal_events_finance_fiscal_documents_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "finance_fiscal_documents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_fiscal_intents",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    dispatch_request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    dispatch_request_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    dispatched_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    dispatched_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    dispatch_count = table.Column<int>(type: "int", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_fiscal_intents", x => x.id);
                    table.CheckConstraint("ck_fiscal_intent_single_dispatch", "[dispatch_count] BETWEEN 0 AND 1");
                    table.ForeignKey(
                        name: "FK_finance_fiscal_intents_accounts_dispatched_by_account_id",
                        column: x => x.dispatched_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_fiscal_intents_finance_fiscal_documents_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "finance_fiscal_documents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_treasury_adjustment_lines",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    note_id = table.Column<long>(type: "bigint", nullable: false),
                    invoice_line_id = table.Column<long>(type: "bigint", nullable: false),
                    quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_treasury_adjustment_lines", x => x.id);
                    table.CheckConstraint("ck_treasury_adjustment_line_amount", "[quantity] > 0 AND [amount] > 0");
                    table.ForeignKey(
                        name: "FK_finance_treasury_adjustment_lines_finance_treasury_adjustment_notes_note_id",
                        column: x => x.note_id,
                        principalSchema: "commercial",
                        principalTable: "finance_treasury_adjustment_notes",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_adjustment_lines_non_fiscal_invoice_lines_invoice_line_id",
                        column: x => x.invoice_line_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoice_lines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_treasury_movements",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    receipt_id = table.Column<long>(type: "bigint", nullable: false),
                    invoice_id = table.Column<long>(type: "bigint", nullable: true),
                    reverses_movement_id = table.Column<long>(type: "bigint", nullable: true),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    effective_on = table.Column<DateOnly>(type: "date", nullable: false),
                    receipt_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    invoice_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    receipt_currency = table.Column<string>(type: "char(3)", nullable: false),
                    invoice_currency = table.Column<string>(type: "char(3)", nullable: true),
                    exchange_rate = table.Column<decimal>(type: "decimal(28,10)", precision: 28, scale: 10, nullable: false),
                    exchange_rate_on = table.Column<DateOnly>(type: "date", nullable: false),
                    reference = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_treasury_movements", x => x.id);
                    table.CheckConstraint("ck_treasury_movement_amount", "[receipt_amount] > 0 AND [invoice_amount] >= 0 AND [exchange_rate] > 0");
                    table.CheckConstraint("ck_treasury_movement_shape", "([kind] IN ('Application','ApplicationReversal') AND [invoice_id] IS NOT NULL AND [invoice_amount] > 0 AND [invoice_currency] IS NOT NULL) OR ([kind] IN ('ReceiptReversal','Refund') AND [invoice_id] IS NULL AND [invoice_amount] = 0)");
                    table.CheckConstraint("ck_treasury_reversal_shape", "([kind] = 'ApplicationReversal' AND [reverses_movement_id] IS NOT NULL) OR ([kind] <> 'ApplicationReversal' AND [reverses_movement_id] IS NULL)");
                    table.ForeignKey(
                        name: "FK_finance_treasury_movements_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_movements_finance_treasury_movements_reverses_movement_id",
                        column: x => x.reverses_movement_id,
                        principalSchema: "commercial",
                        principalTable: "finance_treasury_movements",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_movements_finance_treasury_receipts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "commercial",
                        principalTable: "finance_treasury_receipts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_treasury_movements_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_service_packages",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    package_version_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_service_packages", x => x.id);
                    table.ForeignKey(
                        name: "FK_contract_service_packages_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_service_packages_service_package_versions_package_version_id",
                        column: x => x.package_version_id,
                        principalSchema: "commercial",
                        principalTable: "service_package_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_package_components",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    package_version_id = table.Column<long>(type: "bigint", nullable: false),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    billing_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    included_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    excess_block_size = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    excess_block_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_package_components", x => x.id);
                    table.CheckConstraint("ck_package_component_rules", "[included_quantity] >= 0 AND [excess_block_size] > 0 AND [excess_block_price] >= 0");
                    table.ForeignKey(
                        name: "FK_service_package_components_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_package_components_service_package_versions_package_version_id",
                        column: x => x.package_version_id,
                        principalSchema: "commercial",
                        principalTable: "service_package_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "payable_payments",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    supplier_id = table.Column<long>(type: "bigint", nullable: false),
                    scope_station_id = table.Column<long>(type: "bigint", nullable: false),
                    reference = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    paid_on = table.Column<DateOnly>(type: "date", nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    fx_to_dop = table.Column<decimal>(type: "decimal(19,8)", precision: 19, scale: 8, nullable: false),
                    fx_source = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    fx_date = table.Column<DateOnly>(type: "date", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    amount_dop = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payable_payments", x => x.id);
                    table.CheckConstraint("ck_payable_payment_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
                    table.CheckConstraint("ck_payable_payment_money", "[amount] > 0 AND [amount_dop] > 0 AND [fx_to_dop] > 0");
                    table.ForeignKey(
                        name: "FK_payable_payments_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_payable_payments_stations_scope_station_id",
                        column: x => x.scope_station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_payable_payments_suppliers_supplier_id",
                        column: x => x.supplier_id,
                        principalSchema: "commercial",
                        principalTable: "suppliers",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "supplier_invoices",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    supplier_id = table.Column<long>(type: "bigint", nullable: false),
                    document_reference = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    document_date = table.Column<DateOnly>(type: "date", nullable: false),
                    due_date = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    scope_station_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    airline_id = table.Column<long>(type: "bigint", nullable: true),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: true),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: true),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    fx_to_dop = table.Column<decimal>(type: "decimal(19,8)", precision: 19, scale: 8, nullable: false),
                    fx_source = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    fx_date = table.Column<DateOnly>(type: "date", nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    total_dop = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_supplier_invoices", x => x.id);
                    table.CheckConstraint("ck_supplier_invoice_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
                    table.CheckConstraint("ck_supplier_invoice_money", "[total] > 0 AND [total_dop] > 0 AND [fx_to_dop] > 0 AND [due_date] >= [document_date]");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_stations_scope_station_id",
                        column: x => x.scope_station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_suppliers_supplier_id",
                        column: x => x.supplier_id,
                        principalSchema: "commercial",
                        principalTable: "suppliers",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoices_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "package_consumptions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_package_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    scope_key = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    revision = table.Column<int>(type: "int", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_package_consumptions", x => x.id);
                    table.ForeignKey(
                        name: "FK_package_consumptions_contract_service_packages_contract_package_id",
                        column: x => x.contract_package_id,
                        principalSchema: "commercial",
                        principalTable: "contract_service_packages",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_package_consumptions_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "finance_payables_attachments",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    supplier_invoice_id = table.Column<long>(type: "bigint", nullable: true),
                    expense_claim_id = table.Column<long>(type: "bigint", nullable: true),
                    object_key = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    content_type = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    length = table.Column<long>(type: "bigint", nullable: false),
                    sha256 = table.Column<string>(type: "char(64)", nullable: false),
                    uploaded_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_finance_payables_attachments", x => x.id);
                    table.CheckConstraint("ck_finance_payables_attachment_owner", "([supplier_invoice_id] IS NOT NULL AND [expense_claim_id] IS NULL) OR ([supplier_invoice_id] IS NULL AND [expense_claim_id] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_finance_payables_attachments_accounts_uploaded_by_account_id",
                        column: x => x.uploaded_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_payables_attachments_employee_expense_claims_expense_claim_id",
                        column: x => x.expense_claim_id,
                        principalSchema: "commercial",
                        principalTable: "employee_expense_claims",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_finance_payables_attachments_supplier_invoices_supplier_invoice_id",
                        column: x => x.supplier_invoice_id,
                        principalSchema: "commercial",
                        principalTable: "supplier_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "payable_payment_applications",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payment_id = table.Column<long>(type: "bigint", nullable: false),
                    supplier_invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    payment_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    invoice_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    rate_to_invoice = table.Column<decimal>(type: "decimal(19,8)", precision: 19, scale: 8, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    applied_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payable_payment_applications", x => x.id);
                    table.CheckConstraint("ck_payable_application_money", "[payment_amount] > 0 AND [invoice_amount] > 0 AND [rate_to_invoice] > 0");
                    table.ForeignKey(
                        name: "FK_payable_payment_applications_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_payable_payment_applications_payable_payments_payment_id",
                        column: x => x.payment_id,
                        principalSchema: "commercial",
                        principalTable: "payable_payments",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_payable_payment_applications_supplier_invoices_supplier_invoice_id",
                        column: x => x.supplier_invoice_id,
                        principalSchema: "commercial",
                        principalTable: "supplier_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "supplier_invoice_lines",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    line_number = table.Column<int>(type: "int", nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    unit_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    tax_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_supplier_invoice_lines", x => x.id);
                    table.CheckConstraint("ck_supplier_invoice_lines_amounts", "[quantity] > 0 AND [unit_price] >= 0 AND [tax_amount] >= 0 AND [total] >= 0");
                    table.ForeignKey(
                        name: "FK_supplier_invoice_lines_supplier_invoices_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "supplier_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "supplier_invoice_reviews",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    document_id = table.Column<long>(type: "bigint", nullable: false),
                    stage = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    decision = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_supplier_invoice_reviews", x => x.id);
                    table.ForeignKey(
                        name: "FK_supplier_invoice_reviews_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_supplier_invoice_reviews_supplier_invoices_document_id",
                        column: x => x.document_id,
                        principalSchema: "commercial",
                        principalTable: "supplier_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "package_consumption_entries",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    consumption_id = table.Column<long>(type: "bigint", nullable: false),
                    component_id = table.Column<long>(type: "bigint", nullable: false),
                    operation_service_id = table.Column<long>(type: "bigint", nullable: false),
                    approved_submission_id = table.Column<long>(type: "bigint", nullable: false),
                    preinvoice_line_id = table.Column<long>(type: "bigint", nullable: false),
                    quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    included_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    excess_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    base_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    excess_amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    calculation_json = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_package_consumption_entries", x => x.id);
                    table.CheckConstraint("ck_package_entry_amounts", "[quantity] > 0 AND [included_quantity] >= 0 AND [excess_quantity] >= 0 AND [base_amount] >= 0 AND [excess_amount] >= 0");
                    table.ForeignKey(
                        name: "FK_package_consumption_entries_operation_services_operation_service_id",
                        column: x => x.operation_service_id,
                        principalSchema: "ops",
                        principalTable: "operation_services",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_package_consumption_entries_operation_submissions_approved_submission_id",
                        column: x => x.approved_submission_id,
                        principalSchema: "ops",
                        principalTable: "operation_submissions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_package_consumption_entries_package_consumptions_consumption_id",
                        column: x => x.consumption_id,
                        principalSchema: "commercial",
                        principalTable: "package_consumptions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_package_consumption_entries_preinvoice_lines_preinvoice_line_id",
                        column: x => x.preinvoice_line_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoice_lines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_package_consumption_entries_service_package_components_component_id",
                        column: x => x.component_id,
                        principalSchema: "commercial",
                        principalTable: "service_package_components",
                        principalColumn: "id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_kind",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "([kind] = N'Service' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NULL) OR ([kind] = N'Charge' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NOT NULL AND [parent_line_id] IS NOT NULL) OR ([kind] IN (N'Package', N'Excess', N'Minimum') AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NULL AND [parent_line_id] IS NOT NULL) OR ([kind] = N'Adjustment' AND [charge_definition_id] IS NULL AND LEN([adjustment_reason]) >= 3)");

            migrationBuilder.CreateIndex(
                name: "IX_contract_service_packages_contract_version_id_package_version_id",
                schema: "commercial",
                table: "contract_service_packages",
                columns: new[] { "contract_version_id", "package_version_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_service_packages_package_version_id",
                schema: "commercial",
                table: "contract_service_packages",
                column: "package_version_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_service_packages_public_id",
                schema: "commercial",
                table: "contract_service_packages",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_airline_id",
                schema: "commercial",
                table: "employee_expense_claims",
                column: "airline_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_created_by_account_id_expense_date",
                schema: "commercial",
                table: "employee_expense_claims",
                columns: new[] { "created_by_account_id", "expense_date" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_employee_id",
                schema: "commercial",
                table: "employee_expense_claims",
                column: "employee_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_public_id",
                schema: "commercial",
                table: "employee_expense_claims",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_scope_station_id_status",
                schema: "commercial",
                table: "employee_expense_claims",
                columns: new[] { "scope_station_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_service_definition_id",
                schema: "commercial",
                table: "employee_expense_claims",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_station_id",
                schema: "commercial",
                table: "employee_expense_claims",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_claims_turnaround_id",
                schema: "commercial",
                table: "employee_expense_claims",
                column: "turnaround_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_lines_document_id_line_number",
                schema: "commercial",
                table: "employee_expense_lines",
                columns: new[] { "document_id", "line_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_lines_public_id",
                schema: "commercial",
                table: "employee_expense_lines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_payments_actor_account_id",
                schema: "commercial",
                table: "employee_expense_payments",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_payments_expense_claim_id",
                schema: "commercial",
                table: "employee_expense_payments",
                column: "expense_claim_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_payments_public_id",
                schema: "commercial",
                table: "employee_expense_payments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_reviews_actor_account_id",
                schema: "commercial",
                table: "employee_expense_reviews",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_employee_expense_reviews_document_id",
                schema: "commercial",
                table: "employee_expense_reviews",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_artifacts_document_id",
                schema: "commercial",
                table: "finance_fiscal_artifacts",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_artifacts_object_key",
                schema: "commercial",
                table: "finance_fiscal_artifacts",
                column: "object_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_artifacts_public_id",
                schema: "commercial",
                table: "finance_fiscal_artifacts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_documents_created_by_account_id",
                schema: "commercial",
                table: "finance_fiscal_documents",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_documents_environment_request_id",
                schema: "commercial",
                table: "finance_fiscal_documents",
                columns: new[] { "environment", "request_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_documents_invoice_id_environment_mode",
                schema: "commercial",
                table: "finance_fiscal_documents",
                columns: new[] { "invoice_id", "environment", "mode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_documents_public_id",
                schema: "commercial",
                table: "finance_fiscal_documents",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_events_document_id_event_id",
                schema: "commercial",
                table: "finance_fiscal_events",
                columns: new[] { "document_id", "event_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_events_public_id",
                schema: "commercial",
                table: "finance_fiscal_events",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_intents_dispatch_request_id",
                schema: "commercial",
                table: "finance_fiscal_intents",
                column: "dispatch_request_id",
                unique: true,
                filter: "[dispatch_request_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_intents_dispatched_by_account_id",
                schema: "commercial",
                table: "finance_fiscal_intents",
                column: "dispatched_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_intents_document_id",
                schema: "commercial",
                table: "finance_fiscal_intents",
                column: "document_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_fiscal_intents_public_id",
                schema: "commercial",
                table: "finance_fiscal_intents",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_attachments_expense_claim_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "expense_claim_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_attachments_object_key",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "object_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_attachments_public_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_attachments_supplier_invoice_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "supplier_invoice_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_attachments_uploaded_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "uploaded_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_commands_actor_account_id_request_id",
                schema: "commercial",
                table: "finance_payables_commands",
                columns: new[] { "actor_account_id", "request_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_pricing_commands_actor_account_id",
                schema: "commercial",
                table: "finance_pricing_commands",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_pricing_commands_public_id",
                schema: "commercial",
                table: "finance_pricing_commands",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_pricing_commands_request_id",
                schema: "commercial",
                table: "finance_pricing_commands",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_lines_invoice_line_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                column: "invoice_line_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_lines_note_id_invoice_line_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                columns: new[] { "note_id", "invoice_line_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_lines_public_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_notes_actor_account_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_notes",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_notes_invoice_id_effective_on",
                schema: "commercial",
                table: "finance_treasury_adjustment_notes",
                columns: new[] { "invoice_id", "effective_on" });

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_notes_number",
                schema: "commercial",
                table: "finance_treasury_adjustment_notes",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_notes_public_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_notes",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_notes_related_note_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_notes",
                column: "related_note_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_adjustment_notes_request_id",
                schema: "commercial",
                table: "finance_treasury_adjustment_notes",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_invoice_accounts_invoice_id",
                schema: "commercial",
                table: "finance_treasury_invoice_accounts",
                column: "invoice_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_invoice_accounts_public_id",
                schema: "commercial",
                table: "finance_treasury_invoice_accounts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_movements_actor_account_id",
                schema: "commercial",
                table: "finance_treasury_movements",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_movements_invoice_id_effective_on",
                schema: "commercial",
                table: "finance_treasury_movements",
                columns: new[] { "invoice_id", "effective_on" });

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_movements_public_id",
                schema: "commercial",
                table: "finance_treasury_movements",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_movements_receipt_id_effective_on",
                schema: "commercial",
                table: "finance_treasury_movements",
                columns: new[] { "receipt_id", "effective_on" });

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_movements_reverses_movement_id",
                schema: "commercial",
                table: "finance_treasury_movements",
                column: "reverses_movement_id",
                unique: true,
                filter: "[reverses_movement_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_treasury_receipt_reversal",
                schema: "commercial",
                table: "finance_treasury_movements",
                column: "receipt_id",
                unique: true,
                filter: "[kind] = 'ReceiptReversal'");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_receipts_actor_account_id",
                schema: "commercial",
                table: "finance_treasury_receipts",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_receipts_airline_id_reference",
                schema: "commercial",
                table: "finance_treasury_receipts",
                columns: new[] { "airline_id", "reference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_receipts_public_id",
                schema: "commercial",
                table: "finance_treasury_receipts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_receipts_request_id",
                schema: "commercial",
                table: "finance_treasury_receipts",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_receipts_station_id_airline_id_received_on",
                schema: "commercial",
                table: "finance_treasury_receipts",
                columns: new[] { "station_id", "airline_id", "received_on" });

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_requests_actor_account_id",
                schema: "commercial",
                table: "finance_treasury_requests",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_requests_public_id",
                schema: "commercial",
                table: "finance_treasury_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_requests_request_id",
                schema: "commercial",
                table: "finance_treasury_requests",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_package_consumption_entries_approved_submission_id",
                schema: "commercial",
                table: "package_consumption_entries",
                column: "approved_submission_id");

            migrationBuilder.CreateIndex(
                name: "IX_package_consumption_entries_component_id",
                schema: "commercial",
                table: "package_consumption_entries",
                column: "component_id");

            migrationBuilder.CreateIndex(
                name: "IX_package_consumption_entries_consumption_id_operation_service_id_preinvoice_line_id",
                schema: "commercial",
                table: "package_consumption_entries",
                columns: new[] { "consumption_id", "operation_service_id", "preinvoice_line_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_package_consumption_entries_operation_service_id",
                schema: "commercial",
                table: "package_consumption_entries",
                column: "operation_service_id");

            migrationBuilder.CreateIndex(
                name: "IX_package_consumption_entries_preinvoice_line_id",
                schema: "commercial",
                table: "package_consumption_entries",
                column: "preinvoice_line_id");

            migrationBuilder.CreateIndex(
                name: "IX_package_consumption_entries_public_id",
                schema: "commercial",
                table: "package_consumption_entries",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_package_consumptions_contract_package_id_station_id_scope_key",
                schema: "commercial",
                table: "package_consumptions",
                columns: new[] { "contract_package_id", "station_id", "scope_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_package_consumptions_public_id",
                schema: "commercial",
                table: "package_consumptions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_package_consumptions_station_id",
                schema: "commercial",
                table: "package_consumptions",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_applications_actor_account_id",
                schema: "commercial",
                table: "payable_payment_applications",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_applications_payment_id",
                schema: "commercial",
                table: "payable_payment_applications",
                column: "payment_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_applications_public_id",
                schema: "commercial",
                table: "payable_payment_applications",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_applications_supplier_invoice_id",
                schema: "commercial",
                table: "payable_payment_applications",
                column: "supplier_invoice_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payments_created_by_account_id",
                schema: "commercial",
                table: "payable_payments",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payments_public_id",
                schema: "commercial",
                table: "payable_payments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_payable_payments_scope_station_id_paid_on",
                schema: "commercial",
                table: "payable_payments",
                columns: new[] { "scope_station_id", "paid_on" });

            migrationBuilder.CreateIndex(
                name: "IX_payable_payments_supplier_id",
                schema: "commercial",
                table: "payable_payments",
                column: "supplier_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_package_components_package_version_id_service_definition_id",
                schema: "commercial",
                table: "service_package_components",
                columns: new[] { "package_version_id", "service_definition_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_package_components_public_id",
                schema: "commercial",
                table: "service_package_components",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_package_components_service_definition_id",
                schema: "commercial",
                table: "service_package_components",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_package_versions_code_currency_code",
                schema: "commercial",
                table: "service_package_versions",
                columns: new[] { "code", "currency_code" },
                unique: true,
                filter: "[status] = N'Draft'");

            migrationBuilder.CreateIndex(
                name: "IX_service_package_versions_code_version_number",
                schema: "commercial",
                table: "service_package_versions",
                columns: new[] { "code", "version_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_package_versions_created_by_account_id",
                schema: "commercial",
                table: "service_package_versions",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_package_versions_public_id",
                schema: "commercial",
                table: "service_package_versions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_package_versions_published_by_account_id",
                schema: "commercial",
                table: "service_package_versions",
                column: "published_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoice_lines_document_id_line_number",
                schema: "commercial",
                table: "supplier_invoice_lines",
                columns: new[] { "document_id", "line_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoice_lines_public_id",
                schema: "commercial",
                table: "supplier_invoice_lines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoice_reviews_actor_account_id",
                schema: "commercial",
                table: "supplier_invoice_reviews",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoice_reviews_document_id",
                schema: "commercial",
                table: "supplier_invoice_reviews",
                column: "document_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_airline_id",
                schema: "commercial",
                table: "supplier_invoices",
                column: "airline_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_created_by_account_id",
                schema: "commercial",
                table: "supplier_invoices",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_public_id",
                schema: "commercial",
                table: "supplier_invoices",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_scope_station_id_status",
                schema: "commercial",
                table: "supplier_invoices",
                columns: new[] { "scope_station_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_service_definition_id",
                schema: "commercial",
                table: "supplier_invoices",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_station_id",
                schema: "commercial",
                table: "supplier_invoices",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_supplier_id_document_reference",
                schema: "commercial",
                table: "supplier_invoices",
                columns: new[] { "supplier_id", "document_reference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_turnaround_id",
                schema: "commercial",
                table: "supplier_invoices",
                column: "turnaround_id");

            migrationBuilder.CreateIndex(
                name: "IX_suppliers_created_by_account_id",
                schema: "commercial",
                table: "suppliers",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_suppliers_public_id",
                schema: "commercial",
                table: "suppliers",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_suppliers_scope_station_id_code",
                schema: "commercial",
                table: "suppliers",
                columns: new[] { "scope_station_id", "code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [commercial].[package_consumption_entries])
                   OR EXISTS (SELECT 1 FROM [commercial].[finance_treasury_receipts])
                   OR EXISTS (SELECT 1 FROM [commercial].[finance_treasury_adjustment_notes])
                   OR EXISTS (SELECT 1 FROM [commercial].[finance_fiscal_documents])
                   OR EXISTS (SELECT 1 FROM [commercial].[supplier_invoices])
                   OR EXISTS (SELECT 1 FROM [commercial].[employee_expense_claims])
                BEGIN
                    THROW 51080, 'Finance commercial history must be retained; restore a verified backup instead of reversing this migration.', 1;
                END
                """);

            migrationBuilder.DropTable(
                name: "employee_expense_lines",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "employee_expense_payments",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "employee_expense_reviews",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_fiscal_artifacts",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_fiscal_events",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_fiscal_intents",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_payables_attachments",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_payables_commands",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_pricing_commands",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_treasury_adjustment_lines",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_treasury_invoice_accounts",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_treasury_movements",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_treasury_requests",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "package_consumption_entries",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "payable_payment_applications",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "supplier_invoice_lines",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "supplier_invoice_reviews",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_fiscal_documents",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "employee_expense_claims",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_treasury_adjustment_notes",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "finance_treasury_receipts",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "package_consumptions",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "service_package_components",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "payable_payments",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "supplier_invoices",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "contract_service_packages",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "suppliers",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "service_package_versions",
                schema: "commercial");

            migrationBuilder.DropCheckConstraint(
                name: "ck_preinvoice_line_kind",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "calculation_json",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "computed_is_excluded",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "pricing_policy_version",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "definition_snapshot_json",
                schema: "commercial",
                table: "contract_charge_rates");

            migrationBuilder.AddCheckConstraint(
                name: "ck_preinvoice_line_kind",
                schema: "commercial",
                table: "preinvoice_lines",
                sql: "([kind] = N'Service' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NULL) OR ([kind] = N'Charge' AND [operation_service_id] IS NOT NULL AND [approved_submission_id] IS NOT NULL AND [charge_definition_id] IS NOT NULL AND [parent_line_id] IS NOT NULL) OR ([kind] = N'Adjustment' AND [charge_definition_id] IS NULL AND LEN([adjustment_reason]) >= 3)");
        }
    }
}
