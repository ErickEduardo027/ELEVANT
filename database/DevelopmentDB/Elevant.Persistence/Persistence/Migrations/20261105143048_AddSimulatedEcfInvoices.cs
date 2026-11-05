using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSimulatedEcfInvoices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "fiscal_number",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "char(13)",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "fiscal_signed_at",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "security_code",
                schema: "commercial",
                table: "non_fiscal_invoices",
                type: "char(6)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_non_fiscal_invoices_fiscal_number",
                schema: "commercial",
                table: "non_fiscal_invoices",
                column: "fiscal_number",
                unique: true,
                filter: "[fiscal_number] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_non_fiscal_invoice_fiscal_identity",
                schema: "commercial",
                table: "non_fiscal_invoices",
                sql: "([fiscal_number] IS NULL AND [security_code] IS NULL AND [fiscal_signed_at] IS NULL) OR ([fiscal_number] LIKE 'E31[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND LEN([security_code]) = 6 AND [fiscal_signed_at] IS NOT NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ADR-0035: an issued e-NCF is part of the invoice history.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.non_fiscal_invoices WHERE fiscal_number IS NOT NULL)
                    THROW 52350, 'Simulated e-CF invoices already exist; invoice history must be retained.', 1;
                """);

            migrationBuilder.DropIndex(
                name: "IX_non_fiscal_invoices_fiscal_number",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropCheckConstraint(
                name: "ck_non_fiscal_invoice_fiscal_identity",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "fiscal_number",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "fiscal_signed_at",
                schema: "commercial",
                table: "non_fiscal_invoices");

            migrationBuilder.DropColumn(
                name: "security_code",
                schema: "commercial",
                table: "non_fiscal_invoices");
        }
    }
}
