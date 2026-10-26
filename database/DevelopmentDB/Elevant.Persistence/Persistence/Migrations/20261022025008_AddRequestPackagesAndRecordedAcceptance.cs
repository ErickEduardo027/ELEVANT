using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestPackagesAndRecordedAcceptance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_contracts_originating_service_request_id",
                schema: "commercial",
                table: "contracts");

            migrationBuilder.AddColumn<long>(
                name: "actor_account_id",
                schema: "commercial",
                table: "contract_signing_events",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "document_sha256",
                schema: "commercial",
                table: "contract_signing_events",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "request_id",
                schema: "commercial",
                table: "contract_signing_events",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "airline_acceptance_request_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "airline_accepted_at",
                schema: "commercial",
                table: "contract_signing_envelopes",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "aviam_acceptance_request_id",
                schema: "commercial",
                table: "contract_signing_envelopes",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "aviam_accepted_at",
                schema: "commercial",
                table: "contract_signing_envelopes",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "signing_method",
                schema: "commercial",
                table: "contract_signing_envelopes",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Adobe");

            migrationBuilder.AddColumn<string>(
                name: "snapshot_json",
                schema: "commercial",
                table: "contract_signing_envelopes",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "service_request_package_selections",
                schema: "commercial",
                columns: table => new
                {
                    service_request_id = table.Column<long>(type: "bigint", nullable: false),
                    package_version_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_request_package_selections", x => new { x.service_request_id, x.package_version_id });
                    table.ForeignKey(
                        name: "FK_service_request_package_selections_service_package_versions_package_version_id",
                        column: x => x.package_version_id,
                        principalSchema: "commercial",
                        principalTable: "service_package_versions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_request_package_selections_service_requests_service_request_id",
                        column: x => x.service_request_id,
                        principalSchema: "commercial",
                        principalTable: "service_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_contracts_originating_service_request_id",
                schema: "commercial",
                table: "contracts",
                column: "originating_service_request_id",
                unique: true,
                filter: "[originating_service_request_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_events_actor_account_id",
                schema: "commercial",
                table: "contract_signing_events",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_signing_events_envelope_id_request_id",
                schema: "commercial",
                table: "contract_signing_events",
                columns: new[] { "envelope_id", "request_id" },
                unique: true,
                filter: "[request_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_service_request_package_selections_package_version_id",
                schema: "commercial",
                table: "service_request_package_selections",
                column: "package_version_id");

            migrationBuilder.AddForeignKey(
                name: "FK_contract_signing_events_accounts_actor_account_id",
                schema: "commercial",
                table: "contract_signing_events",
                column: "actor_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_contract_signing_events_accounts_actor_account_id",
                schema: "commercial",
                table: "contract_signing_events");

            migrationBuilder.DropTable(
                name: "service_request_package_selections",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_contracts_originating_service_request_id",
                schema: "commercial",
                table: "contracts");

            migrationBuilder.DropIndex(
                name: "IX_contract_signing_events_actor_account_id",
                schema: "commercial",
                table: "contract_signing_events");

            migrationBuilder.DropIndex(
                name: "IX_contract_signing_events_envelope_id_request_id",
                schema: "commercial",
                table: "contract_signing_events");

            migrationBuilder.DropColumn(
                name: "actor_account_id",
                schema: "commercial",
                table: "contract_signing_events");

            migrationBuilder.DropColumn(
                name: "document_sha256",
                schema: "commercial",
                table: "contract_signing_events");

            migrationBuilder.DropColumn(
                name: "request_id",
                schema: "commercial",
                table: "contract_signing_events");

            migrationBuilder.DropColumn(
                name: "airline_acceptance_request_id",
                schema: "commercial",
                table: "contract_signing_envelopes");

            migrationBuilder.DropColumn(
                name: "airline_accepted_at",
                schema: "commercial",
                table: "contract_signing_envelopes");

            migrationBuilder.DropColumn(
                name: "aviam_acceptance_request_id",
                schema: "commercial",
                table: "contract_signing_envelopes");

            migrationBuilder.DropColumn(
                name: "aviam_accepted_at",
                schema: "commercial",
                table: "contract_signing_envelopes");

            migrationBuilder.DropColumn(
                name: "signing_method",
                schema: "commercial",
                table: "contract_signing_envelopes");

            migrationBuilder.DropColumn(
                name: "snapshot_json",
                schema: "commercial",
                table: "contract_signing_envelopes");

            migrationBuilder.CreateIndex(
                name: "IX_contracts_originating_service_request_id",
                schema: "commercial",
                table: "contracts",
                column: "originating_service_request_id");
        }
    }
}
