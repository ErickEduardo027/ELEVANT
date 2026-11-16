using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOperationMessageReads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "operation_message_reads",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    last_read_message_id = table.Column<long>(type: "bigint", nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_message_reads", x => x.id);
                    table.ForeignKey(
                        name: "FK_operation_message_reads_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_message_reads_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_message_reads_operation_messages_last_read_message_id",
                        column: x => x.last_read_message_id,
                        principalSchema: "ops",
                        principalTable: "operation_messages",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_message_reads_account_id_ground_operation_id",
                schema: "ops",
                table: "operation_message_reads",
                columns: new[] { "account_id", "ground_operation_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_message_reads_ground_operation_id",
                schema: "ops",
                table: "operation_message_reads",
                column: "ground_operation_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_message_reads_last_read_message_id",
                schema: "ops",
                table: "operation_message_reads",
                column: "last_read_message_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_message_reads_public_id",
                schema: "ops",
                table: "operation_message_reads",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "operation_message_reads",
                schema: "ops");
        }
    }
}
