using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommercialMediaAssets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "media_assets",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    object_key = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    purpose = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    content_type = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    length = table.Column<long>(type: "bigint", nullable: false),
                    sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    uploaded_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media_assets", x => x.id);
                    table.ForeignKey(
                        name: "FK_media_assets_accounts_uploaded_by_account_id",
                        column: x => x.uploaded_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_media_assets_object_key",
                schema: "commercial",
                table: "media_assets",
                column: "object_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_media_assets_public_id",
                schema: "commercial",
                table: "media_assets",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_media_assets_uploaded_by_account_id",
                schema: "commercial",
                table: "media_assets",
                column: "uploaded_by_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "media_assets",
                schema: "commercial");
        }
    }
}
