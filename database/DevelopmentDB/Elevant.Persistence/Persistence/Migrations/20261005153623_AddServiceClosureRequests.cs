using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceClosureRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "service_closure_requests",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    service_name_snapshot = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    requested_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    decided_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    decision_reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    reopened_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    reopened_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    reopen_reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_closure_requests", x => x.id);
                    table.CheckConstraint("ck_service_closure_decision", "([status] = N'Pending' AND [decided_at] IS NULL AND [decided_by_account_id] IS NULL AND [decision_reason] IS NULL) OR ([status] = N'Approved' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL) OR ([status] = N'Denied' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [decision_reason] IS NOT NULL AND LEN([decision_reason]) >= 10)");
                    table.CheckConstraint("ck_service_closure_reopen", "([reopened_at] IS NULL AND [reopened_by_account_id] IS NULL AND [reopen_reason] IS NULL) OR ([status] = N'Approved' AND [reopened_at] IS NOT NULL AND [reopened_by_account_id] IS NOT NULL AND [reopen_reason] IS NOT NULL AND LEN([reopen_reason]) >= 10)");
                    table.ForeignKey(
                        name: "FK_service_closure_requests_accounts_decided_by_account_id",
                        column: x => x.decided_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_closure_requests_accounts_reopened_by_account_id",
                        column: x => x.reopened_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_closure_requests_accounts_requested_by_account_id",
                        column: x => x.requested_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_closure_requests_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_service_closure_requests_decided_by_account_id",
                schema: "commercial",
                table: "service_closure_requests",
                column: "decided_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_closure_requests_public_id",
                schema: "commercial",
                table: "service_closure_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_closure_requests_reopened_by_account_id",
                schema: "commercial",
                table: "service_closure_requests",
                column: "reopened_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_closure_requests_requested_by_account_id",
                schema: "commercial",
                table: "service_closure_requests",
                column: "requested_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_closure_requests_service_definition_id",
                schema: "commercial",
                table: "service_closure_requests",
                column: "service_definition_id",
                unique: true,
                filter: "[status] = N'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "service_closure_requests",
                schema: "commercial");
        }
    }
}
