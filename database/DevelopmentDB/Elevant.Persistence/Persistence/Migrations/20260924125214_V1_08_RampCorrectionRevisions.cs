using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_08_RampCorrectionRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_operation_checklists_ground_operation_id_checklist_template_version_id",
                schema: "ops",
                table: "operation_checklists");

            migrationBuilder.AddColumn<string>(
                name: "evidence_json",
                schema: "ops",
                table: "operation_submissions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "revision_number",
                schema: "ops",
                table: "operation_checklists",
                type: "int",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateIndex(
                name: "IX_operation_checklists_ground_operation_id_checklist_template_version_id_revision_number",
                schema: "ops",
                table: "operation_checklists",
                columns: new[] { "ground_operation_id", "checklist_template_version_id", "revision_number" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_operation_checklist_revision",
                schema: "ops",
                table: "operation_checklists",
                sql: "[revision_number] > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_operation_checklists_ground_operation_id_checklist_template_version_id_revision_number",
                schema: "ops",
                table: "operation_checklists");

            migrationBuilder.DropCheckConstraint(
                name: "ck_operation_checklist_revision",
                schema: "ops",
                table: "operation_checklists");

            migrationBuilder.DropColumn(
                name: "evidence_json",
                schema: "ops",
                table: "operation_submissions");

            migrationBuilder.DropColumn(
                name: "revision_number",
                schema: "ops",
                table: "operation_checklists");

            migrationBuilder.CreateIndex(
                name: "IX_operation_checklists_ground_operation_id_checklist_template_version_id",
                schema: "ops",
                table: "operation_checklists",
                columns: new[] { "ground_operation_id", "checklist_template_version_id" },
                unique: true);
        }
    }
}
