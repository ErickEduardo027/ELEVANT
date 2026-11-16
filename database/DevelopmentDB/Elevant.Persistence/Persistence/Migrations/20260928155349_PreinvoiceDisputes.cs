using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PreinvoiceDisputes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "preinvoice_disputes",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    preinvoice_id = table.Column<long>(type: "bigint", nullable: false),
                    submitted_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    payload_hash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    subject = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_preinvoice_disputes", x => x.id);
                    table.CheckConstraint("ck_preinvoice_dispute_description", "LEN([description]) BETWEEN 1 AND 1000");
                    table.CheckConstraint("ck_preinvoice_dispute_request_id", "[request_id] <> '00000000-0000-0000-0000-000000000000'");
                    table.CheckConstraint("ck_preinvoice_dispute_subject", "LEN([subject]) BETWEEN 1 AND 160");
                    table.ForeignKey(
                        name: "FK_preinvoice_disputes_accounts_submitted_by_account_id",
                        column: x => x.submitted_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoice_disputes_preinvoices_preinvoice_id",
                        column: x => x.preinvoice_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "preinvoice_dispute_lines",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    dispute_id = table.Column<long>(type: "bigint", nullable: false),
                    preinvoice_line_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_preinvoice_dispute_lines", x => x.id);
                    table.ForeignKey(
                        name: "FK_preinvoice_dispute_lines_preinvoice_disputes_dispute_id",
                        column: x => x.dispute_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoice_disputes",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_preinvoice_dispute_lines_preinvoice_lines_preinvoice_line_id",
                        column: x => x.preinvoice_line_id,
                        principalSchema: "commercial",
                        principalTable: "preinvoice_lines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_lines_dispute_id_preinvoice_line_id",
                schema: "commercial",
                table: "preinvoice_dispute_lines",
                columns: new[] { "dispute_id", "preinvoice_line_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_lines_preinvoice_line_id",
                schema: "commercial",
                table: "preinvoice_dispute_lines",
                column: "preinvoice_line_id");

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_dispute_lines_public_id",
                schema: "commercial",
                table: "preinvoice_dispute_lines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_disputes_preinvoice_id_created_at",
                schema: "commercial",
                table: "preinvoice_disputes",
                columns: new[] { "preinvoice_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_disputes_public_id",
                schema: "commercial",
                table: "preinvoice_disputes",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_disputes_request_id",
                schema: "commercial",
                table: "preinvoice_disputes",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_preinvoice_disputes_submitted_by_account_id",
                schema: "commercial",
                table: "preinvoice_disputes",
                column: "submitted_by_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "preinvoice_dispute_lines",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "preinvoice_disputes",
                schema: "commercial");
        }
    }
}
