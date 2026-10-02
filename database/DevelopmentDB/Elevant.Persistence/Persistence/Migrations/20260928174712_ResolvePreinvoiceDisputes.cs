using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ResolvePreinvoiceDisputes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "released_at",
                schema: "commercial",
                table: "preinvoice_lines",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "preinvoice_dispute_resolutions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    dispute_id = table.Column<long>(type: "bigint", nullable: false),
                    resolved_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payload_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    decision = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_preinvoice_dispute_resolutions", x => x.id);
                    table.CheckConstraint("ck_preinvoice_resolution_decision", "[decision] IN ('Maintain', 'Void')");
                    table.CheckConstraint("ck_preinvoice_resolution_reason", "LEN([reason]) BETWEEN 1 AND 1000");
                    table.CheckConstraint("ck_preinvoice_resolution_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.ForeignKey(
                        name: "FK_preinvoice_dispute_resolutions_accounts_resolved_by_account_id",
                        column: x => x.resolved_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoice_dispute_resolutions_preinvoice_disputes_dispute_id",
                        column: x => x.dispute_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoice_disputes",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "operation_service_id",
                unique: true,
                filter: "[released_at] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_resolutions_dispute_id",
                schema: "commercial",
                table: "preinvoice_dispute_resolutions",
                column: "dispute_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_resolutions_public_id",
                schema: "commercial",
                table: "preinvoice_dispute_resolutions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_resolutions_request_id",
                schema: "commercial",
                table: "preinvoice_dispute_resolutions",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_resolutions_resolved_by_account_id",
                schema: "commercial",
                table: "preinvoice_dispute_resolutions",
                column: "resolved_by_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [commercial].[preinvoice_dispute_resolutions])
                    OR EXISTS (SELECT 1 FROM [commercial].[preinvoice_lines]
                               WHERE [released_at] IS NOT NULL)
                BEGIN
                    THROW 51042, 'Resolution history must be retained; restore a verified backup instead of reversing this migration.', 1;
                END
                """);

            migrationBuilder.DropTable(
                name: "preinvoice_dispute_resolutions",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.DropColumn(
                name: "released_at",
                schema: "commercial",
                table: "preinvoice_lines");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_lines_operation_service_id",
                schema: "commercial",
                table: "preinvoice_lines",
                column: "operation_service_id",
                unique: true);
        }
    }
}
