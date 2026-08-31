using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_02_IdentityReference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "iam");

            migrationBuilder.EnsureSchema(
                name: "ref");

            migrationBuilder.CreateTable(
                name: "aircraft_types",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    icao_code = table.Column<string>(type: "char(4)", nullable: false),
                    iata_code = table.Column<string>(type: "char(3)", nullable: true),
                    manufacturer = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    model = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_aircraft_types", x => x.id);
                    table.CheckConstraint("ck_aircraft_type_icao", "LEN([icao_code]) = 4");
                });

            migrationBuilder.CreateTable(
                name: "airports",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    iata_code = table.Column<string>(type: "char(3)", nullable: false),
                    icao_code = table.Column<string>(type: "char(4)", nullable: false),
                    name = table.Column<string>(type: "nvarchar(180)", maxLength: 180, nullable: false),
                    city = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    country_code = table.Column<string>(type: "char(2)", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airports", x => x.id);
                    table.CheckConstraint("ck_airport_country", "LEN([country_code]) = 2");
                    table.CheckConstraint("ck_airport_iata", "LEN([iata_code]) = 3");
                    table.CheckConstraint("ck_airport_icao", "LEN([icao_code]) = 4");
                });

            migrationBuilder.CreateTable(
                name: "equipment_types",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    requires_qualification = table.Column<bool>(type: "bit", nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_equipment_types", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "organizations",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    legal_name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    display_name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organizations", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "permissions",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    code = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_permissions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "persons",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    first_name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    last_name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    primary_email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    phone_number = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    identification_type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    identification_number = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_persons", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roles",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    portal = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    user_type = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    name = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    normalized_name = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    concurrency_stamp = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_roles", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "service_definitions",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    default_billing_unit = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_definitions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "stations",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    airport_id = table.Column<long>(type: "bigint", nullable: false),
                    code = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    iana_time_zone = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stations", x => x.id);
                    table.ForeignKey(
                        name: "FK_stations_airports_airport_id",
                        column: x => x.airport_id,
                        principalSchema: "ref",
                        principalTable: "airports",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "operational_positions",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    code = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    requires_qualification = table.Column<bool>(type: "bit", nullable: false),
                    required_equipment_type_id = table.Column<long>(type: "bigint", nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operational_positions", x => x.id);
                    table.ForeignKey(
                        name: "FK_operational_positions_equipment_types_required_equipment_type_id",
                        column: x => x.required_equipment_type_id,
                        principalSchema: "ref",
                        principalTable: "equipment_types",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "airlines",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    organization_id = table.Column<long>(type: "bigint", nullable: false),
                    iata_code = table.Column<string>(type: "char(2)", nullable: false),
                    icao_code = table.Column<string>(type: "char(3)", nullable: false),
                    name = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_airlines", x => x.id);
                    table.CheckConstraint("ck_airline_iata", "LEN([iata_code]) = 2");
                    table.CheckConstraint("ck_airline_icao", "LEN([icao_code]) = 3");
                    table.ForeignKey(
                        name: "FK_airlines_organizations_organization_id",
                        column: x => x.organization_id,
                        principalSchema: "iam",
                        principalTable: "organizations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "accounts",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    person_id = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    invitation_status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    invitation_sent_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    last_login_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
                    user_name = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    normalized_user_name = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    normalized_email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    email_confirmed = table.Column<bool>(type: "bit", nullable: false),
                    password_hash = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    security_stamp = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    concurrency_stamp = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    phone_number = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    phone_number_confirmed = table.Column<bool>(type: "bit", nullable: false),
                    two_factor_enabled = table.Column<bool>(type: "bit", nullable: false),
                    lockout_end = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    lockout_enabled = table.Column<bool>(type: "bit", nullable: false),
                    access_failed_count = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_accounts", x => x.id);
                    table.ForeignKey(
                        name: "FK_accounts_persons_person_id",
                        column: x => x.person_id,
                        principalSchema: "iam",
                        principalTable: "persons",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "role_claims",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    role_id = table.Column<long>(type: "bigint", nullable: false),
                    claim_type = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    claim_value = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_role_claims", x => x.id);
                    table.ForeignKey(
                        name: "FK_role_claims_roles_role_id",
                        column: x => x.role_id,
                        principalSchema: "iam",
                        principalTable: "roles",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "role_permissions",
                schema: "iam",
                columns: table => new
                {
                    role_id = table.Column<long>(type: "bigint", nullable: false),
                    permission_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_role_permissions", x => new { x.role_id, x.permission_id });
                    table.ForeignKey(
                        name: "FK_role_permissions_permissions_permission_id",
                        column: x => x.permission_id,
                        principalSchema: "iam",
                        principalTable: "permissions",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_role_permissions_roles_role_id",
                        column: x => x.role_id,
                        principalSchema: "iam",
                        principalTable: "roles",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "terminals",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    code = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_terminals", x => x.id);
                    table.ForeignKey(
                        name: "FK_terminals_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "account_claims",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    claim_type = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    claim_value = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_claims", x => x.id);
                    table.ForeignKey(
                        name: "FK_account_claims_accounts_user_id",
                        column: x => x.user_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "account_logins",
                schema: "iam",
                columns: table => new
                {
                    login_provider = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    provider_key = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    provider_display_name = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    user_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_logins", x => new { x.login_provider, x.provider_key });
                    table.ForeignKey(
                        name: "FK_account_logins_accounts_user_id",
                        column: x => x.user_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "account_roles",
                schema: "iam",
                columns: table => new
                {
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    role_id = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_roles", x => new { x.user_id, x.role_id });
                    table.ForeignKey(
                        name: "FK_account_roles_accounts_user_id",
                        column: x => x.user_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_account_roles_roles_role_id",
                        column: x => x.role_id,
                        principalSchema: "iam",
                        principalTable: "roles",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "account_station_scopes",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    granted_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_station_scopes", x => x.id);
                    table.CheckConstraint("ck_account_station_scope_dates", "[revoked_at] IS NULL OR [revoked_at] >= [granted_at]");
                    table.ForeignKey(
                        name: "FK_account_station_scopes_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_account_station_scopes_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "account_tokens",
                schema: "iam",
                columns: table => new
                {
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    login_provider = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    name = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    value = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_tokens", x => new { x.user_id, x.login_provider, x.name });
                    table.ForeignKey(
                        name: "FK_account_tokens_accounts_user_id",
                        column: x => x.user_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "organization_memberships",
                schema: "iam",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    account_id = table.Column<long>(type: "bigint", nullable: false),
                    organization_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    job_title = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    valid_from = table.Column<DateOnly>(type: "date", nullable: true),
                    valid_to = table.Column<DateOnly>(type: "date", nullable: true),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organization_memberships", x => x.id);
                    table.CheckConstraint("ck_membership_dates", "[valid_to] IS NULL OR [valid_from] IS NULL OR [valid_to] >= [valid_from]");
                    table.ForeignKey(
                        name: "FK_organization_memberships_accounts_account_id",
                        column: x => x.account_id,
                        principalSchema: "iam",
                        principalTable: "accounts",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_organization_memberships_organizations_organization_id",
                        column: x => x.organization_id,
                        principalSchema: "iam",
                        principalTable: "organizations",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "stands",
                schema: "ref",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    station_id = table.Column<long>(type: "bigint", nullable: false),
                    terminal_id = table.Column<long>(type: "bigint", nullable: true),
                    code = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    stand_type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false),
                    public_id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWSEQUENTIALID()"),
                    created_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset(3)", precision: 3, nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    row_version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stands", x => x.id);
                    table.ForeignKey(
                        name: "FK_stands_stations_station_id",
                        column: x => x.station_id,
                        principalSchema: "ref",
                        principalTable: "stations",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "FK_stands_terminals_terminal_id",
                        column: x => x.terminal_id,
                        principalSchema: "ref",
                        principalTable: "terminals",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_claims_user_id",
                schema: "iam",
                table: "account_claims",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_account_logins_user_id",
                schema: "iam",
                table: "account_logins",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_account_roles_role_id",
                schema: "iam",
                table: "account_roles",
                column: "role_id");

            migrationBuilder.CreateIndex(
                name: "IX_account_station_scopes_account_id_station_id",
                schema: "iam",
                table: "account_station_scopes",
                columns: new[] { "account_id", "station_id" },
                unique: true,
                filter: "[revoked_at] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_account_station_scopes_station_id",
                schema: "iam",
                table: "account_station_scopes",
                column: "station_id");

            migrationBuilder.CreateIndex(
                name: "ix_accounts_normalized_email",
                schema: "iam",
                table: "accounts",
                column: "normalized_email");

            migrationBuilder.CreateIndex(
                name: "IX_accounts_person_id",
                schema: "iam",
                table: "accounts",
                column: "person_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_accounts_public_id",
                schema: "iam",
                table: "accounts",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_accounts_normalized_user_name",
                schema: "iam",
                table: "accounts",
                column: "normalized_user_name",
                unique: true,
                filter: "[normalized_user_name] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_aircraft_types_icao_code",
                schema: "ref",
                table: "aircraft_types",
                column: "icao_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_aircraft_types_public_id",
                schema: "ref",
                table: "aircraft_types",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airlines_iata_code",
                schema: "ref",
                table: "airlines",
                column: "iata_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airlines_icao_code",
                schema: "ref",
                table: "airlines",
                column: "icao_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airlines_organization_id",
                schema: "ref",
                table: "airlines",
                column: "organization_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airlines_public_id",
                schema: "ref",
                table: "airlines",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airports_iata_code",
                schema: "ref",
                table: "airports",
                column: "iata_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airports_icao_code",
                schema: "ref",
                table: "airports",
                column: "icao_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_airports_public_id",
                schema: "ref",
                table: "airports",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_equipment_types_code",
                schema: "ref",
                table: "equipment_types",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_equipment_types_public_id",
                schema: "ref",
                table: "equipment_types",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_positions_code",
                schema: "ref",
                table: "operational_positions",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_positions_public_id",
                schema: "ref",
                table: "operational_positions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_positions_required_equipment_type_id",
                schema: "ref",
                table: "operational_positions",
                column: "required_equipment_type_id");

            migrationBuilder.CreateIndex(
                name: "IX_organization_memberships_account_id_organization_id",
                schema: "iam",
                table: "organization_memberships",
                columns: new[] { "account_id", "organization_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_organization_memberships_organization_id",
                schema: "iam",
                table: "organization_memberships",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "IX_organization_memberships_public_id",
                schema: "iam",
                table: "organization_memberships",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_organizations_code",
                schema: "iam",
                table: "organizations",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_organizations_public_id",
                schema: "iam",
                table: "organizations",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_permissions_code",
                schema: "iam",
                table: "permissions",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_permissions_public_id",
                schema: "iam",
                table: "permissions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_persons_identification_type_identification_number",
                schema: "iam",
                table: "persons",
                columns: new[] { "identification_type", "identification_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_persons_primary_email",
                schema: "iam",
                table: "persons",
                column: "primary_email",
                unique: true,
                filter: "[primary_email] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_persons_public_id",
                schema: "iam",
                table: "persons",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_role_claims_role_id",
                schema: "iam",
                table: "role_claims",
                column: "role_id");

            migrationBuilder.CreateIndex(
                name: "IX_role_permissions_permission_id",
                schema: "iam",
                table: "role_permissions",
                column: "permission_id");

            migrationBuilder.CreateIndex(
                name: "IX_roles_public_id",
                schema: "iam",
                table: "roles",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_roles_normalized_name",
                schema: "iam",
                table: "roles",
                column: "normalized_name",
                unique: true,
                filter: "[normalized_name] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_service_definitions_code",
                schema: "ref",
                table: "service_definitions",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_definitions_public_id",
                schema: "ref",
                table: "service_definitions",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stands_public_id",
                schema: "ref",
                table: "stands",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stands_station_id_code",
                schema: "ref",
                table: "stands",
                columns: new[] { "station_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stands_terminal_id",
                schema: "ref",
                table: "stands",
                column: "terminal_id");

            migrationBuilder.CreateIndex(
                name: "IX_stations_airport_id",
                schema: "ref",
                table: "stations",
                column: "airport_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stations_code",
                schema: "ref",
                table: "stations",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stations_public_id",
                schema: "ref",
                table: "stations",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_terminals_public_id",
                schema: "ref",
                table: "terminals",
                column: "public_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_terminals_station_id_code",
                schema: "ref",
                table: "terminals",
                columns: new[] { "station_id", "code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_claims",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "account_logins",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "account_roles",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "account_station_scopes",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "account_tokens",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "aircraft_types",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "airlines",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "operational_positions",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "organization_memberships",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "role_claims",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "role_permissions",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "service_definitions",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "stands",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "equipment_types",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "accounts",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "organizations",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "permissions",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "roles",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "terminals",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "persons",
                schema: "iam");

            migrationBuilder.DropTable(
                name: "stations",
                schema: "ref");

            migrationBuilder.DropTable(
                name: "airports",
                schema: "ref");
        }
    }
}
