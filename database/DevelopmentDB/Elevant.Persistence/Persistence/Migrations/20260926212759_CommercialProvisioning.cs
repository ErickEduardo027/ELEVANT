using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommercialProvisioning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "provisioned_account_id",
                schema: "commercial",
                table: "service_requests",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_provisioned_account_id",
                schema: "commercial",
                table: "service_requests",
                column: "provisioned_account_id");

            migrationBuilder.AddForeignKey(
                name: "FK_service_requests_accounts_provisioned_account_id",
                schema: "commercial",
                table: "service_requests",
                column: "provisioned_account_id",
                principalSchema: "iam",
                principalTable: "accounts",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_service_requests_accounts_provisioned_account_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropIndex(
                name: "IX_service_requests_provisioned_account_id",
                schema: "commercial",
                table: "service_requests");

            migrationBuilder.DropColumn(
                name: "provisioned_account_id",
                schema: "commercial",
                table: "service_requests");
        }
    }
}
