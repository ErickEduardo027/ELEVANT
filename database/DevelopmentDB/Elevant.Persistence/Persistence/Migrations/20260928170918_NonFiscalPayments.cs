using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NonFiscalPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "non_fiscal_payments",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    recorded_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    reference = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_non_fiscal_payments", x => x.id);
                    table.CheckConstraint("ck_non_fiscal_payment_amount", "[amount] > 0");
                    table.CheckConstraint("ck_non_fiscal_payment_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_non_fiscal_payment_reference", "LEN([reference]) BETWEEN 8 AND 80");
                    table.CheckConstraint("ck_non_fiscal_payment_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.ForeignKey(
                        name: "FK_non_fiscal_payments_accounts_recorded_by_account_id",
                        column: x => x.recorded_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_non_fiscal_payments_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_invoice_id",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "invoice_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_public_id",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_recorded_by_account_id",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "recorded_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_reference",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_payments_request_id",
                schema: "commercial",
                table: "non_fiscal_payments",
                column: "request_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "non_fiscal_payments",
                schema: "commercial");
        }
    }
}
