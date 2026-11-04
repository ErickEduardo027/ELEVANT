using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOperationDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "operation_damage_marks",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    position_x = table.Column<decimal>(type: "decimal(5,4)", precision: 5, scale: 4, nullable: false),
                    position_y = table.Column<decimal>(type: "decimal(5,4)", precision: 5, scale: 4, nullable: false),
                    note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    reported_by_ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    reported_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    photo_object_key = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    photo_content_type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    photo_length = table.Column<int>(type: "int", nullable: true),
                    photo_sha256 = table.Column<string>(type: "nchar(64)", fixedLength: true, maxLength: 64, nullable: true),
                    photo_uploaded_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_damage_marks", x => x.id);
                    table.CheckConstraint("ck_operation_damage_mark_photo", "([photo_object_key] IS NULL AND [photo_sha256] IS NULL AND [photo_uploaded_at] IS NULL) OR ([photo_object_key] IS NOT NULL AND LEN([photo_sha256]) = 64 AND [photo_uploaded_at] IS NOT NULL)");
                    table.CheckConstraint("ck_operation_damage_mark_position", "[position_x] BETWEEN 0 AND 1 AND [position_y] BETWEEN 0 AND 1");
                    table.ForeignKey(
                        name: "FK_operation_damage_marks_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_damage_marks_ramp_agents_reported_by_ramp_agent_id",
                        column: x => x.reported_by_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_document_versions",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    document_number = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    content_json = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    content_sha256 = table.Column<string>(type: "nchar(64)", fixedLength: true, maxLength: 64, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_document_versions", x => x.id);
                    table.CheckConstraint("ck_operation_document_version_sha", "LEN([content_sha256]) = 64");
                    table.ForeignKey(
                        name: "FK_operation_document_versions_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_document_signatures",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_document_version_id = table.Column<long>(type: "bigint", nullable: false),
                    role = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    signer_name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    captured_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    mobile_device_id = table.Column<long>(type: "bigint", nullable: true),
                    signed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    document_sha256 = table.Column<string>(type: "nchar(64)", fixedLength: true, maxLength: 64, nullable: false),
                    strokes_json = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    strokes_sha256 = table.Column<string>(type: "nchar(64)", fixedLength: true, maxLength: 64, nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_document_signatures", x => x.id);
                    table.CheckConstraint("ck_operation_document_signature_sha", "LEN([document_sha256]) = 64 AND LEN([strokes_sha256]) = 64");
                    table.CheckConstraint("ck_operation_document_signature_signer", "LEN([signer_name]) BETWEEN 2 AND 120");
                    table.ForeignKey(
                        name: "FK_operation_document_signatures_accounts_captured_by_account_id",
                        column: x => x.captured_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_document_signatures_mobile_devices_mobile_device_id",
                        column: x => x.mobile_device_id,
                        principalSchema: "integration",
                        principalTable: "mobile_devices",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_document_signatures_operation_document_versions_operation_document_version_id",
                        column: x => x.operation_document_version_id,
                        principalSchema: "ops",
                        principalTable: "operation_document_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_operation_damage_marks_ground_operation_id_reported_at",
                schema: "ops",
                table: "operation_damage_marks",
                columns: new[] { "ground_operation_id", "reported_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_damage_marks_public_id",
                schema: "ops",
                table: "operation_damage_marks",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_damage_marks_reported_by_ramp_agent_id",
                schema: "ops",
                table: "operation_damage_marks",
                column: "reported_by_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_signatures_captured_by_account_id",
                schema: "ops",
                table: "operation_document_signatures",
                column: "captured_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_signatures_mobile_device_id",
                schema: "ops",
                table: "operation_document_signatures",
                column: "mobile_device_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_signatures_operation_document_version_id_role",
                schema: "ops",
                table: "operation_document_signatures",
                columns: new[] { "operation_document_version_id", "role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_signatures_public_id",
                schema: "ops",
                table: "operation_document_signatures",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_signatures_request_id",
                schema: "ops",
                table: "operation_document_signatures",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_versions_ground_operation_id_kind_content_sha256",
                schema: "ops",
                table: "operation_document_versions",
                columns: new[] { "ground_operation_id", "kind", "content_sha256" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_document_versions_public_id",
                schema: "ops",
                table: "operation_document_versions",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "operation_damage_marks",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_document_signatures",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_document_versions",
                schema: "ops");
        }
    }
}
