using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRepresentativeDistrictAndAirlineCodeUniqueness : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Verified airline profiles must not share designators; stop with a clear message
            // instead of a generic index failure so the operator can correct the duplicates first.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT iata_code FROM commercial.airline_profiles
                           WHERE iata_code IS NOT NULL AND verified_at IS NOT NULL
                           GROUP BY iata_code HAVING COUNT(*) > 1)
                   OR EXISTS (SELECT icao_code FROM commercial.airline_profiles
                              WHERE icao_code IS NOT NULL AND verified_at IS NOT NULL
                              GROUP BY icao_code HAVING COUNT(*) > 1)
                    THROW 52300, 'Two verified airline profiles share an IATA or ICAO code; correct them before applying this migration.', 1;
                """);

            migrationBuilder.AddColumn<string>(
                name: "contact_district",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ux_airline_profiles_verified_iata",
                schema: "commercial",
                table: "airline_profiles",
                column: "iata_code",
                unique: true,
                filter: "[iata_code] IS NOT NULL AND [verified_at] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_airline_profiles_verified_icao",
                schema: "commercial",
                table: "airline_profiles",
                column: "icao_code",
                unique: true,
                filter: "[icao_code] IS NOT NULL AND [verified_at] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.service_requests WHERE contact_district IS NOT NULL)
                    THROW 52301, 'Requests already record a municipal district; history must be retained.', 1;
                """);

            migrationBuilder.DropIndex(
                name: "ux_airline_profiles_verified_iata",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropIndex(
                name: "ux_airline_profiles_verified_icao",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "contact_district",
                schema: "commercial",
                table: "service_requests");
        }
    }
}
