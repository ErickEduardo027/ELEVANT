using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAeronauticalFlightFeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "iana_time_zone",
                schema: "ref",
                table: "airports",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "latitude",
                schema: "ref",
                table: "airports",
                type: "decimal(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "longitude",
                schema: "ref",
                table: "airports",
                type: "decimal(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "airline_registry_entries",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    registry_key = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    iata_code = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: true),
                    icao_code = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: true),
                    name = table.Column<string>(type: "nvarchar(180)", maxLength: 180, nullable: false),
                    source = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    first_seen_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airline_registry_entries", x => x.id);
                    table.CheckConstraint("ck_airline_registry_codes", "[iata_code] IS NOT NULL OR [icao_code] IS NOT NULL");
                    table.CheckConstraint("ck_airline_registry_iata", "[iata_code] IS NULL OR LEN([iata_code]) = 2");
                    table.CheckConstraint("ck_airline_registry_icao", "[icao_code] IS NULL OR LEN([icao_code]) = 3");
                    table.CheckConstraint("ck_airline_registry_seen", "[last_seen_at] >= [first_seen_at]");
                });

            migrationBuilder.CreateTable(
                name: "external_flight_proposals",
                schema: "integration",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    provider = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    external_reference = table.Column<string>(type: "nvarchar(96)", maxLength: 96, nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    operation_date = table.Column<DateOnly>(type: "date", nullable: false),
                    direction = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    flight_number = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    counterpart_airport_id = table.Column<long>(type: "bigint", nullable: true),
                    counterpart_iata = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: true),
                    counterpart_name = table.Column<string>(type: "nvarchar(180)", maxLength: 180, nullable: true),
                    scheduled_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    revised_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    runway_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    provider_status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    aircraft_registration = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    aircraft_model = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    terminal = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    gate = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    first_seen_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: true),
                    flight_leg_id = table.Column<long>(type: "bigint", nullable: true),
                    decided_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_external_flight_proposals", x => x.id);
                    table.CheckConstraint("ck_flight_proposal_confirmed", "[status] <> 'Confirmed' OR ([turnaround_id] IS NOT NULL AND [flight_leg_id] IS NOT NULL)");
                    table.CheckConstraint("ck_flight_proposal_decision", "([status] = 'Proposed' AND [decided_at] IS NULL) OR ([status] <> 'Proposed' AND [decided_at] IS NOT NULL)");
                    table.CheckConstraint("ck_flight_proposal_seen", "[last_seen_at] >= [first_seen_at]");
                    table.ForeignKey(
                        name: "FK_external_flight_proposals_accounts_decided_by_account_id",
                        column: x => x.decided_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_external_flight_proposals_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_external_flight_proposals_airports_counterpart_airport_id",
                        column: x => x.counterpart_airport_id,
                        principalSchema: "ref",
                        principalTable: "airports",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_external_flight_proposals_flight_legs_flight_leg_id",
                        column: x => x.flight_leg_id,
                        principalSchema: "ops",
                        principalTable: "flight_legs",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_external_flight_proposals_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_external_flight_proposals_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "provider_sync_leases",
                schema: "integration",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    provider = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    holder_id = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    leased_until = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    paused_until = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    consecutive_failures = table.Column<int>(type: "int", nullable: false),
                    last_error = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_provider_sync_leases", x => x.id);
                    table.CheckConstraint("ck_provider_lease_failures", "[consecutive_failures] >= 0");
                    table.CheckConstraint("ck_provider_lease_holder", "([holder_id] IS NULL AND [leased_until] IS NULL) OR ([holder_id] IS NOT NULL AND [leased_until] IS NOT NULL)");
                });

            migrationBuilder.CreateTable(
                name: "provider_usage_entries",
                schema: "integration",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    provider = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    operation = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: true),
                    window_from = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    window_to = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    units = table.Column<int>(type: "int", nullable: false),
                    http_status = table.Column<int>(type: "int", nullable: true),
                    outcome = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    trigger = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    requested_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    flights_received = table.Column<int>(type: "int", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_provider_usage_entries", x => x.id);
                    table.CheckConstraint("ck_provider_usage_flights", "[flights_received] >= 0");
                    table.CheckConstraint("ck_provider_usage_units", "[units] >= 0");
                    table.CheckConstraint("ck_provider_usage_window", "([window_from] IS NULL AND [window_to] IS NULL) OR ([window_from] IS NOT NULL AND [window_to] > [window_from])");
                    table.ForeignKey(
                        name: "FK_provider_usage_entries_accounts_requested_by_account_id",
                        column: x => x.requested_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_provider_usage_entries_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_airport_latitude",
                schema: "ref",
                table: "airports",
                sql: "[latitude] IS NULL OR [latitude] BETWEEN -90 AND 90");

            migrationBuilder.AddCheckConstraint(
                name: "ck_airport_longitude",
                schema: "ref",
                table: "airports",
                sql: "[longitude] IS NULL OR [longitude] BETWEEN -180 AND 180");

            migrationBuilder.CreateIndex(
                name: "IX_airline_registry_entries_iata_code",
                schema: "ref",
                table: "airline_registry_entries",
                column: "iata_code");

            migrationBuilder.CreateIndex(
                name: "IX_airline_registry_entries_icao_code",
                schema: "ref",
                table: "airline_registry_entries",
                column: "icao_code");

            migrationBuilder.CreateIndex(
                name: "IX_airline_registry_entries_public_id",
                schema: "ref",
                table: "airline_registry_entries",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airline_registry_entries_registry_key",
                schema: "ref",
                table: "airline_registry_entries",
                column: "registry_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_airline_id",
                schema: "integration",
                table: "external_flight_proposals",
                column: "airline_id");

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_counterpart_airport_id",
                schema: "integration",
                table: "external_flight_proposals",
                column: "counterpart_airport_id");

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_decided_by_account_id",
                schema: "integration",
                table: "external_flight_proposals",
                column: "decided_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_flight_leg_id",
                schema: "integration",
                table: "external_flight_proposals",
                column: "flight_leg_id");

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_provider_external_reference",
                schema: "integration",
                table: "external_flight_proposals",
                columns: new[] { "provider", "external_reference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_public_id",
                schema: "integration",
                table: "external_flight_proposals",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_station_id_operation_date_status",
                schema: "integration",
                table: "external_flight_proposals",
                columns: new[] { "station_id", "operation_date", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_external_flight_proposals_turnaround_id",
                schema: "integration",
                table: "external_flight_proposals",
                column: "turnaround_id");

            migrationBuilder.CreateIndex(
                name: "IX_provider_sync_leases_provider",
                schema: "integration",
                table: "provider_sync_leases",
                column: "provider",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_provider_sync_leases_public_id",
                schema: "integration",
                table: "provider_sync_leases",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_provider_usage_entries_provider_occurred_at",
                schema: "integration",
                table: "provider_usage_entries",
                columns: new[] { "provider", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_provider_usage_entries_public_id",
                schema: "integration",
                table: "provider_usage_entries",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_provider_usage_entries_requested_by_account_id",
                schema: "integration",
                table: "provider_usage_entries",
                column: "requested_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_provider_usage_entries_station_id_occurred_at",
                schema: "integration",
                table: "provider_usage_entries",
                columns: new[] { "station_id", "occurred_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "airline_registry_entries",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "external_flight_proposals",
                schema: "integration");

            migrationBuilder.DropTable(
                name: "provider_sync_leases",
                schema: "integration");

            migrationBuilder.DropTable(
                name: "provider_usage_entries",
                schema: "integration");

            migrationBuilder.DropCheckConstraint(
                name: "ck_airport_latitude",
                schema: "ref",
                table: "airports");

            migrationBuilder.DropCheckConstraint(
                name: "ck_airport_longitude",
                schema: "ref",
                table: "airports");

            migrationBuilder.DropColumn(
                name: "iana_time_zone",
                schema: "ref",
                table: "airports");

            migrationBuilder.DropColumn(
                name: "latitude",
                schema: "ref",
                table: "airports");

            migrationBuilder.DropColumn(
                name: "longitude",
                schema: "ref",
                table: "airports");
        }
    }
}
