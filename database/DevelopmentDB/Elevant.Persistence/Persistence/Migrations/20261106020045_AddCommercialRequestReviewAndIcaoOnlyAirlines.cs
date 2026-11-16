using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCommercialRequestReviewAndIcaoOnlyAirlines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_airlines_iata_code",
                schema: "ref",
                table: "airlines");

            migrationBuilder.AddColumn<string>(
                name: "proposed_airline_country_code",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "proposed_airline_iata_code",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "proposed_airline_icao_code",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(3)",
                maxLength: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "proposed_airline_website_url",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "representative_confirmation_note",
                schema: "commercial",
                table: "service_requests",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "representative_confirmed_at",
                schema: "commercial",
                table: "service_requests",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "representative_confirmed_by_account_id",
                schema: "commercial",
                table: "service_requests",
                type: "bigint",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "iata_code",
                schema: "ref",
                table: "airlines",
                type: "char(2)",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "char(2)");

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_representative_confirmed_by_account_id",
                schema: "commercial",
                table: "service_requests",
                column: "representative_confirmed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_airlines_iata_code",
                schema: "ref",
                table: "airlines",
                column: "iata_code",
                unique: true,
                filter: "[iata_code] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_service_requests_accounts_representative_confirmed_by_account_id",
                schema: "commercial",
                table: "service_requests",
                column: "representative_confirmed_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Representative confirmations, proposed airlines and airlines without an IATA designator
            // are commercial history (requests, contracts and invoices refer to them): the downgrade
            // stops instead of dropping or inventing that data.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.service_requests
                           WHERE representative_confirmed_at IS NOT NULL
                              OR representative_confirmed_by_account_id IS NOT NULL
                              OR representative_confirmation_note IS NOT NULL
                              OR proposed_airline_country_code IS NOT NULL
                              OR proposed_airline_iata_code IS NOT NULL
                              OR proposed_airline_icao_code IS NOT NULL
                              OR proposed_airline_website_url IS NOT NULL)
                   OR EXISTS (SELECT 1 FROM ref.airlines WHERE iata_code IS NULL)
                    THROW 52370, 'Representative confirmations, proposed airlines or airlines without IATA code exist; commercial history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_service_requests_accounts_representative_confirmed_by_account_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropIndex(
                name: "IX_service_requests_representative_confirmed_by_account_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropIndex(
                name: "IX_airlines_iata_code",
                schema: "ref",
                table: "airlines");

            migrationBuilder.DropColumn(
                name: "proposed_airline_country_code",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "proposed_airline_iata_code",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "proposed_airline_icao_code",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "proposed_airline_website_url",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "representative_confirmation_note",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "representative_confirmed_at",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "representative_confirmed_by_account_id",
                schema: "commercial",
                table: "service_requests");

            // No default value: the guard above already proved there is no NULL to fill.
            migrationBuilder.AlterColumn<string>(
                name: "iata_code",
                schema: "ref",
                table: "airlines",
                type: "char(2)",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "char(2)",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_airlines_iata_code",
                schema: "ref",
                table: "airlines",
                column: "iata_code",
                unique: true);
        }
    }
}
