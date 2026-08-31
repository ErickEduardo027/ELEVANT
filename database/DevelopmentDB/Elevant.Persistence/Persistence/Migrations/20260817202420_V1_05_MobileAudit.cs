using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_05_MobileAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "audit");

            migrationBuilder.EnsureSchema(
                name: "integration");

            migrationBuilder.CreateTable(
                name: "audit_entries",
                schema: "audit",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    actor_type = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: true),
                    actor_display = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    action = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    entity_type = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    entity_public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    organization_id = table.Column<long>(type: "bigint", nullable: true),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    source = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    correlation_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    request_id = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    reason = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    metadata_json = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_entries", x => x.id);
                    table.ForeignKey(
                        name: "FK_audit_entries_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_audit_entries_organizations_organization_id",
                        column: x => x.organization_id,
                        principalSchema: "iam",
                        principalTable: "organizations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_audit_entries_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "mobile_devices",
                schema: "integration",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    installation_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    platform = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    device_name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    app_version = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    operating_system_version = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    last_seen_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mobile_devices", x => x.id);
                    table.CheckConstraint("ck_mobile_device_revoked", "[revoked_at] IS NULL OR [revoked_at] >= [last_seen_at]");
                });

            migrationBuilder.CreateTable(
                name: "audit_changes",
                schema: "audit",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    audit_entry_id = table.Column<long>(type: "bigint", nullable: false),
                    property_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    old_value = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    new_value = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_changes", x => x.id);
                    table.ForeignKey(
                        name: "FK_audit_changes_audit_entries_audit_entry_id",
                        column: x => x.audit_entry_id,
                        principalSchema: "audit",
                        principalTable: "audit_entries",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "mobile_command_receipts",
                schema: "integration",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    mobile_device_id = table.Column<long>(type: "bigint", nullable: false),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    client_batch_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    idempotency_key = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    command_type = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    payload_hash = table.Column<string>(type: "char(64)", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    result_json = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    error_code = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    error_message = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mobile_command_receipts", x => x.id);
                    table.CheckConstraint("ck_mobile_command_expiry", "[expires_at] > [received_at]");
                    table.CheckConstraint("ck_mobile_command_hash", "LEN([payload_hash]) = 64");
                    table.CheckConstraint("ck_mobile_command_processed", "[processed_at] IS NULL OR [processed_at] >= [received_at]");
                    table.ForeignKey(
                        name: "FK_mobile_command_receipts_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_mobile_command_receipts_mobile_devices_mobile_device_id",
                        column: x => x.mobile_device_id,
                        principalSchema: "integration",
                        principalTable: "mobile_devices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "mobile_device_account_bindings",
                schema: "integration",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    mobile_device_id = table.Column<long>(type: "bigint", nullable: false),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    bound_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    unbound_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mobile_device_account_bindings", x => x.id);
                    table.CheckConstraint("ck_device_binding_dates", "[unbound_at] IS NULL OR [unbound_at] >= [bound_at]");
                    table.ForeignKey(
                        name: "FK_mobile_device_account_bindings_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_mobile_device_account_bindings_mobile_devices_mobile_device_id",
                        column: x => x.mobile_device_id,
                        principalSchema: "integration",
                        principalTable: "mobile_devices",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_changes_audit_entry_id",
                schema: "audit",
                table: "audit_changes",
                column: "audit_entry_id");

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_actor_account_id_occurred_at",
                schema: "audit",
                table: "audit_entries",
                columns: new[] { "actor_account_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_correlation_id",
                schema: "audit",
                table: "audit_entries",
                column: "correlation_id");

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_entity_type_entity_public_id_occurred_at",
                schema: "audit",
                table: "audit_entries",
                columns: new[] { "entity_type", "entity_public_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_organization_id_occurred_at",
                schema: "audit",
                table: "audit_entries",
                columns: new[] { "organization_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_public_id",
                schema: "audit",
                table: "audit_entries",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_audit_entries_station_id_occurred_at",
                schema: "audit",
                table: "audit_entries",
                columns: new[] { "station_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_mobile_command_receipts_account_id_client_batch_id",
                schema: "integration",
                table: "mobile_command_receipts",
                columns: new[] { "account_id", "client_batch_id" });

            migrationBuilder.CreateIndex(
                name: "IX_mobile_command_receipts_expires_at",
                schema: "integration",
                table: "mobile_command_receipts",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_mobile_command_receipts_mobile_device_id_idempotency_key",
                schema: "integration",
                table: "mobile_command_receipts",
                columns: new[] { "mobile_device_id", "idempotency_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_mobile_command_receipts_public_id",
                schema: "integration",
                table: "mobile_command_receipts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_mobile_command_receipts_status_received_at",
                schema: "integration",
                table: "mobile_command_receipts",
                columns: new[] { "status", "received_at" });

            migrationBuilder.CreateIndex(
                name: "IX_mobile_device_account_bindings_account_id",
                schema: "integration",
                table: "mobile_device_account_bindings",
                column: "account_id");

            migrationBuilder.CreateIndex(
                name: "IX_mobile_device_account_bindings_mobile_device_id",
                schema: "integration",
                table: "mobile_device_account_bindings",
                column: "mobile_device_id",
                unique: true,
                filter: "[unbound_at] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_mobile_device_account_bindings_mobile_device_id_account_id_bound_at",
                schema: "integration",
                table: "mobile_device_account_bindings",
                columns: new[] { "mobile_device_id", "account_id", "bound_at" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_mobile_devices_installation_id",
                schema: "integration",
                table: "mobile_devices",
                column: "installation_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_mobile_devices_platform_revoked_at",
                schema: "integration",
                table: "mobile_devices",
                columns: new[] { "platform", "revoked_at" });

            migrationBuilder.CreateIndex(
                name: "IX_mobile_devices_public_id",
                schema: "integration",
                table: "mobile_devices",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_changes",
                schema: "audit");

            migrationBuilder.DropTable(
                name: "mobile_command_receipts",
                schema: "integration");

            migrationBuilder.DropTable(
                name: "mobile_device_account_bindings",
                schema: "integration");

            migrationBuilder.DropTable(
                name: "audit_entries",
                schema: "audit");

            migrationBuilder.DropTable(
                name: "mobile_devices",
                schema: "integration");
        }
    }
}
