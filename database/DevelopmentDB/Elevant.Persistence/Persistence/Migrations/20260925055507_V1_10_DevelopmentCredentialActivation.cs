using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_10_DevelopmentCredentialActivation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "must_change_password",
                schema: "iam",
                table: "accounts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql(
                """
                EXEC(N'
                CREATE OR ALTER PROCEDURE [iam].[require_development_hr_password_change]
                WITH EXECUTE AS OWNER
                AS
                BEGIN
                    SET NOCOUNT ON;
                    SET XACT_ABORT ON;

                    IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
                       OR NOT EXISTS (
                           SELECT 1 FROM [infra].[database_instances]
                           WHERE [id] = 1 AND [environment_name] = N''Development''
                       )
                        THROW 52200, ''Development credential activation is forbidden outside Development.'', 1;

                    IF (
                        SELECT COUNT_BIG(*)
                        FROM [iam].[accounts] AS account
                        INNER JOIN [iam].[persons] AS person ON person.[id] = account.[person_id]
                        WHERE account.[normalized_email] = N''GESTION.HUMANA@DEV.ELEVANT.TEST''
                          AND account.[public_id] = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000004'')
                          AND person.[public_id] = CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000004'')
                    ) <> 1
                        THROW 52201, ''The synthetic HR account is missing, duplicated, or has identity drift.'', 1;

                    UPDATE account
                    SET [must_change_password] = CONVERT(bit, 1),
                        [updated_at] = SYSUTCDATETIME()
                    FROM [iam].[accounts] AS account
                    INNER JOIN [iam].[persons] AS person ON person.[id] = account.[person_id]
                    WHERE account.[normalized_email] = N''GESTION.HUMANA@DEV.ELEVANT.TEST''
                      AND account.[public_id] = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000004'')
                      AND person.[public_id] = CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000004'');

                    IF @@ROWCOUNT <> 1
                        THROW 52202, ''The synthetic HR account changed during credential activation.'', 1;
                END;
                ');

                REVOKE EXECUTE ON OBJECT::[iam].[require_development_hr_password_change] FROM [public];
                IF DATABASE_PRINCIPAL_ID(N'guest') IS NOT NULL
                    REVOKE EXECUTE ON OBJECT::[iam].[require_development_hr_password_change] FROM [guest];
                IF DATABASE_PRINCIPAL_ID(N'elevant_seeder_role') IS NOT NULL
                    GRANT EXECUTE ON OBJECT::[iam].[require_development_hr_password_change] TO [elevant_seeder_role];
                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                    DENY EXECUTE ON OBJECT::[iam].[require_development_hr_password_change] TO [elevant_app_role];
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                IF OBJECT_ID(N'[iam].[require_development_hr_password_change]', N'P') IS NOT NULL
                BEGIN
                    IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                        REVOKE EXECUTE ON OBJECT::[iam].[require_development_hr_password_change] FROM [elevant_app_role];
                    IF DATABASE_PRINCIPAL_ID(N'elevant_seeder_role') IS NOT NULL
                        REVOKE EXECUTE ON OBJECT::[iam].[require_development_hr_password_change] FROM [elevant_seeder_role];
                    DROP PROCEDURE [iam].[require_development_hr_password_change];
                END;
                """);
            migrationBuilder.DropColumn(
                name: "must_change_password",
                schema: "iam",
                table: "accounts");
        }
    }
}
