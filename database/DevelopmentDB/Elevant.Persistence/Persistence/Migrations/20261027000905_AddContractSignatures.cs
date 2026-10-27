using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddContractSignatures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "contract_signatures",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    party = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    signer_account_id = table.Column<long>(type: "bigint", nullable: false),
                    signer_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    signer_title = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    signed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    document_sha256 = table.Column<string>(type: "char(64)", unicode: false, fixedLength: true, maxLength: 64, nullable: false),
                    request_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_signatures", x => x.id);
                    table.CheckConstraint("ck_contract_signatures_sha256", "LEN([document_sha256]) = 64");
                    table.ForeignKey(
                        name: "FK_contract_signatures_accounts_signer_account_id",
                        column: x => x.signer_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_signatures_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_contract_signatures_contract_version_id_party",
                schema: "commercial",
                table: "contract_signatures",
                columns: new[] { "contract_version_id", "party" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_signatures_public_id",
                schema: "commercial",
                table: "contract_signatures",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_signatures_request_id",
                schema: "commercial",
                table: "contract_signatures",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_signatures_signer_account_id",
                schema: "commercial",
                table: "contract_signatures",
                column: "signer_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM commercial.contract_signatures)
                    THROW 52320, 'Contract signatures already exist; signed history must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "contract_signatures",
                schema: "commercial");
        }
    }
}
