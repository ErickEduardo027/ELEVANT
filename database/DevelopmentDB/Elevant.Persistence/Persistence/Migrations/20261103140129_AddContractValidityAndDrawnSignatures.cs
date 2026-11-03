using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddContractValidityAndDrawnSignatures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence(
                name: "contract_code_seq",
                schema: "commercial");

            migrationBuilder.AddColumn<string>(
                name: "attachment_reference",
                schema: "infra",
                table: "email_outbox",
                type: "varchar(80)",
                unicode: false,
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "renewal_mode",
                schema: "commercial",
                table: "contract_versions",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "renewal_notice_days",
                schema: "commercial",
                table: "contract_versions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "renewal_started_at",
                schema: "commercial",
                table: "contract_versions",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "renewal_term_months",
                schema: "commercial",
                table: "contract_versions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "termination_notice_days",
                schema: "commercial",
                table: "contract_versions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "termination_terms",
                schema: "commercial",
                table: "contract_versions",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "validity_confirmed_at",
                schema: "commercial",
                table: "contract_versions",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "validity_confirmed_by_account_id",
                schema: "commercial",
                table: "contract_versions",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "signature_image",
                schema: "commercial",
                table: "contract_signatures",
                type: "varbinary(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "signature_image_sha256",
                schema: "commercial",
                table: "contract_signatures",
                type: "char(64)",
                unicode: false,
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_validity_confirmed_by_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "validity_confirmed_by_account_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_contract_version_renewal_notice",
                schema: "commercial",
                table: "contract_versions",
                sql: "[renewal_notice_days] IS NULL OR [renewal_notice_days] BETWEEN 0 AND 180");

            migrationBuilder.AddCheckConstraint(
                name: "ck_contract_version_renewal_term",
                schema: "commercial",
                table: "contract_versions",
                sql: "[renewal_term_months] IS NULL OR [renewal_term_months] BETWEEN 1 AND 60");

            migrationBuilder.AddCheckConstraint(
                name: "ck_contract_version_termination_notice",
                schema: "commercial",
                table: "contract_versions",
                sql: "[termination_notice_days] IS NULL OR [termination_notice_days] BETWEEN 0 AND 180");

            migrationBuilder.AddForeignKey(
                name: "FK_contract_versions_accounts_validity_confirmed_by_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "validity_confirmed_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_contract_versions_accounts_validity_confirmed_by_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropIndex(
                name: "IX_contract_versions_validity_confirmed_by_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_contract_version_renewal_notice",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_contract_version_renewal_term",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_contract_version_termination_notice",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "attachment_reference",
                schema: "infra",
                table: "email_outbox");

            migrationBuilder.DropColumn(
                name: "renewal_mode",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "renewal_notice_days",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "renewal_started_at",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "renewal_term_months",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "termination_notice_days",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "termination_terms",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "validity_confirmed_at",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "validity_confirmed_by_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "signature_image",
                schema: "commercial",
                table: "contract_signatures");

            migrationBuilder.DropColumn(
                name: "signature_image_sha256",
                schema: "commercial",
                table: "contract_signatures");

            migrationBuilder.DropSequence(
                name: "contract_code_seq",
                schema: "commercial");
        }
    }
}
