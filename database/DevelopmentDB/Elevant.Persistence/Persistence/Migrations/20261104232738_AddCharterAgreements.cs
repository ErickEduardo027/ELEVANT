using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCharterAgreements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "signer_identification",
                schema: "ops",
                table: "operation_document_signatures",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "charter_agreements",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: false),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    currency_code = table.Column<string>(type: "nchar(3)", fixedLength: true, maxLength: 3, nullable: false),
                    carrier_address = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    charges_payable_by = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                    prepayment_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    prepayment_amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    prepayment_reference = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    prepayment_confirmed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    prepayment_confirmed_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_charter_agreements", x => x.id);
                    table.CheckConstraint("ck_charter_agreement_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_charter_agreement_prepayment", "([prepayment_status] = 'Pending' AND [prepayment_confirmed_at] IS NULL) OR ([prepayment_status] = 'Confirmed' AND [prepayment_confirmed_at] IS NOT NULL AND [prepayment_amount] > 0 AND [prepayment_confirmed_by_account_id] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_charter_agreements_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_charter_agreements_accounts_prepayment_confirmed_by_account_id",
                        column: x => x.prepayment_confirmed_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_charter_agreements_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_charter_agreements_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_charter_agreements_airline_id",
                schema: "ops",
                table: "charter_agreements",
                column: "airline_id");

            migrationBuilder.CreateIndex(
                name: "IX_charter_agreements_created_by_account_id",
                schema: "ops",
                table: "charter_agreements",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_charter_agreements_prepayment_confirmed_by_account_id",
                schema: "ops",
                table: "charter_agreements",
                column: "prepayment_confirmed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_charter_agreements_prepayment_status_created_at",
                schema: "ops",
                table: "charter_agreements",
                columns: new[] { "prepayment_status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_charter_agreements_public_id",
                schema: "ops",
                table: "charter_agreements",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_charter_agreements_turnaround_id",
                schema: "ops",
                table: "charter_agreements",
                column: "turnaround_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "charter_agreements",
                schema: "ops");

            migrationBuilder.DropColumn(
                name: "signer_identification",
                schema: "ops",
                table: "operation_document_signatures");
        }
    }
}
