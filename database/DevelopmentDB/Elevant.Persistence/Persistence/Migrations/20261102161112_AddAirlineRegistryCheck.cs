using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAirlineRegistryCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "registry_checked_at",
                schema: "commercial",
                table: "airline_profiles",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registry_entity_url",
                schema: "commercial",
                table: "airline_profiles",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registry_source",
                schema: "commercial",
                table: "airline_profiles",
                type: "nvarchar(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registry_status",
                schema: "commercial",
                table: "airline_profiles",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.airline_profiles WHERE registry_checked_at IS NOT NULL)
                    THROW 52332, 'Airline registry checks exist; they must be retained.', 1;
                """);

            migrationBuilder.DropColumn(
                name: "registry_checked_at",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "registry_entity_url",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "registry_source",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "registry_status",
                schema: "commercial",
                table: "airline_profiles");
        }
    }
}
