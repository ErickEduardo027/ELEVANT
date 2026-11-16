using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_01_Platform : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "infra");

            migrationBuilder.CreateTable(
                name: "outbox_messages",
                schema: "infra",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    event_type = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    payload_json = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    attempt_count = table.Column<int>(type: "int", nullable: false),
                    last_error = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_outbox_messages", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_outbox_messages_processed_at_occurred_at",
                schema: "infra",
                table: "outbox_messages",
                columns: new[] { "processed_at", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_outbox_messages_public_id",
                schema: "infra",
                table: "outbox_messages",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "outbox_messages",
                schema: "infra");
        }
    }
}
