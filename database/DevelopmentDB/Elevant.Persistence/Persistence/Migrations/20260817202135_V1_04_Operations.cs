using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_04_Operations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "ops");

            migrationBuilder.CreateTable(
                name: "checklist_templates",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checklist_templates", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "equipment_assets",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    equipment_type_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    asset_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    serial_number = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_equipment_assets", x => x.id);
                    table.ForeignKey(
                        name: "FK_equipment_assets_equipment_types_equipment_type_id",
                        column: x => x.equipment_type_id,
                        principalSchema: "ref",
                        principalTable: "equipment_types",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_equipment_assets_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "turnarounds",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    operation_date = table.Column<DateOnly>(type: "date", nullable: false),
                    aircraft_type_id = table.Column<long>(type: "bigint", nullable: true),
                    aircraft_registration = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    current_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    source = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    external_provider = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    external_reference = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    source_observed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_turnarounds", x => x.id);
                    table.ForeignKey(
                        name: "FK_turnarounds_aircraft_types_aircraft_type_id",
                        column: x => x.aircraft_type_id,
                        principalSchema: "ref",
                        principalTable: "aircraft_types",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_turnarounds_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_turnarounds_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "checklist_template_versions",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    checklist_template_id = table.Column<long>(type: "bigint", nullable: false),
                    version_number = table.Column<int>(type: "int", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    effective_from = table.Column<DateOnly>(type: "date", nullable: false),
                    effective_to = table.Column<DateOnly>(type: "date", nullable: true),
                    published_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    published_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checklist_template_versions", x => x.id);
                    table.CheckConstraint("ck_checklist_template_dates", "[effective_to] IS NULL OR [effective_to] >= [effective_from]");
                    table.CheckConstraint("ck_checklist_template_version", "[version_number] > 0");
                    table.ForeignKey(
                        name: "FK_checklist_template_versions_accounts_published_by_account_id",
                        column: x => x.published_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_checklist_template_versions_checklist_templates_checklist_template_id",
                        column: x => x.checklist_template_id,
                        principalSchema: "ops",
                        principalTable: "checklist_templates",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "flight_legs",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: false),
                    direction = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    flight_number = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    origin_airport_id = table.Column<long>(type: "bigint", nullable: false),
                    destination_airport_id = table.Column<long>(type: "bigint", nullable: false),
                    scheduled_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    estimated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    actual_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    source = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    external_reference = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    source_observed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_flight_legs", x => x.id);
                    table.CheckConstraint("ck_flight_leg_route", "[origin_airport_id] <> [destination_airport_id]");
                    table.ForeignKey(
                        name: "FK_flight_legs_airports_destination_airport_id",
                        column: x => x.destination_airport_id,
                        principalSchema: "ref",
                        principalTable: "airports",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_flight_legs_airports_origin_airport_id",
                        column: x => x.origin_airport_id,
                        principalSchema: "ref",
                        principalTable: "airports",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_flight_legs_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ground_operations",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: false),
                    current_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    planned_start_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    planned_end_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    actual_start_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    actual_end_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ground_operations", x => x.id);
                    table.CheckConstraint("ck_ground_operation_actual_dates", "[actual_end_at] IS NULL OR [actual_start_at] IS NULL OR [actual_end_at] >= [actual_start_at]");
                    table.CheckConstraint("ck_ground_operation_planned_dates", "[planned_end_at] IS NULL OR [planned_start_at] IS NULL OR [planned_end_at] >= [planned_start_at]");
                    table.ForeignKey(
                        name: "FK_ground_operations_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operational_service_requests",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: true),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: true),
                    requested_by_account_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    requested_service_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    needed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    resolved_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    resolved_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    resolution_note = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operational_service_requests", x => x.id);
                    table.CheckConstraint("ck_operational_request_resolution", "[resolved_at] IS NULL OR [resolved_at] >= [requested_at]");
                    table.ForeignKey(
                        name: "FK_operational_service_requests_accounts_requested_by_account_id",
                        column: x => x.requested_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_service_requests_accounts_resolved_by_account_id",
                        column: x => x.resolved_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_service_requests_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_service_requests_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_service_requests_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operational_service_requests_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "stand_assignments",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: false),
                    stand_id = table.Column<long>(type: "bigint", nullable: false),
                    assigned_from = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    assigned_to = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    assigned_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stand_assignments", x => x.id);
                    table.CheckConstraint("ck_stand_assignment_dates", "[assigned_to] IS NULL OR [assigned_to] >= [assigned_from]");
                    table.ForeignKey(
                        name: "FK_stand_assignments_accounts_assigned_by_account_id",
                        column: x => x.assigned_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_stand_assignments_stands_stand_id",
                        column: x => x.stand_id,
                        principalSchema: "ref",
                        principalTable: "stands",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_stand_assignments_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "turnaround_status_events",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    turnaround_id = table.Column<long>(type: "bigint", nullable: false),
                    from_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: true),
                    to_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: true),
                    source = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_turnaround_status_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_turnaround_status_events_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_turnaround_status_events_turnarounds_turnaround_id",
                        column: x => x.turnaround_id,
                        principalSchema: "ops",
                        principalTable: "turnarounds",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "checklist_template_items",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    checklist_template_version_id = table.Column<long>(type: "bigint", nullable: false),
                    item_code = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                    section_name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    label = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    sort_order = table.Column<int>(type: "int", nullable: false),
                    requires_note_when_not_ok = table.Column<bool>(type: "bit", nullable: false),
                    is_required = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checklist_template_items", x => x.id);
                    table.CheckConstraint("ck_checklist_item_sort", "[sort_order] >= 0");
                    table.ForeignKey(
                        name: "FK_checklist_template_items_checklist_template_versions_checklist_template_version_id",
                        column: x => x.checklist_template_version_id,
                        principalSchema: "ops",
                        principalTable: "checklist_template_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ground_operation_status_events",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    from_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: true),
                    to_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: true),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ground_operation_status_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_ground_operation_status_events_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ground_operation_status_events_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "incidents",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    reported_by_ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    incident_type = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    severity = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    description = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    reported_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    resolved_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    resolved_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    resolution_note = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incidents", x => x.id);
                    table.CheckConstraint("ck_incident_reported", "[reported_at] >= [occurred_at]");
                    table.CheckConstraint("ck_incident_resolved", "[resolved_at] IS NULL OR [resolved_at] >= [reported_at]");
                    table.ForeignKey(
                        name: "FK_incidents_accounts_resolved_by_account_id",
                        column: x => x.resolved_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_incidents_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_incidents_ramp_agents_reported_by_ramp_agent_id",
                        column: x => x.reported_by_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_agent_assignments",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    operational_position_id = table.Column<long>(type: "bigint", nullable: true),
                    assignment_role = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    released_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    assigned_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_agent_assignments", x => x.id);
                    table.CheckConstraint("ck_agent_assignment_dates", "[released_at] IS NULL OR [released_at] >= [assigned_at]");
                    table.ForeignKey(
                        name: "FK_operation_agent_assignments_accounts_assigned_by_account_id",
                        column: x => x.assigned_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_agent_assignments_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_agent_assignments_operational_positions_operational_position_id",
                        column: x => x.operational_position_id,
                        principalSchema: "ref",
                        principalTable: "operational_positions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_agent_assignments_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_checklists",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    checklist_template_version_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    submitted_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    submitted_by_ramp_agent_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_checklists", x => x.id);
                    table.CheckConstraint("ck_operation_checklist_dates", "[submitted_at] IS NULL OR [started_at] IS NULL OR [submitted_at] >= [started_at]");
                    table.ForeignKey(
                        name: "FK_operation_checklists_checklist_template_versions_checklist_template_version_id",
                        column: x => x.checklist_template_version_id,
                        principalSchema: "ops",
                        principalTable: "checklist_template_versions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_checklists_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_checklists_ramp_agents_submitted_by_ramp_agent_id",
                        column: x => x.submitted_by_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_equipment_assignments",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    equipment_asset_id = table.Column<long>(type: "bigint", nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    released_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    assigned_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_equipment_assignments", x => x.id);
                    table.CheckConstraint("ck_equipment_assignment_dates", "[released_at] IS NULL OR [released_at] >= [assigned_at]");
                    table.ForeignKey(
                        name: "FK_operation_equipment_assignments_accounts_assigned_by_account_id",
                        column: x => x.assigned_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_equipment_assignments_equipment_assets_equipment_asset_id",
                        column: x => x.equipment_asset_id,
                        principalSchema: "ref",
                        principalTable: "equipment_assets",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_equipment_assignments_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_milestones",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    code = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                    planned_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    estimated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    actual_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    source = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_milestones", x => x.id);
                    table.ForeignKey(
                        name: "FK_operation_milestones_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_services",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    line_number = table.Column<int>(type: "int", nullable: false),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    contract_service_rate_id = table.Column<long>(type: "bigint", nullable: true),
                    contracted_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    executed_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    billing_unit_snapshot = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    unit_price_snapshot = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    currency_code_snapshot = table.Column<string>(type: "char(3)", nullable: true),
                    current_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_services", x => x.id);
                    table.CheckConstraint("ck_operation_service_currency", "[currency_code_snapshot] IS NULL OR LEN([currency_code_snapshot]) = 3");
                    table.CheckConstraint("ck_operation_service_line", "[line_number] > 0");
                    table.CheckConstraint("ck_operation_service_price", "[unit_price_snapshot] IS NULL OR [unit_price_snapshot] >= 0");
                    table.CheckConstraint("ck_operation_service_quantities", "[contracted_quantity] >= 0 AND [executed_quantity] >= 0");
                    table.ForeignKey(
                        name: "FK_operation_services_contract_service_rates_contract_service_rate_id",
                        column: x => x.contract_service_rate_id,
                        principalSchema: "commercial",
                        principalTable: "contract_service_rates",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_services_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_services_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "checklist_answers",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_checklist_id = table.Column<long>(type: "bigint", nullable: false),
                    checklist_template_item_id = table.Column<long>(type: "bigint", nullable: false),
                    value = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    note = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    answered_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checklist_answers", x => x.id);
                    table.ForeignKey(
                        name: "FK_checklist_answers_checklist_template_items_checklist_template_item_id",
                        column: x => x.checklist_template_item_id,
                        principalSchema: "ops",
                        principalTable: "checklist_template_items",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_checklist_answers_operation_checklists_operation_checklist_id",
                        column: x => x.operation_checklist_id,
                        principalSchema: "ops",
                        principalTable: "operation_checklists",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_checklist_answers_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_submissions",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ground_operation_id = table.Column<long>(type: "bigint", nullable: false),
                    operation_checklist_id = table.Column<long>(type: "bigint", nullable: false),
                    revision_number = table.Column<int>(type: "int", nullable: false),
                    status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    submitted_by_ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    agent_note = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_submissions", x => x.id);
                    table.CheckConstraint("ck_operation_submission_revision", "[revision_number] > 0");
                    table.ForeignKey(
                        name: "FK_operation_submissions_ground_operations_ground_operation_id",
                        column: x => x.ground_operation_id,
                        principalSchema: "ops",
                        principalTable: "ground_operations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_submissions_operation_checklists_operation_checklist_id",
                        column: x => x.operation_checklist_id,
                        principalSchema: "ops",
                        principalTable: "operation_checklists",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_submissions_ramp_agents_submitted_by_ramp_agent_id",
                        column: x => x.submitted_by_ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operation_service_status_events",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_service_id = table.Column<long>(type: "bigint", nullable: false),
                    from_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: true),
                    to_status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: true),
                    note = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operation_service_status_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_operation_service_status_events_operation_services_operation_service_id",
                        column: x => x.operation_service_id,
                        principalSchema: "ops",
                        principalTable: "operation_services",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_operation_service_status_events_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "review_decisions",
                schema: "ops",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    operation_submission_id = table.Column<long>(type: "bigint", nullable: false),
                    outcome = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    reviewer_account_id = table.Column<long>(type: "bigint", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_review_decisions", x => x.id);
                    table.ForeignKey(
                        name: "FK_review_decisions_accounts_reviewer_account_id",
                        column: x => x.reviewer_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_review_decisions_operation_submissions_operation_submission_id",
                        column: x => x.operation_submission_id,
                        principalSchema: "ops",
                        principalTable: "operation_submissions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_checklist_answers_checklist_template_item_id",
                schema: "ops",
                table: "checklist_answers",
                column: "checklist_template_item_id");

            migrationBuilder.CreateIndex(
                name: "IX_checklist_answers_operation_checklist_id_checklist_template_item_id",
                schema: "ops",
                table: "checklist_answers",
                columns: new[] { "operation_checklist_id", "checklist_template_item_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_answers_public_id",
                schema: "ops",
                table: "checklist_answers",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_answers_ramp_agent_id",
                schema: "ops",
                table: "checklist_answers",
                column: "ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_checklist_template_items_checklist_template_version_id_item_code",
                schema: "ops",
                table: "checklist_template_items",
                columns: new[] { "checklist_template_version_id", "item_code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_template_items_checklist_template_version_id_sort_order",
                schema: "ops",
                table: "checklist_template_items",
                columns: new[] { "checklist_template_version_id", "sort_order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_template_items_public_id",
                schema: "ops",
                table: "checklist_template_items",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_template_versions_checklist_template_id_version_number",
                schema: "ops",
                table: "checklist_template_versions",
                columns: new[] { "checklist_template_id", "version_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_template_versions_public_id",
                schema: "ops",
                table: "checklist_template_versions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_template_versions_published_by_account_id",
                schema: "ops",
                table: "checklist_template_versions",
                column: "published_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_checklist_templates_code",
                schema: "ops",
                table: "checklist_templates",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_checklist_templates_public_id",
                schema: "ops",
                table: "checklist_templates",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_equipment_assets_equipment_type_id",
                schema: "ref",
                table: "equipment_assets",
                column: "equipment_type_id");

            migrationBuilder.CreateIndex(
                name: "IX_equipment_assets_public_id",
                schema: "ref",
                table: "equipment_assets",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_equipment_assets_serial_number",
                schema: "ref",
                table: "equipment_assets",
                column: "serial_number",
                unique: true,
                filter: "[serial_number] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_equipment_assets_station_id_asset_code",
                schema: "ref",
                table: "equipment_assets",
                columns: new[] { "station_id", "asset_code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_flight_legs_destination_airport_id",
                schema: "ops",
                table: "flight_legs",
                column: "destination_airport_id");

            migrationBuilder.CreateIndex(
                name: "IX_flight_legs_flight_number_scheduled_at",
                schema: "ops",
                table: "flight_legs",
                columns: new[] { "flight_number", "scheduled_at" });

            migrationBuilder.CreateIndex(
                name: "IX_flight_legs_origin_airport_id",
                schema: "ops",
                table: "flight_legs",
                column: "origin_airport_id");

            migrationBuilder.CreateIndex(
                name: "IX_flight_legs_public_id",
                schema: "ops",
                table: "flight_legs",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_flight_legs_turnaround_id_direction",
                schema: "ops",
                table: "flight_legs",
                columns: new[] { "turnaround_id", "direction" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ground_operation_status_events_actor_account_id",
                schema: "ops",
                table: "ground_operation_status_events",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_ground_operation_status_events_ground_operation_id_occurred_at",
                schema: "ops",
                table: "ground_operation_status_events",
                columns: new[] { "ground_operation_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_ground_operations_current_status",
                schema: "ops",
                table: "ground_operations",
                column: "current_status");

            migrationBuilder.CreateIndex(
                name: "IX_ground_operations_public_id",
                schema: "ops",
                table: "ground_operations",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ground_operations_turnaround_id",
                schema: "ops",
                table: "ground_operations",
                column: "turnaround_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_incidents_ground_operation_id_status_reported_at",
                schema: "ops",
                table: "incidents",
                columns: new[] { "ground_operation_id", "status", "reported_at" });

            migrationBuilder.CreateIndex(
                name: "IX_incidents_public_id",
                schema: "ops",
                table: "incidents",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_incidents_reported_by_ramp_agent_id",
                schema: "ops",
                table: "incidents",
                column: "reported_by_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_incidents_resolved_by_account_id",
                schema: "ops",
                table: "incidents",
                column: "resolved_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_agent_assignments_assigned_by_account_id",
                schema: "ops",
                table: "operation_agent_assignments",
                column: "assigned_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_agent_assignments_ground_operation_id_ramp_agent_id",
                schema: "ops",
                table: "operation_agent_assignments",
                columns: new[] { "ground_operation_id", "ramp_agent_id" },
                unique: true,
                filter: "[released_at] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_operation_agent_assignments_operational_position_id",
                schema: "ops",
                table: "operation_agent_assignments",
                column: "operational_position_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_agent_assignments_public_id",
                schema: "ops",
                table: "operation_agent_assignments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_agent_assignments_ramp_agent_id_assigned_at_released_at",
                schema: "ops",
                table: "operation_agent_assignments",
                columns: new[] { "ramp_agent_id", "assigned_at", "released_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_checklists_checklist_template_version_id",
                schema: "ops",
                table: "operation_checklists",
                column: "checklist_template_version_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_checklists_ground_operation_id_checklist_template_version_id",
                schema: "ops",
                table: "operation_checklists",
                columns: new[] { "ground_operation_id", "checklist_template_version_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_checklists_public_id",
                schema: "ops",
                table: "operation_checklists",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_checklists_submitted_by_ramp_agent_id",
                schema: "ops",
                table: "operation_checklists",
                column: "submitted_by_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_equipment_assignments_assigned_by_account_id",
                schema: "ops",
                table: "operation_equipment_assignments",
                column: "assigned_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_equipment_assignments_equipment_asset_id",
                schema: "ops",
                table: "operation_equipment_assignments",
                column: "equipment_asset_id",
                unique: true,
                filter: "[released_at] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_operation_equipment_assignments_ground_operation_id_equipment_asset_id",
                schema: "ops",
                table: "operation_equipment_assignments",
                columns: new[] { "ground_operation_id", "equipment_asset_id" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_equipment_assignments_public_id",
                schema: "ops",
                table: "operation_equipment_assignments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_milestones_ground_operation_id_code",
                schema: "ops",
                table: "operation_milestones",
                columns: new[] { "ground_operation_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_milestones_public_id",
                schema: "ops",
                table: "operation_milestones",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_status_events_operation_service_id_occurred_at",
                schema: "ops",
                table: "operation_service_status_events",
                columns: new[] { "operation_service_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_service_status_events_ramp_agent_id",
                schema: "ops",
                table: "operation_service_status_events",
                column: "ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_services_contract_service_rate_id",
                schema: "ops",
                table: "operation_services",
                column: "contract_service_rate_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_services_ground_operation_id_current_status",
                schema: "ops",
                table: "operation_services",
                columns: new[] { "ground_operation_id", "current_status" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_services_ground_operation_id_line_number",
                schema: "ops",
                table: "operation_services",
                columns: new[] { "ground_operation_id", "line_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_services_public_id",
                schema: "ops",
                table: "operation_services",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_services_service_definition_id",
                schema: "ops",
                table: "operation_services",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_ground_operation_id_revision_number",
                schema: "ops",
                table: "operation_submissions",
                columns: new[] { "ground_operation_id", "revision_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_operation_checklist_id",
                schema: "ops",
                table: "operation_submissions",
                column: "operation_checklist_id");

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_public_id",
                schema: "ops",
                table: "operation_submissions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_status_submitted_at",
                schema: "ops",
                table: "operation_submissions",
                columns: new[] { "status", "submitted_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operation_submissions_submitted_by_ramp_agent_id",
                schema: "ops",
                table: "operation_submissions",
                column: "submitted_by_ramp_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_airline_id_status_requested_at",
                schema: "ops",
                table: "operational_service_requests",
                columns: new[] { "airline_id", "status", "requested_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_public_id",
                schema: "ops",
                table: "operational_service_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_requested_by_account_id",
                schema: "ops",
                table: "operational_service_requests",
                column: "requested_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_resolved_by_account_id",
                schema: "ops",
                table: "operational_service_requests",
                column: "resolved_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_service_definition_id",
                schema: "ops",
                table: "operational_service_requests",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_station_id_status_needed_at",
                schema: "ops",
                table: "operational_service_requests",
                columns: new[] { "station_id", "status", "needed_at" });

            migrationBuilder.CreateIndex(
                name: "IX_operational_service_requests_turnaround_id",
                schema: "ops",
                table: "operational_service_requests",
                column: "turnaround_id");

            migrationBuilder.CreateIndex(
                name: "IX_review_decisions_operation_submission_id",
                schema: "ops",
                table: "review_decisions",
                column: "operation_submission_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_review_decisions_public_id",
                schema: "ops",
                table: "review_decisions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_review_decisions_reviewer_account_id",
                schema: "ops",
                table: "review_decisions",
                column: "reviewer_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_stand_assignments_assigned_by_account_id",
                schema: "ops",
                table: "stand_assignments",
                column: "assigned_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_stand_assignments_public_id",
                schema: "ops",
                table: "stand_assignments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stand_assignments_stand_id_assigned_from_assigned_to",
                schema: "ops",
                table: "stand_assignments",
                columns: new[] { "stand_id", "assigned_from", "assigned_to" });

            migrationBuilder.CreateIndex(
                name: "IX_stand_assignments_turnaround_id",
                schema: "ops",
                table: "stand_assignments",
                column: "turnaround_id",
                unique: true,
                filter: "[assigned_to] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_turnaround_status_events_actor_account_id",
                schema: "ops",
                table: "turnaround_status_events",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_turnaround_status_events_turnaround_id_occurred_at",
                schema: "ops",
                table: "turnaround_status_events",
                columns: new[] { "turnaround_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_aircraft_type_id",
                schema: "ops",
                table: "turnarounds",
                column: "aircraft_type_id");

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_airline_id_operation_date",
                schema: "ops",
                table: "turnarounds",
                columns: new[] { "airline_id", "operation_date" });

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_external_provider_external_reference",
                schema: "ops",
                table: "turnarounds",
                columns: new[] { "external_provider", "external_reference" },
                unique: true,
                filter: "[external_provider] IS NOT NULL AND [external_reference] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_operation_code",
                schema: "ops",
                table: "turnarounds",
                column: "operation_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_public_id",
                schema: "ops",
                table: "turnarounds",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_turnarounds_station_id_operation_date_current_status",
                schema: "ops",
                table: "turnarounds",
                columns: new[] { "station_id", "operation_date", "current_status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "checklist_answers",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "flight_legs",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "ground_operation_status_events",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "incidents",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_agent_assignments",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_equipment_assignments",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_milestones",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_service_status_events",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operational_service_requests",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "review_decisions",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "stand_assignments",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "turnaround_status_events",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "checklist_template_items",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "equipment_assets",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "operation_services",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_submissions",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "operation_checklists",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "checklist_template_versions",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "ground_operations",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "checklist_templates",
                schema: "ops");

            migrationBuilder.DropTable(
                name: "turnarounds",
                schema: "ops");
        }
    }
}
