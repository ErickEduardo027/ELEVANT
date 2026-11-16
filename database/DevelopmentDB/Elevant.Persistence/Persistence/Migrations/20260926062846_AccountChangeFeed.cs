using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccountChangeFeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "account_changes",
                schema: "infra",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    outbox_public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    recipient_account_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    resource = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    resource_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_changes", x => x.id);
                    table.CheckConstraint("ck_account_changes_resource", "LEN([resource]) BETWEEN 1 AND 64");
                    table.ForeignKey(
                        name: "FK_account_changes_accounts_recipient_account_id",
                        column: x => x.recipient_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_account_changes_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_changes_outbox_public_id_recipient_account_id",
                schema: "infra",
                table: "account_changes",
                columns: new[] { "outbox_public_id", "recipient_account_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_account_changes_public_id",
                schema: "infra",
                table: "account_changes",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_account_changes_recipient_account_id_id",
                schema: "infra",
                table: "account_changes",
                columns: new[] { "recipient_account_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_account_changes_station_id",
                schema: "infra",
                table: "account_changes",
                column: "station_id");

            migrationBuilder.Sql(
                """
                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                BEGIN
                    GRANT SELECT, INSERT, UPDATE ON OBJECT::[infra].[outbox_messages] TO [elevant_app_role];
                    GRANT SELECT, INSERT ON OBJECT::[infra].[account_changes] TO [elevant_app_role];
                END;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                BEGIN
                    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[infra].[outbox_messages] FROM [elevant_app_role];
                    REVOKE SELECT, INSERT ON OBJECT::[infra].[account_changes] FROM [elevant_app_role];
                END;
                """);

            migrationBuilder.DropTable(
                name: "account_changes",
                schema: "infra");
        }
    }
}
