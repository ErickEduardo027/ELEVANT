using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdjustmentNoteTaxAndCharterPrepaymentLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "charter_agreement_id",
                schema: "commercial",
                table: "finance_treasury_receipts",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "net_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                type: "decimal(19,4)",
                precision: 19,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_rate",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines",
                type: "decimal(9,4)",
                precision: 9,
                scale: 4,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_finance_treasury_receipts_charter_agreement_id",
                schema: "commercial",
                table: "finance_treasury_receipts",
                column: "charter_agreement_id",
                filter: "[charter_agreement_id] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_finance_treasury_receipts_charter_agreements_charter_agreement_id",
                schema: "commercial",
                table: "finance_treasury_receipts",
                column: "charter_agreement_id",
                principalSchema: "ops",
                principalTable: "charter_agreements",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The frozen ITBIS of a credit or debit note is a fiscal snapshot (4-N17) and a charter's prepayment receipt
            // is what keeps it from being applied twice (4-N22): the downgrade stops instead of dropping that history.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.finance_treasury_adjustment_lines WHERE tax_amount IS NOT NULL)
                    THROW 52400, 'Adjustment notes with a frozen tax breakdown exist; fiscal snapshots must be retained.', 1;
                IF EXISTS (SELECT 1 FROM commercial.finance_treasury_receipts WHERE charter_agreement_id IS NOT NULL)
                    THROW 52401, 'Charter prepayment receipts exist; treasury history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_finance_treasury_receipts_charter_agreements_charter_agreement_id",
                schema: "commercial",
                table: "finance_treasury_receipts");

            migrationBuilder.DropIndex(
                name: "IX_finance_treasury_receipts_charter_agreement_id",
                schema: "commercial",
                table: "finance_treasury_receipts");

            migrationBuilder.DropColumn(
                name: "charter_agreement_id",
                schema: "commercial",
                table: "finance_treasury_receipts");

            migrationBuilder.DropColumn(
                name: "net_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines");

            migrationBuilder.DropColumn(
                name: "tax_amount",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines");

            migrationBuilder.DropColumn(
                name: "tax_rate",
                schema: "commercial",
                table: "finance_treasury_adjustment_lines");
        }
    }
}
