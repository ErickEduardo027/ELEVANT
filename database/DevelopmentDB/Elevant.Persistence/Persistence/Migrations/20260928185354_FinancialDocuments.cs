using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FinancialDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "financial_documents",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    invoice_id = table.Column<long>(type: "bigint", nullable: false),
                    payment_id = table.Column<long>(type: "bigint", nullable: true),
                    kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    object_key = table.Column<string>(type: "nvarchar(240)", maxLength: 240, nullable: false),
                    content_type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    length = table.Column<long>(type: "bigint", nullable: false),
                    sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financial_documents", x => x.id);
                    table.CheckConstraint("ck_financial_document_content_type", "[content_type] = 'application/pdf'");
                    table.CheckConstraint("ck_financial_document_kind", "([kind] = 'Invoice' AND [payment_id] IS NULL) OR ([kind] = 'Receipt' AND [payment_id] IS NOT NULL)");
                    table.CheckConstraint("ck_financial_document_length", "[length] > 0");
                    table.CheckConstraint("ck_financial_document_sha256", "LEN([sha256]) = 64");
                    table.ForeignKey(
                        name: "FK_financial_documents_non_fiscal_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_invoices",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_financial_documents_non_fiscal_payments_payment_id",
                        column: x => x.payment_id,
                        principalSchema: "commercial",
                        principalTable: "non_fiscal_payments",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_financial_documents_invoice_id_kind",
                schema: "commercial",
                table: "financial_documents",
                columns: new[] { "invoice_id", "kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_financial_documents_object_key",
                schema: "commercial",
                table: "financial_documents",
                column: "object_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_financial_documents_payment_id",
                schema: "commercial",
                table: "financial_documents",
                column: "payment_id",
                unique: true,
                filter: "[payment_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_financial_documents_public_id",
                schema: "commercial",
                table: "financial_documents",
                column: "public_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [commercial].[financial_documents])
                BEGIN
                    THROW 51043, 'Financial document metadata must be retained; restore a verified backup instead of reversing this migration.', 1;
                END
                """);

            migrationBuilder.DropTable(
                name: "financial_documents",
                schema: "commercial");
        }
    }
}
