using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRampMobileAccessRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ramp_mobile_access_requests",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    requested_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    decided_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    decision_reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    created_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ramp_mobile_access_requests", x => x.id);
                    table.CheckConstraint("ck_ramp_mobile_access_request_decision", "([status] = N'Pending' AND [decided_at] IS NULL AND [decided_by_account_id] IS NULL AND [created_account_id] IS NULL) OR ([status] = N'Rejected' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NULL) OR ([status] = N'Fulfilled' AND [decided_at] IS NOT NULL AND [decided_by_account_id] IS NOT NULL AND [created_account_id] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_ramp_mobile_access_requests_accounts_created_account_id",
                        column: x => x.created_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ramp_mobile_access_requests_accounts_decided_by_account_id",
                        column: x => x.decided_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ramp_mobile_access_requests_accounts_requested_by_account_id",
                        column: x => x.requested_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ramp_mobile_access_requests_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ramp_mobile_access_requests_created_account_id",
                schema: "hr",
                table: "ramp_mobile_access_requests",
                column: "created_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_mobile_access_requests_decided_by_account_id",
                schema: "hr",
                table: "ramp_mobile_access_requests",
                column: "decided_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_mobile_access_requests_public_id",
                schema: "hr",
                table: "ramp_mobile_access_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ramp_mobile_access_requests_ramp_agent_id",
                schema: "hr",
                table: "ramp_mobile_access_requests",
                column: "ramp_agent_id",
                unique: true,
                filter: "[status] = N'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_mobile_access_requests_requested_by_account_id",
                schema: "hr",
                table: "ramp_mobile_access_requests",
                column: "requested_by_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ramp_mobile_access_requests",
                schema: "hr");
        }
    }
}
