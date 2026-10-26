using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddContractSigningEnvelope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "requires_electronic_signing",
                schema: "commercial",
                table: "contracts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "airline_signer_account_id",
                schema: "commercial",
                table: "contract_versions",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "aviam_signer_account_id",
                schema: "commercial",
                table: "contract_versions",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "contract_signing_envelopes",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    aviam_signer_account_id = table.Column<long>(type: "bigint", nullable: false),
                    airline_signer_account_id = table.Column<long>(type: "bigint", nullable: false),
                    aviam_signer_email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    airline_signer_email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    template_version = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    template_sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    draft_object_key = table.Column<string>(type: "nvarchar(240)", maxLength: 240, nullable: false),
                    draft_sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    adobe_agreement_id = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                    signed_object_key = table.Column<string>(type: "nvarchar(240)", maxLength: 240, nullable: true),
                    signed_sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    audit_object_key = table.Column<string>(type: "nvarchar(240)", maxLength: 240, nullable: true),
                    audit_sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    issued_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    formalized_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    last_checked_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    next_check_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    check_attempts = table.Column<int>(type: "int", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_signing_envelopes", x => x.id);
                    table.CheckConstraint("ck_contract_signing_attempts", "[check_attempts] >= 0");
                    table.CheckConstraint("ck_contract_signing_audit_hash", "[audit_sha256] IS NULL OR LEN([audit_sha256]) = 64");
                    table.CheckConstraint("ck_contract_signing_draft_hash", "LEN([draft_sha256]) = 64");
                    table.CheckConstraint("ck_contract_signing_signed_hash", "[signed_sha256] IS NULL OR LEN([signed_sha256]) = 64");
                    table.CheckConstraint("ck_contract_signing_template_hash", "LEN([template_sha256]) = 64");
                    table.ForeignKey(
                        name: "FK_contract_signing_envelopes_accounts_airline_signer_account_id",
                        column: x => x.airline_signer_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_signing_envelopes_accounts_aviam_signer_account_id",
                        column: x => x.aviam_signer_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_signing_envelopes_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_signing_events",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    envelope_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    provider_event_id = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_signing_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_contract_signing_events_contract_signing_envelopes_envelope_id",
                        column: x => x.envelope_id,
                        principalSchema: "commercial",
                        principalTable: "contract_signing_envelopes",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_airline_signer_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "airline_signer_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_aviam_signer_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "aviam_signer_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_envelopes_adobe_agreement_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                column: "adobe_agreement_id",
                unique: true,
                filter: "[adobe_agreement_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_envelopes_airline_signer_account_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                column: "airline_signer_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_envelopes_aviam_signer_account_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                column: "aviam_signer_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_envelopes_contract_version_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                column: "contract_version_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_envelopes_public_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_envelopes_status_next_check_at",
                schema: "commercial",
                table: "contract_signing_envelopes",
                columns: new[] { "status", "next_check_at" });

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_events_envelope_id_occurred_at",
                schema: "commercial",
                table: "contract_signing_events",
                columns: new[] { "envelope_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_events_envelope_id_provider_event_id",
                schema: "commercial",
                table: "contract_signing_events",
                columns: new[] { "envelope_id", "provider_event_id" },
                unique: true,
                filter: "[provider_event_id] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_contract_versions_accounts_airline_signer_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "airline_signer_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");

            migrationBuilder.AddForeignKey(
                name: "FK_contract_versions_accounts_aviam_signer_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "aviam_signer_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_contract_versions_accounts_airline_signer_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropForeignKey(
                name: "FK_contract_versions_accounts_aviam_signer_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropTable(
                name: "contract_signing_events",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "contract_signing_envelopes",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_contract_versions_airline_signer_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropIndex(
                name: "IX_contract_versions_aviam_signer_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "requires_electronic_signing",
                schema: "commercial",
                table: "contracts");

            migrationBuilder.DropColumn(
                name: "airline_signer_account_id",
                schema: "commercial",
                table: "contract_versions");

            migrationBuilder.DropColumn(
                name: "aviam_signer_account_id",
                schema: "commercial",
                table: "contract_versions");
        }
    }
}
