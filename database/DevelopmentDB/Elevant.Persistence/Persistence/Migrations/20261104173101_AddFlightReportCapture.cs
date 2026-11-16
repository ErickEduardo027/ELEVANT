using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFlightReportCapture : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "delay_code",
                schema: "ops",
                table: "incidents",
                type: "nvarchar(4)",
                maxLength: 4,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "mtow_kg",
                schema: "ops",
                table: "ground_operations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "passengers_in",
                schema: "ops",
                table: "ground_operations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "passengers_out",
                schema: "ops",
                table: "ground_operations",
                type: "int",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_ground_operation_flight_data",
                schema: "ops",
                table: "ground_operations",
                sql: "([passengers_in] IS NULL OR [passengers_in] BETWEEN 0 AND 999) AND ([passengers_out] IS NULL OR [passengers_out] BETWEEN 0 AND 999) AND ([mtow_kg] IS NULL OR [mtow_kg] BETWEEN 1000 AND 700000)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_ground_operation_flight_data",
                schema: "ops",
                table: "ground_operations");

            migrationBuilder.DropColumn(
                name: "delay_code",
                schema: "ops",
                table: "incidents");

            migrationBuilder.DropColumn(
                name: "mtow_kg",
                schema: "ops",
                table: "ground_operations");

            migrationBuilder.DropColumn(
                name: "passengers_in",
                schema: "ops",
                table: "ground_operations");

            migrationBuilder.DropColumn(
                name: "passengers_out",
                schema: "ops",
                table: "ground_operations");
        }
    }
}
