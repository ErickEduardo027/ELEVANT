using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPermitTypesAndStandRequiredPermits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "permit_document_types",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_permit_document_types", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "stand_required_permits",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    stand_id = table.Column<long>(type: "bigint", nullable: false),
                    document_type_code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stand_required_permits", x => x.id);
                    table.ForeignKey(
                        name: "FK_stand_required_permits_stands_stand_id",
                        column: x => x.stand_id,
                        principalSchema: "ref",
                        principalTable: "stands",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_permit_document_types_code",
                schema: "ref",
                table: "permit_document_types",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_permit_document_types_public_id",
                schema: "ref",
                table: "permit_document_types",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stand_required_permits_document_type_code",
                schema: "ref",
                table: "stand_required_permits",
                column: "document_type_code");

            migrationBuilder.CreateIndex(
                name: "IX_stand_required_permits_public_id",
                schema: "ref",
                table: "stand_required_permits",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stand_required_permits_stand_id_document_type_code",
                schema: "ref",
                table: "stand_required_permits",
                columns: new[] { "stand_id", "document_type_code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "permit_document_types",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "stand_required_permits",
                schema: "ref");
        }
    }
}
