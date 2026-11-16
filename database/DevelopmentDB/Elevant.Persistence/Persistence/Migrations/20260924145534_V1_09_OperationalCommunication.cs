using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_09_OperationalCommunication : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "operation_messages",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    sender_account_id = table.Column<long>(type: "bigint", nullable: false),
                    mobile_device_id = table.Column<long>(type: "bigint", nullable: true),
                    client_message_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    sender_role = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    content = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_messages", x => x.id);
                    table.CheckConstraint("ck_operation_message_content", "LEN([content]) BETWEEN 1 AND 2000");
                    table.ForeignKey(
                        name: "FK_operation_messages_accounts_sender_account_id",
                        column: x => x.sender_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_messages_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_messages_mobile_devices_mobile_device_id",
                        column: x => x.mobile_device_id,
                        principalSchema: "integration",
                        principalTable: "mobile_devices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operational_notifications",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    recipient_account_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    source_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operational_notifications", x => x.id);
                    table.ForeignKey(
                        name: "FK_operational_notifications_accounts_recipient_account_id",
                        column: x => x.recipient_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_notifications_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_notifications_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_messages_ground_operation_id_sent_at",
                schema: "ops",
                table: "operation_messages",
                columns: new[] { "ground_operation_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_messages_mobile_device_id",
                schema: "ops",
                table: "operation_messages",
                column: "mobile_device_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_messages_public_id",
                schema: "ops",
                table: "operation_messages",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_messages_sender_account_id_client_message_id",
                schema: "ops",
                table: "operation_messages",
                columns: new[] { "sender_account_id", "client_message_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_notifications_ground_operation_id",
                schema: "ops",
                table: "operational_notifications",
                column: "ground_operation_id");

            migrationBuilder.CreateIndex(
                name: "IX_operational_notifications_public_id",
                schema: "ops",
                table: "operational_notifications",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_notifications_recipient_account_id_kind_source_id",
                schema: "ops",
                table: "operational_notifications",
                columns: new[] { "recipient_account_id", "kind", "source_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_notifications_recipient_account_id_occurred_at",
                schema: "ops",
                table: "operational_notifications",
                columns: new[] { "recipient_account_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operational_notifications_station_id",
                schema: "ops",
                table: "operational_notifications",
                column: "station_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "operation_messages",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operational_notifications",
                schema: "ops");
        }
    }
}
