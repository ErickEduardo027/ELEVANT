using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PublicCommercialIntake : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "airline_legal_name_snapshot",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "airline_profile_id",
                schema: "commercial",
                table: "service_requests",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "authority_declared",
                schema: "commercial",
                table: "service_requests",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "contact_title",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "submission_hash",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "display_order",
                schema: "ref",
                table: "service_definitions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "image_url",
                schema: "ref",
                table: "service_definitions",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_public",
                schema: "ref",
                table: "service_definitions",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "video_url",
                schema: "ref",
                table: "service_definitions",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "airline_profiles",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    source_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    display_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    legal_name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    region = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    country_code = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: true),
                    iata_code = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: true),
                    icao_code = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: true),
                    logo_object_key = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    source_url = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: false),
                    verified_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    is_published = table.Column<bool>(type: "bit", nullable: false),
                    canonical_airline_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airline_profiles", x => x.id);
                    table.ForeignKey(
                        name: "FK_airline_profiles_airlines_canonical_airline_id",
                        column: x => x.canonical_airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_airline_profile_id",
                schema: "commercial",
                table: "service_requests",
                column: "airline_profile_id");

            migrationBuilder.CreateIndex(
                name: "IX_airline_profiles_canonical_airline_id",
                schema: "commercial",
                table: "airline_profiles",
                column: "canonical_airline_id");

            migrationBuilder.CreateIndex(
                name: "IX_airline_profiles_public_id",
                schema: "commercial",
                table: "airline_profiles",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airline_profiles_source_name",
                schema: "commercial",
                table: "airline_profiles",
                column: "source_name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_service_requests_airline_profiles_airline_profile_id",
                schema: "commercial",
                table: "service_requests",
                column: "airline_profile_id",
                principalSchema: "commercial",
                principalTable: "airline_profiles",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_service_requests_airline_profiles_airline_profile_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropTable(
                name: "airline_profiles",
                schema: "commercial");

            migrationBuilder.DropIndex(
                name: "IX_service_requests_airline_profile_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "airline_legal_name_snapshot",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "airline_profile_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "authority_declared",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_title",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "submission_hash",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "display_order",
                schema: "ref",
                table: "service_definitions");

            migrationBuilder.DropColumn(
                name: "image_url",
                schema: "ref",
                table: "service_definitions");

            migrationBuilder.DropColumn(
                name: "is_public",
                schema: "ref",
                table: "service_definitions");

            migrationBuilder.DropColumn(
                name: "video_url",
                schema: "ref",
                table: "service_definitions");
        }
    }
}
