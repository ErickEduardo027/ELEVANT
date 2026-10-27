using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDepartmentNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "department_notifications",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    recipient_account_id = table.Column<long>(type: "bigint", nullable: false),
                    department = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    kind = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    source_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    subject = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_department_notifications", x => x.id);
                    table.ForeignKey(
                        name: "FK_department_notifications_accounts_recipient_account_id",
                        column: x => x.recipient_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_department_notifications_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_department_notifications_public_id",
                schema: "iam",
                table: "department_notifications",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_department_notifications_recipient_account_id_kind_source_id",
                schema: "iam",
                table: "department_notifications",
                columns: new[] { "recipient_account_id", "kind", "source_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_department_notifications_recipient_account_id_occurred_at",
                schema: "iam",
                table: "department_notifications",
                columns: new[] { "recipient_account_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_department_notifications_station_id",
                schema: "iam",
                table: "department_notifications",
                column: "station_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM iam.department_notifications)
                    THROW 52310, 'Department notifications already exist; history must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "department_notifications",
                schema: "iam");
        }
    }
}
