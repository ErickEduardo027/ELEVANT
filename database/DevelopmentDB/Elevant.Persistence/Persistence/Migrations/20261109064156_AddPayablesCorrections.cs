using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPayablesCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_supplier_invoices_supplier_id_document_reference",
                schema: "commercial",
                table: "supplier_invoices");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "removed_at",
                schema: "commercial",
                table: "finance_payables_attachments",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "removed_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "payable_payment_reversals",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payment_id = table.Column<long>(type: "bigint", nullable: false),
                    application_id = table.Column<long>(type: "bigint", nullable: true),
                    reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: false),
                    reversed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payable_payment_reversals", x => x.id);
                    table.CheckConstraint("ck_payable_payment_reversal_reason", "LEN([reason]) > 0");
                    table.ForeignKey(
                        name: "FK_payable_payment_reversals_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_payable_payment_reversals_payable_payment_applications_application_id",
                        column: x => x.application_id,
                        principalSchema: "commercial",
                        principalTable: "payable_payment_applications",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_payable_payment_reversals_payable_payments_payment_id",
                        column: x => x.payment_id,
                        principalSchema: "commercial",
                        principalTable: "payable_payments",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_supplier_id_document_reference",
                schema: "commercial",
                table: "supplier_invoices",
                columns: new[] { "supplier_id", "document_reference" },
                unique: true,
                filter: "[status] <> N'Voided'");

            migrationBuilder.CreateIndex(
                name: "IX_finance_payables_attachments_removed_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "removed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_reversals_actor_account_id",
                schema: "commercial",
                table: "payable_payment_reversals",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_reversals_application_id",
                schema: "commercial",
                table: "payable_payment_reversals",
                column: "application_id",
                unique: true,
                filter: "[application_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_reversals_payment_id",
                schema: "commercial",
                table: "payable_payment_reversals",
                column: "payment_id",
                unique: true,
                filter: "[application_id] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_payable_payment_reversals_public_id",
                schema: "commercial",
                table: "payable_payment_reversals",
                column: "public_id",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_finance_payables_attachments_accounts_removed_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments",
                column: "removed_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A payment reversal, a removed receipt, a voided supplier invoice and a discarded expense are payables history
            // (4-N03, 4-N04, 4-N13), and the unfiltered reference index cannot be recreated over a voided invoice: the
            // downgrade stops instead of dropping that history.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.payable_payment_reversals)
                    THROW 52410, 'Supplier payment reversals exist; payables history must be retained.', 1;
                IF EXISTS (SELECT 1 FROM commercial.finance_payables_attachments WHERE removed_at IS NOT NULL)
                    THROW 52411, 'Removed payables attachments exist; their history must be retained.', 1;
                IF EXISTS (SELECT 1 FROM commercial.supplier_invoices WHERE status = N'Voided')
                    THROW 52412, 'Voided supplier invoices exist; the previous schema cannot represent them.', 1;
                IF EXISTS (SELECT 1 FROM commercial.employee_expense_claims WHERE status = N'Cancelled')
                    THROW 52413, 'Discarded employee expenses exist; the previous schema cannot represent them.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_finance_payables_attachments_accounts_removed_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments");

            migrationBuilder.DropTable(
                name: "payable_payment_reversals",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_supplier_invoices_supplier_id_document_reference",
                schema: "commercial",
                table: "supplier_invoices");

            migrationBuilder.DropIndex(
                name: "IX_finance_payables_attachments_removed_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments");

            migrationBuilder.DropColumn(
                name: "removed_at",
                schema: "commercial",
                table: "finance_payables_attachments");

            migrationBuilder.DropColumn(
                name: "removed_by_account_id",
                schema: "commercial",
                table: "finance_payables_attachments");

            migrationBuilder.CreateIndex(
                name: "IX_supplier_invoices_supplier_id_document_reference",
                schema: "commercial",
                table: "supplier_invoices",
                columns: new[] { "supplier_id", "document_reference" },
                unique: true);
        }
    }
}
