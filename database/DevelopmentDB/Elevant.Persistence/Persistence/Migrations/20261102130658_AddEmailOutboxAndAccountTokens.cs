using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailOutboxAndAccountTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "account_email_tokens",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    purpose = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    challenge_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    secret_hash = table.Column<string>(type: "char(64)", unicode: false, fixedLength: true, maxLength: 64, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    attempts = table.Column<int>(type: "int", nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_email_tokens", x => x.id);
                    table.ForeignKey(
                        name: "FK_account_email_tokens_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "email_outbox",
                schema: "infra",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    recipient = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    subject = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    html_body = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    text_body = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    purpose = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    attempts = table.Column<int>(type: "int", nullable: false),
                    next_attempt_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    last_error = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_email_outbox", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_email_tokens_account_id_purpose_used_at",
                schema: "iam",
                table: "account_email_tokens",
                columns: new[] { "account_id", "purpose", "used_at" });

            migrationBuilder.CreateIndex(
                name: "IX_account_email_tokens_challenge_id_purpose",
                schema: "iam",
                table: "account_email_tokens",
                columns: new[] { "challenge_id", "purpose" });

            migrationBuilder.CreateIndex(
                name: "IX_account_email_tokens_public_id",
                schema: "iam",
                table: "account_email_tokens",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_account_email_tokens_secret_hash",
                schema: "iam",
                table: "account_email_tokens",
                column: "secret_hash");

            migrationBuilder.CreateIndex(
                name: "IX_email_outbox_public_id",
                schema: "infra",
                table: "email_outbox",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_email_outbox_status_next_attempt_at",
                schema: "infra",
                table: "email_outbox",
                columns: new[] { "status", "next_attempt_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM infra.email_outbox) OR EXISTS (SELECT 1 FROM iam.account_email_tokens)
                    THROW 52331, 'Email history exists; it must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "account_email_tokens",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "email_outbox",
                schema: "infra");
        }
    }
}
