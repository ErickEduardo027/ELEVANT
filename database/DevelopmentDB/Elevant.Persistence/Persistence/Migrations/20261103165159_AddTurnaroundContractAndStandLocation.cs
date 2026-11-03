using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTurnaroundContractAndStandLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "contract_version_id",
                schema: "ops",
                table: "turnarounds",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "latitude",
                schema: "ref",
                table: "stands",
                type: "decimal(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "located_at",
                schema: "ref",
                table: "stands",
                type: "datetimeoffset(3)",
                precision: 3,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "longitude",
                schema: "ref",
                table: "stands",
                type: "decimal(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_contract_version_id",
                schema: "ops",
                table: "turnarounds",
                column: "contract_version_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_stands_latitude",
                schema: "ref",
                table: "stands",
                sql: "[latitude] IS NULL OR [latitude] BETWEEN -90 AND 90");

            migrationBuilder.AddCheckConstraint(
                name: "ck_stands_location_pair",
                schema: "ref",
                table: "stands",
                sql: "([latitude] IS NULL AND [longitude] IS NULL) OR ([latitude] IS NOT NULL AND [longitude] IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_stands_longitude",
                schema: "ref",
                table: "stands",
                sql: "[longitude] IS NULL OR [longitude] BETWEEN -180 AND 180");

            migrationBuilder.AddForeignKey(
                name: "FK_turnarounds_contract_versions_contract_version_id",
                schema: "ops",
                table: "turnarounds",
                column: "contract_version_id",
                principalSchema: "commercial",
                principalTable: "contract_versions",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_turnarounds_contract_versions_contract_version_id",
                schema: "ops",
                table: "turnarounds");

            migrationBuilder.DropIndex(
                name: "IX_turnarounds_contract_version_id",
                schema: "ops",
                table: "turnarounds");

            migrationBuilder.DropCheckConstraint(
                name: "ck_stands_latitude",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropCheckConstraint(
                name: "ck_stands_location_pair",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropCheckConstraint(
                name: "ck_stands_longitude",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropColumn(
                name: "contract_version_id",
                schema: "ops",
                table: "turnarounds");

            migrationBuilder.DropColumn(
                name: "latitude",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropColumn(
                name: "located_at",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropColumn(
                name: "longitude",
                schema: "ref",
                table: "stands");
        }
    }
}
