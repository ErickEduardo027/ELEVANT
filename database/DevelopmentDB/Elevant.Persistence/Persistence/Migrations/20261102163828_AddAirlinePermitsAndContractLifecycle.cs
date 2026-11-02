using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAirlinePermitsAndContractLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "expiry_notice_sent_at",
                schema: "commercial",
                table: "contracts",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "airline_permits",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    number = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    issuer = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    issued_on = table.Column<DateOnly>(type: "date", nullable: false),
                    expires_on = table.Column<DateOnly>(type: "date", nullable: false),
                    document_url = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    review = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    submitted_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    reviewed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    reviewed_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    review_note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    expiry_notice_sent_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airline_permits", x => x.id);
                    table.CheckConstraint("ck_airline_permit_dates", "[expires_on] >= [issued_on]");
                    table.ForeignKey(
                        name: "FK_airline_permits_accounts_reviewed_by_account_id",
                        column: x => x.reviewed_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_airline_permits_accounts_submitted_by_account_id",
                        column: x => x.submitted_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_airline_permits_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_airline_permits_airline_id_kind_expires_on",
                schema: "commercial",
                table: "airline_permits",
                columns: new[] { "airline_id", "kind", "expires_on" });

            migrationBuilder.CreateIndex(
                name: "IX_airline_permits_public_id",
                schema: "commercial",
                table: "airline_permits",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airline_permits_review_expires_on",
                schema: "commercial",
                table: "airline_permits",
                columns: new[] { "review", "expires_on" });

            migrationBuilder.CreateIndex(
                name: "IX_airline_permits_reviewed_by_account_id",
                schema: "commercial",
                table: "airline_permits",
                column: "reviewed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_airline_permits_submitted_by_account_id",
                schema: "commercial",
                table: "airline_permits",
                column: "submitted_by_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.airline_permits)
                    OR EXISTS (SELECT 1 FROM commercial.contracts WHERE expiry_notice_sent_at IS NOT NULL)
                    THROW 52333, 'Airline permits or contract notices exist; they must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "airline_permits",
                schema: "commercial");

            migrationBuilder.DropColumn(
                name: "expiry_notice_sent_at",
                schema: "commercial",
                table: "contracts");
        }
    }
}
