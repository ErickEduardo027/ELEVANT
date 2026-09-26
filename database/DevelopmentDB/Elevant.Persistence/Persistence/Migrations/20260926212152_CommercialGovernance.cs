using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommercialGovernance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_active",
                schema: "iam",
                table: "roles",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_custom",
                schema: "iam",
                table: "roles",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "verification_source_url",
                schema: "commercial",
                table: "airline_profiles",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "verified_by_account_id",
                schema: "commercial",
                table: "airline_profiles",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_airline_profiles_verified_by_account_id",
                schema: "commercial",
                table: "airline_profiles",
                column: "verified_by_account_id");

            migrationBuilder.AddForeignKey(
                name: "FK_airline_profiles_accounts_verified_by_account_id",
                schema: "commercial",
                table: "airline_profiles",
                column: "verified_by_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_airline_profiles_accounts_verified_by_account_id",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropIndex(
                name: "IX_airline_profiles_verified_by_account_id",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "is_active",
                schema: "iam",
                table: "roles");

            migrationBuilder.DropColumn(
                name: "is_custom",
                schema: "iam",
                table: "roles");

            migrationBuilder.DropColumn(
                name: "verification_source_url",
                schema: "commercial",
                table: "airline_profiles");

            migrationBuilder.DropColumn(
                name: "verified_by_account_id",
                schema: "commercial",
                table: "airline_profiles");
        }
    }
}
