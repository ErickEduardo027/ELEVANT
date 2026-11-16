using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAirlineTaxRegistrationAndRequestRegistryCheck : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "registry_checked_at",
                schema: "commercial",
                table: "service_requests",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registry_detail",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registry_source",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(48)",
                maxLength: 48,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registry_status",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_registration",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_registration_country_code",
                schema: "commercial",
                table: "service_requests",
                type: "char(2)",
                unicode: false,
                fixedLength: true,
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_registration",
                schema: "iam",
                table: "organizations",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tax_registration_country_code",
                schema: "iam",
                table: "organizations",
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
                name: "registry_checked_at",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "registry_detail",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "registry_source",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "registry_status",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "tax_registration",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "tax_registration_country_code",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "tax_registration",
                schema: "iam",
                table: "organizations");

            migrationBuilder.DropColumn(
                name: "tax_registration_country_code",
                schema: "iam",
                table: "organizations");
        }
    }
}
