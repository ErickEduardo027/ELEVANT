using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSimulatedCardPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "card_payment_attempts",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    idempotency_key = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    request_hash = table.Column<string>(type: "char(64)", nullable: false),
                    amount = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    brand = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    last4 = table.Column<string>(type: "char(4)", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    decline_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    authorization_code = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: true),
                    receipt_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_card_payment_attempts", x => x.id);
                    table.CheckConstraint("ck_card_payment_attempt_amount", "[amount] > 0");
                    table.CheckConstraint("ck_card_payment_attempt_currency", "[currency_code] IN ('USD','DOP')");
                    table.CheckConstraint("ck_card_payment_attempt_last4", "[last4] LIKE '[0-9][0-9][0-9][0-9]'");
                    table.CheckConstraint("ck_card_payment_attempt_outcome", "([status] = 'Approved' AND [authorization_code] IS NOT NULL AND [receipt_id] IS NOT NULL AND [decline_code] IS NULL) OR ([status] IN ('Declined','Error') AND [authorization_code] IS NULL AND [receipt_id] IS NULL AND [decline_code] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_card_payment_attempts_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_card_payment_attempts_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_card_payment_attempts_finance_treasury_receipts_receipt_id",
                        column: x => x.receipt_id,
                        principalSchema: "commercial",
                        principalTable: "finance_treasury_receipts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_card_payment_attempts_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_card_payment_attempts_account_id_idempotency_key",
                schema: "commercial",
                table: "card_payment_attempts",
                columns: new[] { "account_id", "idempotency_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_card_payment_attempts_airline_id",
                schema: "commercial",
                table: "card_payment_attempts",
                column: "airline_id");

            migrationBuilder.CreateIndex(
                name: "IX_card_payment_attempts_invoice_id_created_at",
                schema: "commercial",
                table: "card_payment_attempts",
                columns: new[] { "invoice_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_card_payment_attempts_public_id",
                schema: "commercial",
                table: "card_payment_attempts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_card_payment_attempts_receipt_id",
                schema: "commercial",
                table: "card_payment_attempts",
                column: "receipt_id",
                unique: true,
                filter: "[receipt_id] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ADR-0036: card payment attempts are part of the payment history.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.card_payment_attempts)
                    THROW 52360, 'Card payment attempts already exist; payment history must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "card_payment_attempts",
                schema: "commercial");
        }
    }
}
