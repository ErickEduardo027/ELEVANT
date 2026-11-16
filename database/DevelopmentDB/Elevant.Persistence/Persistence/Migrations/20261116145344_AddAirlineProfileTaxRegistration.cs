using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAirlineProfileTaxRegistration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "tax_registration",
                schema: "commercial",
                table: "airline_profiles",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_registration_country_code",
                schema: "commercial",
                table: "airline_profiles",
                type: "char(2)",
                unicode: false,
                fixedLength: true,
                maxLength: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "tax_registration",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "tax_registration_country_code",
                schema: "commercial",
                table: "airline_profiles");
        }
    }
}
