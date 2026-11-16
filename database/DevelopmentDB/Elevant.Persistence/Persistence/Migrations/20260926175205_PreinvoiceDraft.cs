using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PreinvoiceDraft : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "preinvoices",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payload_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    from = table.Column<DateOnly>(type: "date", nullable: false),
                    to = table.Column<DateOnly>(type: "date", nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    total = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_preinvoices", x => x.id);
                    table.CheckConstraint("ck_preinvoice_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_preinvoice_dates", "[to] >= [from]");
                    table.CheckConstraint("ck_preinvoice_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.CheckConstraint("ck_preinvoice_total", "[total] >= 0");
                    table.ForeignKey(
                        name: "FK_preinvoices_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoices_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoices_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "preinvoice_lines",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    preinvoice_id = table.Column<long>(type: "bigint", nullable: false),
                    operation_service_id = table.Column<long>(type: "bigint", nullable: false),
                    approved_submission_id = table.Column<long>(type: "bigint", nullable: false),
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
                    table.PrimaryKey("PK_preinvoice_lines", x => x.id);
                    table.CheckConstraint("ck_preinvoice_line_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_preinvoice_line_number", "[line_number] > 0");
                    table.CheckConstraint("ck_preinvoice_line_price", "[unit_price] >= 0 AND [amount] >= 0");
                    table.CheckConstraint("ck_preinvoice_line_quantity", "[executed_quantity] > 0");
                    table.ForeignKey(
                        name: "FK_preinvoice_lines_operation_services_operation_service_id",
                        column: x => x.operation_service_id,
                        principalSchema: "ops",
                        principalTable: "operation_services",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoice_lines_operation_submissions_approved_submission_id",
                        column: x => x.approved_submission_id,
                        principalSchema: "ops",
                        principalTable: "operation_submissions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoice_lines_preinvoices_preinvoice_id",
                        column: x => x.preinvoice_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_approved_submission_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "approved_submission_id");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "operation_service_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_preinvoice_id_line_number",
                schema: "commercial",
                table: "preinvoice_lines",
                columns: new[] { "preinvoice_id", "line_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_public_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoices_airline_id_station_id_status_from",
                schema: "commercial",
                table: "preinvoices",
                columns: new[] { "airline_id", "station_id", "status", "from" });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoices_created_by_account_id",
                schema: "commercial",
                table: "preinvoices",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoices_public_id",
                schema: "commercial",
                table: "preinvoices",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoices_request_id",
                schema: "commercial",
                table: "preinvoices",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoices_station_id",
                schema: "commercial",
                table: "preinvoices",
                column: "station_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "preinvoice_lines",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "preinvoices",
                schema: "commercial");
        }
    }
}
