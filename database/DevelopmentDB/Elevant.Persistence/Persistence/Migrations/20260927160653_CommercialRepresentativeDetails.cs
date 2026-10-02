using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommercialRepresentativeDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "contact_address",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(250)",
                maxLength: 250,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_country",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_document_number",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_document_type",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_municipality",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_nationality_code",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_province",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "contact_address",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_country",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_document_number",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_document_type",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_municipality",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_nationality_code",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "contact_province",
                schema: "commercial",
                table: "service_requests");
        }
    }
}
