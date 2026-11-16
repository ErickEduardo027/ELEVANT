using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_03_WorkforceCommercial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "hr");

            migrationBuilder.EnsureSchema(
                name: "commercial");

            migrationBuilder.CreateTable(
                name: "coverage_requirements",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    terminal_id = table.Column<long>(type: "bigint", nullable: false),
                    operational_position_id = table.Column<long>(type: "bigint", nullable: false),
                    block = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    effective_from = table.Column<DateOnly>(type: "date", nullable: false),
                    effective_to = table.Column<DateOnly>(type: "date", nullable: true),
                    required_agent_count = table.Column<int>(type: "int", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_coverage_requirements", x => x.id);
                    table.CheckConstraint("ck_coverage_dates", "[effective_to] IS NULL OR [effective_to] >= [effective_from]");
                    table.CheckConstraint("ck_coverage_required_count", "[required_agent_count] > 0");
                    table.ForeignKey(
                        name: "FK_coverage_requirements_operational_positions_operational_position_id",
                        column: x => x.operational_position_id,
                        principalSchema: "ref",
                        principalTable: "operational_positions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_coverage_requirements_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_coverage_requirements_terminals_terminal_id",
                        column: x => x.terminal_id,
                        principalSchema: "ref",
                        principalTable: "terminals",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ramp_agents",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    person_id = table.Column<long>(type: "bigint", nullable: false),
                    employee_number = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    category = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    hire_date = table.Column<DateOnly>(type: "date", nullable: false),
                    supervisor_agent_id = table.Column<long>(type: "bigint", nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ramp_agents", x => x.id);
                    table.ForeignKey(
                        name: "FK_ramp_agents_persons_person_id",
                        column: x => x.person_id,
                        principalSchema: "iam",
                        principalTable: "persons",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ramp_agents_ramp_agents_supervisor_agent_id",
                        column: x => x.supervisor_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_requests",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    request_code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    airline_id = table.Column<long>(type: "bigint", nullable: true),
                    requested_airline_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    contact_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    contact_email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    contact_phone = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    submitted_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    reviewed_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    reviewed_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    decision_reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    cancelled_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_service_requests_accounts_reviewed_by_account_id",
                        column: x => x.reviewed_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_requests_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "airport_permit_cycles",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    document_type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    cycle_number = table.Column<int>(type: "int", nullable: false),
                    document_number = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    issued_on = table.Column<DateOnly>(type: "date", nullable: false),
                    expires_on = table.Column<DateOnly>(type: "date", nullable: false),
                    supersedes_permit_id = table.Column<long>(type: "bigint", nullable: true),
                    is_current = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airport_permit_cycles", x => x.id);
                    table.CheckConstraint("ck_permit_cycle_number", "[cycle_number] > 0");
                    table.CheckConstraint("ck_permit_dates", "[expires_on] >= [issued_on]");
                    table.ForeignKey(
                        name: "FK_airport_permit_cycles_airport_permit_cycles_supersedes_permit_id",
                        column: x => x.supersedes_permit_id,
                        principalSchema: "hr",
                        principalTable: "airport_permit_cycles",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_airport_permit_cycles_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "availability_requests",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    starts_on = table.Column<DateOnly>(type: "date", nullable: false),
                    ends_on = table.Column<DateOnly>(type: "date", nullable: false),
                    type = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
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
                    table.PrimaryKey("PK_availability_requests", x => x.id);
                    table.CheckConstraint("ck_availability_dates", "[ends_on] >= [starts_on]");
                    table.ForeignKey(
                        name: "FK_availability_requests_accounts_resolved_by_account_id",
                        column: x => x.resolved_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_availability_requests_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "qualification_cycles",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    equipment_type_id = table.Column<long>(type: "bigint", nullable: false),
                    cycle_number = table.Column<int>(type: "int", nullable: false),
                    training_date = table.Column<DateOnly>(type: "date", nullable: false),
                    obtained_on = table.Column<DateOnly>(type: "date", nullable: false),
                    expires_on = table.Column<DateOnly>(type: "date", nullable: false),
                    certifying_entity = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    instructor_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    supersedes_qualification_id = table.Column<long>(type: "bigint", nullable: true),
                    is_current = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_qualification_cycles", x => x.id);
                    table.CheckConstraint("ck_qualification_cycle_number", "[cycle_number] > 0");
                    table.CheckConstraint("ck_qualification_dates", "[training_date] <= [obtained_on] AND [expires_on] >= [obtained_on]");
                    table.ForeignKey(
                        name: "FK_qualification_cycles_equipment_types_equipment_type_id",
                        column: x => x.equipment_type_id,
                        principalSchema: "ref",
                        principalTable: "equipment_types",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_qualification_cycles_qualification_cycles_supersedes_qualification_id",
                        column: x => x.supersedes_qualification_id,
                        principalSchema: "hr",
                        principalTable: "qualification_cycles",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_qualification_cycles_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ramp_agent_station_scopes",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ramp_agent_station_scopes", x => x.id);
                    table.CheckConstraint("ck_agent_station_scope_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.ForeignKey(
                        name: "FK_ramp_agent_station_scopes_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ramp_agent_station_scopes_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "ramp_agent_terminal_scopes",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    terminal_id = table.Column<long>(type: "bigint", nullable: false),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ramp_agent_terminal_scopes", x => x.id);
                    table.CheckConstraint("ck_agent_terminal_scope_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.ForeignKey(
                        name: "FK_ramp_agent_terminal_scopes_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_ramp_agent_terminal_scopes_terminals_terminal_id",
                        column: x => x.terminal_id,
                        principalSchema: "ref",
                        principalTable: "terminals",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "shift_assignments",
                schema: "hr",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ramp_agent_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    terminal_id = table.Column<long>(type: "bigint", nullable: false),
                    operational_position_id = table.Column<long>(type: "bigint", nullable: true),
                    work_date = table.Column<DateOnly>(type: "date", nullable: false),
                    starts_at_local = table.Column<TimeOnly>(type: "time(0)", nullable: false),
                    ends_at_local = table.Column<TimeOnly>(type: "time(0)", nullable: false),
                    block = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shift_assignments", x => x.id);
                    table.ForeignKey(
                        name: "FK_shift_assignments_operational_positions_operational_position_id",
                        column: x => x.operational_position_id,
                        principalSchema: "ref",
                        principalTable: "operational_positions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_shift_assignments_ramp_agents_ramp_agent_id",
                        column: x => x.ramp_agent_id,
                        principalSchema: "hr",
                        principalTable: "ramp_agents",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_shift_assignments_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_shift_assignments_terminals_terminal_id",
                        column: x => x.terminal_id,
                        principalSchema: "ref",
                        principalTable: "terminals",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contracts",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airline_id = table.Column<long>(type: "bigint", nullable: false),
                    originating_service_request_id = table.Column<long>(type: "bigint", nullable: true),
                    contract_code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    signed_on = table.Column<DateOnly>(type: "date", nullable: true),
                    terminated_on = table.Column<DateOnly>(type: "date", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contracts", x => x.id);
                    table.CheckConstraint("ck_contract_dates", "[terminated_on] IS NULL OR [signed_on] IS NULL OR [terminated_on] >= [signed_on]");
                    table.ForeignKey(
                        name: "FK_contracts_airlines_airline_id",
                        column: x => x.airline_id,
                        principalSchema: "ref",
                        principalTable: "airlines",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contracts_service_requests_originating_service_request_id",
                        column: x => x.originating_service_request_id,
                        principalSchema: "commercial",
                        principalTable: "service_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_request_items",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    service_request_id = table.Column<long>(type: "bigint", nullable: false),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: true),
                    requested_service_name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    estimated_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: true),
                    requested_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    requested_from = table.Column<DateOnly>(type: "date", nullable: true),
                    requested_to = table.Column<DateOnly>(type: "date", nullable: true),
                    notes = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_request_items", x => x.id);
                    table.CheckConstraint("ck_service_request_item_dates", "[requested_to] IS NULL OR [requested_from] IS NULL OR [requested_to] >= [requested_from]");
                    table.CheckConstraint("ck_service_request_item_quantity", "[estimated_quantity] IS NULL OR [estimated_quantity] > 0");
                    table.ForeignKey(
                        name: "FK_service_request_items_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_request_items_service_requests_service_request_id",
                        column: x => x.service_request_id,
                        principalSchema: "commercial",
                        principalTable: "service_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_request_stations",
                schema: "commercial",
                columns: table => new
                {
                    service_request_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_request_stations", x => new { x.service_request_id, x.station_id });
                    table.ForeignKey(
                        name: "FK_service_request_stations_service_requests_service_request_id",
                        column: x => x.service_request_id,
                        principalSchema: "commercial",
                        principalTable: "service_requests",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_request_stations_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "service_request_status_events",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    service_request_id = table.Column<long>(type: "bigint", nullable: false),
                    from_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    to_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: true),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_request_status_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_service_request_status_events_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_service_request_status_events_service_requests_service_request_id",
                        column: x => x.service_request_id,
                        principalSchema: "commercial",
                        principalTable: "service_requests",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_status_events",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_id = table.Column<long>(type: "bigint", nullable: false),
                    from_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    to_status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    actor_account_id = table.Column<long>(type: "bigint", nullable: true),
                    reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_status_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_contract_status_events_accounts_actor_account_id",
                        column: x => x.actor_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_status_events_contracts_contract_id",
                        column: x => x.contract_id,
                        principalSchema: "commercial",
                        principalTable: "contracts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_versions",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_id = table.Column<long>(type: "bigint", nullable: false),
                    version_number = table.Column<int>(type: "int", nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: false),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true),
                    currency_code = table.Column<string>(type: "char(3)", nullable: false),
                    terms = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    approved_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    approved_by_account_id = table.Column<long>(type: "bigint", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_versions", x => x.id);
                    table.CheckConstraint("ck_contract_version_currency", "LEN([currency_code]) = 3");
                    table.CheckConstraint("ck_contract_version_dates", "[valid_to] IS NULL OR [valid_to] >= [valid_from]");
                    table.CheckConstraint("ck_contract_version_number", "[version_number] > 0");
                    table.ForeignKey(
                        name: "FK_contract_versions_accounts_approved_by_account_id",
                        column: x => x.approved_by_account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_versions_contracts_contract_id",
                        column: x => x.contract_id,
                        principalSchema: "commercial",
                        principalTable: "contracts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_service_rates",
                schema: "commercial",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    service_definition_id = table.Column<long>(type: "bigint", nullable: false),
                    billing_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    unit_price = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: false),
                    minimum_quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_service_rates", x => x.id);
                    table.CheckConstraint("ck_contract_rate_minimum", "[minimum_quantity] >= 0");
                    table.CheckConstraint("ck_contract_rate_price", "[unit_price] >= 0");
                    table.ForeignKey(
                        name: "FK_contract_service_rates_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_service_rates_service_definitions_service_definition_id",
                        column: x => x.service_definition_id,
                        principalSchema: "ref",
                        principalTable: "service_definitions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "contract_version_stations",
                schema: "commercial",
                columns: table => new
                {
                    contract_version_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_version_stations", x => new { x.contract_version_id, x.station_id });
                    table.ForeignKey(
                        name: "FK_contract_version_stations_contract_versions_contract_version_id",
                        column: x => x.contract_version_id,
                        principalSchema: "commercial",
                        principalTable: "contract_versions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_contract_version_stations_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_airport_permit_cycles_is_current_expires_on",
                schema: "hr",
                table: "airport_permit_cycles",
                columns: new[] { "is_current", "expires_on" });

            migrationBuilder.CreateIndex(
                name: "IX_airport_permit_cycles_public_id",
                schema: "hr",
                table: "airport_permit_cycles",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airport_permit_cycles_ramp_agent_id_document_type",
                schema: "hr",
                table: "airport_permit_cycles",
                columns: new[] { "ramp_agent_id", "document_type" },
                unique: true,
                filter: "[is_current] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_airport_permit_cycles_ramp_agent_id_document_type_cycle_number",
                schema: "hr",
                table: "airport_permit_cycles",
                columns: new[] { "ramp_agent_id", "document_type", "cycle_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airport_permit_cycles_supersedes_permit_id",
                schema: "hr",
                table: "airport_permit_cycles",
                column: "supersedes_permit_id");

            migrationBuilder.CreateIndex(
                name: "IX_availability_requests_public_id",
                schema: "hr",
                table: "availability_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_availability_requests_ramp_agent_id_status_starts_on",
                schema: "hr",
                table: "availability_requests",
                columns: new[] { "ramp_agent_id", "status", "starts_on" });

            migrationBuilder.CreateIndex(
                name: "IX_availability_requests_resolved_by_account_id",
                schema: "hr",
                table: "availability_requests",
                column: "resolved_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_service_rates_contract_version_id_service_definition_id",
                schema: "commercial",
                table: "contract_service_rates",
                columns: new[] { "contract_version_id", "service_definition_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_service_rates_public_id",
                schema: "commercial",
                table: "contract_service_rates",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_service_rates_service_definition_id",
                schema: "commercial",
                table: "contract_service_rates",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_status_events_actor_account_id",
                schema: "commercial",
                table: "contract_status_events",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_status_events_contract_id_occurred_at",
                schema: "commercial",
                table: "contract_status_events",
                columns: new[] { "contract_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_contract_version_stations_station_id",
                schema: "commercial",
                table: "contract_version_stations",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_approved_by_account_id",
                schema: "commercial",
                table: "contract_versions",
                column: "approved_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_contract_id_status_valid_from",
                schema: "commercial",
                table: "contract_versions",
                columns: new[] { "contract_id", "status", "valid_from" });

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_contract_id_version_number",
                schema: "commercial",
                table: "contract_versions",
                columns: new[] { "contract_id", "version_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contract_versions_public_id",
                schema: "commercial",
                table: "contract_versions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contracts_airline_id_status",
                schema: "commercial",
                table: "contracts",
                columns: new[] { "airline_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_contracts_contract_code",
                schema: "commercial",
                table: "contracts",
                column: "contract_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contracts_originating_service_request_id",
                schema: "commercial",
                table: "contracts",
                column: "originating_service_request_id");

            migrationBuilder.CreateIndex(
                name: "IX_contracts_public_id",
                schema: "commercial",
                table: "contracts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_coverage_requirements_operational_position_id",
                schema: "hr",
                table: "coverage_requirements",
                column: "operational_position_id");

            migrationBuilder.CreateIndex(
                name: "IX_coverage_requirements_public_id",
                schema: "hr",
                table: "coverage_requirements",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_coverage_requirements_station_id_terminal_id_operational_position_id_block_effective_from",
                schema: "hr",
                table: "coverage_requirements",
                columns: new[] { "station_id", "terminal_id", "operational_position_id", "block", "effective_from" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_coverage_requirements_terminal_id",
                schema: "hr",
                table: "coverage_requirements",
                column: "terminal_id");

            migrationBuilder.CreateIndex(
                name: "IX_qualification_cycles_equipment_type_id",
                schema: "hr",
                table: "qualification_cycles",
                column: "equipment_type_id");

            migrationBuilder.CreateIndex(
                name: "IX_qualification_cycles_is_current_expires_on",
                schema: "hr",
                table: "qualification_cycles",
                columns: new[] { "is_current", "expires_on" });

            migrationBuilder.CreateIndex(
                name: "IX_qualification_cycles_public_id",
                schema: "hr",
                table: "qualification_cycles",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_qualification_cycles_ramp_agent_id_equipment_type_id",
                schema: "hr",
                table: "qualification_cycles",
                columns: new[] { "ramp_agent_id", "equipment_type_id" },
                unique: true,
                filter: "[is_current] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_qualification_cycles_ramp_agent_id_equipment_type_id_cycle_number",
                schema: "hr",
                table: "qualification_cycles",
                columns: new[] { "ramp_agent_id", "equipment_type_id", "cycle_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_qualification_cycles_supersedes_qualification_id",
                schema: "hr",
                table: "qualification_cycles",
                column: "supersedes_qualification_id");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agent_station_scopes_ramp_agent_id_station_id",
                schema: "hr",
                table: "ramp_agent_station_scopes",
                columns: new[] { "ramp_agent_id", "station_id" },
                unique: true,
                filter: "[valid_to] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agent_station_scopes_ramp_agent_id_station_id_valid_from",
                schema: "hr",
                table: "ramp_agent_station_scopes",
                columns: new[] { "ramp_agent_id", "station_id", "valid_from" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agent_station_scopes_station_id",
                schema: "hr",
                table: "ramp_agent_station_scopes",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agent_terminal_scopes_ramp_agent_id_terminal_id",
                schema: "hr",
                table: "ramp_agent_terminal_scopes",
                columns: new[] { "ramp_agent_id", "terminal_id" },
                unique: true,
                filter: "[valid_to] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agent_terminal_scopes_ramp_agent_id_terminal_id_valid_from",
                schema: "hr",
                table: "ramp_agent_terminal_scopes",
                columns: new[] { "ramp_agent_id", "terminal_id", "valid_from" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agent_terminal_scopes_terminal_id",
                schema: "hr",
                table: "ramp_agent_terminal_scopes",
                column: "terminal_id");

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agents_employee_number",
                schema: "hr",
                table: "ramp_agents",
                column: "employee_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agents_person_id",
                schema: "hr",
                table: "ramp_agents",
                column: "person_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agents_public_id",
                schema: "hr",
                table: "ramp_agents",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ramp_agents_supervisor_agent_id",
                schema: "hr",
                table: "ramp_agents",
                column: "supervisor_agent_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_request_items_public_id",
                schema: "commercial",
                table: "service_request_items",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_request_items_service_definition_id",
                schema: "commercial",
                table: "service_request_items",
                column: "service_definition_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_request_items_service_request_id",
                schema: "commercial",
                table: "service_request_items",
                column: "service_request_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_request_stations_station_id",
                schema: "commercial",
                table: "service_request_stations",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_request_status_events_actor_account_id",
                schema: "commercial",
                table: "service_request_status_events",
                column: "actor_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_request_status_events_service_request_id_occurred_at",
                schema: "commercial",
                table: "service_request_status_events",
                columns: new[] { "service_request_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_airline_id_status_submitted_at",
                schema: "commercial",
                table: "service_requests",
                columns: new[] { "airline_id", "status", "submitted_at" });

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_public_id",
                schema: "commercial",
                table: "service_requests",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_request_code",
                schema: "commercial",
                table: "service_requests",
                column: "request_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_requests_reviewed_by_account_id",
                schema: "commercial",
                table: "service_requests",
                column: "reviewed_by_account_id");

            migrationBuilder.CreateIndex(
                name: "IX_shift_assignments_operational_position_id",
                schema: "hr",
                table: "shift_assignments",
                column: "operational_position_id");

            migrationBuilder.CreateIndex(
                name: "IX_shift_assignments_public_id",
                schema: "hr",
                table: "shift_assignments",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_shift_assignments_ramp_agent_id_work_date",
                schema: "hr",
                table: "shift_assignments",
                columns: new[] { "ramp_agent_id", "work_date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_shift_assignments_station_id_work_date_block",
                schema: "hr",
                table: "shift_assignments",
                columns: new[] { "station_id", "work_date", "block" });

            migrationBuilder.CreateIndex(
                name: "IX_shift_assignments_terminal_id",
                schema: "hr",
                table: "shift_assignments",
                column: "terminal_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "airport_permit_cycles",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "availability_requests",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "contract_service_rates",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "contract_status_events",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "contract_version_stations",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "coverage_requirements",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "qualification_cycles",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "ramp_agent_station_scopes",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "ramp_agent_terminal_scopes",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "service_request_items",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "service_request_stations",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "service_request_status_events",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "shift_assignments",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "contract_versions",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "ramp_agents",
                schema: "hr");

            migrationBuilder.DropTable(
                name: "contracts",
                schema: "commercial");

            migrationBuilder.DropTable(
                name: "service_requests",
                schema: "commercial");
        }
    }
}
