using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NonFiscalInvoices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "non_fiscal_invoices",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    preinvoice_id = table.Column<long>(type: "bigint", nullable: false),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    issued_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    number = table.Column<string>(type: "nvarchar(35)", maxLength: 35, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_non_fiscal_invoices", x => x.id);
                    table.CheckConstraint("ck_non_fiscal_invoice_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_non_fiscal_invoice_number", "LEN([number]) = 35");
                    table.CheckConstraint("ck_non_fiscal_invoice_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.CheckConstraint("ck_non_fiscal_invoice_total", "[total] >= 0");
                    table.ForeignKey(
                        name: "FK_non_fiscal_invoices_accounts_issued_by_account_id",
                        column: x => x.issued_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_non_fiscal_invoices_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_non_fiscal_invoices_preinvoices_preinvoice_id",
                        column: x => x.preinvoice_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoices",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_non_fiscal_invoices_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "non_fiscal_invoice_lines",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    preinvoice_line_id = table.Column<long>(type: "bigint", nullable: false),
                    line_number = table.Column<int>(type: "int", nullable: false),
                    operation_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    operation_date = table.Column<DateOnly>(type: "date", nullable: false),
                    service_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    service_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    executed_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    billing_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    unit_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_non_fiscal_invoice_lines", x => x.id);
                    table.CheckConstraint("ck_non_fiscal_invoice_line_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_non_fiscal_invoice_line_number", "[line_number] > 0");
                    table.CheckConstraint("ck_non_fiscal_invoice_line_price", "[unit_price] >= 0 AND [amount] >= 0");
                    table.CheckConstraint("ck_non_fiscal_invoice_line_quantity", "[executed_quantity] > 0");
                    table.ForeignKey(
                        name: "FK_non_fiscal_invoice_lines_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_non_fiscal_invoice_lines_preinvoice_lines_preinvoice_line_id",
                        column: x => x.preinvoice_line_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoice_lines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoice_lines_invoice_id_line_number",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                columns: new[] { "invoice_id", "line_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoice_lines_preinvoice_line_id",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                column: "preinvoice_line_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoice_lines_public_id",
                schema: "commercial",
                table: "non_fiscal_invoice_lines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_airline_id_created_at",
                schema: "commercial",
                table: "non_fiscal_invoices",
                columns: new[] { "airline_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_issued_by_account_id",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "issued_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_number",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_preinvoice_id",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "preinvoice_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_public_id",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_request_id",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_station_id",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "station_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "non_fiscal_invoice_lines",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "non_fiscal_invoices",
                schema: "commercial");
        }
    }
}
