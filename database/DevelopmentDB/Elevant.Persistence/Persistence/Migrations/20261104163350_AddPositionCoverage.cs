using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPositionCoverage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "max_stands_per_agent",
                schema: "ref",
                table: "terminals",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "requires_bridge_qualification",
                schema: "ref",
                table: "terminals",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "has_boarding_bridge",
                schema: "ref",
                table: "stands",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_remote",
                schema: "ref",
                table: "stands",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "max_aircraft_size",
                schema: "ref",
                table: "stands",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "size_category",
                schema: "ref",
                table: "aircraft_types",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "position_coverages",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    terminal_id = table.Column<long>(type: "bigint", nullable: false),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    mentor_ramp_agent_id = table.Column<long>(type: "bigint", nullable: true),
                    vehicle_code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    is_reinforcement = table.Column<bool>(type: "bit", nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    released_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    assigned_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    released_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_position_coverages", x => x.id);
                    table.CheckConstraint("ck_position_coverage_mentor", "[mentor_ramp_agent_id] IS NULL OR [mentor_ramp_agent_id] <> [ramp_agent_id]");
                    table.CheckConstraint("ck_position_coverage_release", "[released_at] IS NULL OR [released_at] >= [created_at]");
                    table.CheckConstraint("ck_position_coverage_window", "[ends_at] > [starts_at]");
                    table.ForeignKey(
                        name: "FK_position_coverages_accounts_assigned_by_account_id",
                        column: x => x.assigned_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_position_coverages_accounts_released_by_account_id",
                        column: x => x.released_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_position_coverages_ramp_agents_mentor_ramp_agent_id",
                        column: x => x.mentor_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_position_coverages_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_position_coverages_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_position_coverages_terminals_terminal_id",
                        column: x => x.terminal_id,
                        principalSchema: "ref",
                        principalTable: "terminals",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "stand_constraints",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    stand_id = table.Column<long>(type: "bigint", nullable: false),
                    affected_stand_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    created_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stand_constraints", x => x.id);
                    table.CheckConstraint("ck_stand_constraint_distinct", "[stand_id] <> [affected_stand_id]");
                    table.ForeignKey(
                        name: "FK_stand_constraints_accounts_created_by_account_id",
                        column: x => x.created_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_stand_constraints_stands_affected_stand_id",
                        column: x => x.affected_stand_id,
                        principalSchema: "ref",
                        principalTable: "stands",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_stand_constraints_stands_stand_id",
                        column: x => x.stand_id,
                        principalSchema: "ref",
                        principalTable: "stands",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_stand_constraints_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "position_coverage_stands",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    position_coverage_id = table.Column<long>(type: "bigint", nullable: false),
                    stand_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_position_coverage_stands", x => x.id);
                    table.ForeignKey(
                        name: "FK_position_coverage_stands_position_coverages_position_coverage_id",
                        column: x => x.position_coverage_id,
                        principalSchema: "ops",
                        principalTable: "position_coverages",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_position_coverage_stands_stands_stand_id",
                        column: x => x.stand_id,
                        principalSchema: "ref",
                        principalTable: "stands",
                        principalColumn: "id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_terminals_max_stands_per_agent",
                schema: "ref",
                table: "terminals",
                sql: "[max_stands_per_agent] IS NULL OR [max_stands_per_agent] BETWEEN 1 AND 6");

            migrationBuilder.CreateIndex(
                name: "IX_position_coverage_stands_position_coverage_id_stand_id",
                schema: "ops",
                table: "position_coverage_stands",
                columns: new[] { "position_coverage_id", "stand_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_position_coverage_stands_stand_id",
                schema: "ops",
                table: "position_coverage_stands",
                column: "stand_id");

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_assigned_by_account_id",
                schema: "ops",
                table: "position_coverages",
                column: "assigned_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_mentor_ramp_agent_id",
                schema: "ops",
                table: "position_coverages",
                column: "mentor_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_public_id",
                schema: "ops",
                table: "position_coverages",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_ramp_agent_id_starts_at_ends_at",
                schema: "ops",
                table: "position_coverages",
                columns: new[] { "ramp_agent_id", "starts_at", "ends_at" });

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_released_by_account_id",
                schema: "ops",
                table: "position_coverages",
                column: "released_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_station_id_starts_at_ends_at",
                schema: "ops",
                table: "position_coverages",
                columns: new[] { "station_id", "starts_at", "ends_at" });

            migrationBuilder.CreateIndex(
                name: "IX_position_coverages_terminal_id",
                schema: "ops",
                table: "position_coverages",
                column: "terminal_id");

            migrationBuilder.CreateIndex(
                name: "IX_stand_constraints_affected_stand_id",
                schema: "ref",
                table: "stand_constraints",
                column: "affected_stand_id");

            migrationBuilder.CreateIndex(
                name: "IX_stand_constraints_created_by_account_id",
                schema: "ref",
                table: "stand_constraints",
                column: "created_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_stand_constraints_public_id",
                schema: "ref",
                table: "stand_constraints",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stand_constraints_stand_id_affected_stand_id_kind",
                schema: "ref",
                table: "stand_constraints",
                columns: new[] { "stand_id", "affected_stand_id", "kind" },
                unique: true,
                filter: "[is_active] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_stand_constraints_station_id_is_active",
                schema: "ref",
                table: "stand_constraints",
                columns: new[] { "station_id", "is_active" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "position_coverage_stands",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "stand_constraints",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "position_coverages",
                schema: "ops");

            migrationBuilder.DropCheckConstraint(
                name: "ck_terminals_max_stands_per_agent",
                schema: "ref",
                table: "terminals");

            migrationBuilder.DropColumn(
                name: "max_stands_per_agent",
                schema: "ref",
                table: "terminals");

            migrationBuilder.DropColumn(
                name: "requires_bridge_qualification",
                schema: "ref",
                table: "terminals");

            migrationBuilder.DropColumn(
                name: "has_boarding_bridge",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropColumn(
                name: "is_remote",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropColumn(
                name: "max_aircraft_size",
                schema: "ref",
                table: "stands");

            migrationBuilder.DropColumn(
                name: "size_category",
                schema: "ref",
                table: "aircraft_types");
        }
    }
}
