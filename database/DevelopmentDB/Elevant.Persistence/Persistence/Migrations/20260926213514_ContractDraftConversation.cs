using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ContractDraftConversation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "contract_draft_comments",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    author_account_id = table.Column<long>(type: "bigint", nullable: false),
                    body = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_draft_comments", x => x.id);
                    table.ForeignKey(
                        name: "FK_contract_draft_comments_accounts_author_account_id",
                        column: x => x.author_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_draft_comments_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_contract_draft_comments_author_account_id",
                schema: "commercial",
                table: "contract_draft_comments",
                column: "author_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_draft_comments_contract_version_id_created_at",
                schema: "commercial",
                table: "contract_draft_comments",
                columns: new[] { "contract_version_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_contract_draft_comments_public_id",
                schema: "commercial",
                table: "contract_draft_comments",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "contract_draft_comments",
                schema: "commercial");
        }
    }
}
