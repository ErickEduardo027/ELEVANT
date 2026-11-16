using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Elevant.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class V1_07_DevelopmentHumanResourcesAccount : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                EXEC(N'
                CREATE OR ALTER PROCEDURE [iam].[set_development_account_credential]
                    @normalized_email nvarchar(256),
                    @public_id uniqueidentifier,
                    @password_hash nvarchar(max) = NULL,
                    @security_stamp nvarchar(max) = NULL
                WITH EXECUTE AS OWNER
                AS
                BEGIN
                    SET NOCOUNT ON;
                    SET XACT_ABORT ON;

                    IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
                       OR NOT EXISTS (
                           SELECT 1
                           FROM [infra].[database_instances]
                           WHERE [id] = 1 AND [environment_name] = N''Development''
                       )
                        THROW 52100, ''Development credential rotation is forbidden outside Development.'', 1;

                    IF NOT (
                        (@normalized_email COLLATE Latin1_General_100_BIN2 = N''ADMIN.OCC@DEV.ELEVANT.TEST''
                         AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000001''))
                        OR (@normalized_email COLLATE Latin1_General_100_BIN2 = N''RAMP.AGENT@DEV.ELEVANT.TEST''
                            AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000002''))
                        OR (@normalized_email COLLATE Latin1_General_100_BIN2 = N''AIRLINE.CLIENT@DEV.ELEVANT.TEST''
                            AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000003''))
                        OR (@normalized_email COLLATE Latin1_General_100_BIN2 = N''GESTION.HUMANA@DEV.ELEVANT.TEST''
                            AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000004''))
                    )
                        THROW 52101, ''Credential rotation is restricted to synthetic Development accounts.'', 1;

                    IF (@password_hash IS NULL AND @security_stamp IS NOT NULL)
                       OR (@password_hash IS NOT NULL AND @security_stamp IS NULL)
                       OR (@password_hash IS NOT NULL AND (LEN(@password_hash) = 0 OR LEN(@security_stamp) = 0))
                        THROW 52102, ''Password hash and security stamp must be supplied together.'', 1;

                    IF (
                        SELECT COUNT_BIG(*)
                        FROM [iam].[accounts] AS accounts
                        INNER JOIN [iam].[persons] AS persons
                            ON persons.[id] = accounts.[person_id]
                        WHERE accounts.[normalized_email] = @normalized_email
                          AND accounts.[public_id] = @public_id
                          AND persons.[public_id] = CASE @normalized_email
                              WHEN N''ADMIN.OCC@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000001'')
                              WHEN N''RAMP.AGENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000002'')
                              WHEN N''AIRLINE.CLIENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000003'')
                              WHEN N''GESTION.HUMANA@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000004'')
                          END
                    ) <> 1
                        THROW 52103, ''The synthetic Development account is missing, duplicated, or has identity drift.'', 1;

                    UPDATE accounts
                    SET [lockout_enabled] = CONVERT(bit, 1),
                        [password_hash] = CASE
                            WHEN @password_hash IS NULL THEN accounts.[password_hash]
                            ELSE @password_hash
                        END,
                        [security_stamp] = CASE
                            WHEN @security_stamp IS NULL THEN accounts.[security_stamp]
                            ELSE @security_stamp
                        END,
                        [updated_at] = SYSUTCDATETIME()
                    FROM [iam].[accounts] AS accounts
                    INNER JOIN [iam].[persons] AS persons
                        ON persons.[id] = accounts.[person_id]
                    WHERE accounts.[normalized_email] = @normalized_email
                      AND accounts.[public_id] = @public_id
                      AND persons.[public_id] = CASE @normalized_email
                          WHEN N''ADMIN.OCC@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000001'')
                          WHEN N''RAMP.AGENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000002'')
                          WHEN N''AIRLINE.CLIENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000003'')
                          WHEN N''GESTION.HUMANA@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000004'')
                      END;

                    IF @@ROWCOUNT <> 1
                        THROW 52104, ''The synthetic Development account changed during credential rotation.'', 1;
                END;
                ');

                REVOKE EXECUTE ON OBJECT::[iam].[set_development_account_credential] FROM [public];
                IF DATABASE_PRINCIPAL_ID(N'guest') IS NOT NULL
                    REVOKE EXECUTE ON OBJECT::[iam].[set_development_account_credential] FROM [guest];

                IF DATABASE_PRINCIPAL_ID(N'elevant_seeder_role') IS NOT NULL
                BEGIN
                    REVOKE EXECUTE ON SCHEMA::[iam] FROM [elevant_seeder_role];
                    GRANT EXECUTE ON OBJECT::[iam].[set_development_account_credential] TO [elevant_seeder_role];
                END;

                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                    DENY EXECUTE ON OBJECT::[iam].[set_development_account_credential] TO [elevant_app_role];
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                EXEC(N'
                CREATE OR ALTER PROCEDURE [iam].[set_development_account_credential]
                    @normalized_email nvarchar(256),
                    @public_id uniqueidentifier,
                    @password_hash nvarchar(max) = NULL,
                    @security_stamp nvarchar(max) = NULL
                WITH EXECUTE AS OWNER
                AS
                BEGIN
                    SET NOCOUNT ON;
                    SET XACT_ABORT ON;

                    IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
                       OR NOT EXISTS (
                           SELECT 1
                           FROM [infra].[database_instances]
                           WHERE [id] = 1 AND [environment_name] = N''Development''
                       )
                        THROW 52100, ''Development credential rotation is forbidden outside Development.'', 1;

                    IF NOT (
                        (@normalized_email COLLATE Latin1_General_100_BIN2 = N''ADMIN.OCC@DEV.ELEVANT.TEST''
                         AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000001''))
                        OR (@normalized_email COLLATE Latin1_General_100_BIN2 = N''RAMP.AGENT@DEV.ELEVANT.TEST''
                            AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000002''))
                        OR (@normalized_email COLLATE Latin1_General_100_BIN2 = N''AIRLINE.CLIENT@DEV.ELEVANT.TEST''
                            AND @public_id = CONVERT(uniqueidentifier, N''40000000-0000-7000-8000-000000000003''))
                    )
                        THROW 52101, ''Credential rotation is restricted to synthetic Development accounts.'', 1;

                    IF (@password_hash IS NULL AND @security_stamp IS NOT NULL)
                       OR (@password_hash IS NOT NULL AND @security_stamp IS NULL)
                       OR (@password_hash IS NOT NULL AND (LEN(@password_hash) = 0 OR LEN(@security_stamp) = 0))
                        THROW 52102, ''Password hash and security stamp must be supplied together.'', 1;

                    IF (
                        SELECT COUNT_BIG(*)
                        FROM [iam].[accounts] AS accounts
                        INNER JOIN [iam].[persons] AS persons
                            ON persons.[id] = accounts.[person_id]
                        WHERE accounts.[normalized_email] = @normalized_email
                          AND accounts.[public_id] = @public_id
                          AND persons.[public_id] = CASE @normalized_email
                              WHEN N''ADMIN.OCC@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000001'')
                              WHEN N''RAMP.AGENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000002'')
                              WHEN N''AIRLINE.CLIENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000003'')
                          END
                    ) <> 1
                        THROW 52103, ''The synthetic Development account is missing, duplicated, or has identity drift.'', 1;

                    UPDATE accounts
                    SET [lockout_enabled] = CONVERT(bit, 1),
                        [password_hash] = CASE
                            WHEN @password_hash IS NULL THEN accounts.[password_hash]
                            ELSE @password_hash
                        END,
                        [security_stamp] = CASE
                            WHEN @security_stamp IS NULL THEN accounts.[security_stamp]
                            ELSE @security_stamp
                        END,
                        [updated_at] = SYSUTCDATETIME()
                    FROM [iam].[accounts] AS accounts
                    INNER JOIN [iam].[persons] AS persons
                        ON persons.[id] = accounts.[person_id]
                    WHERE accounts.[normalized_email] = @normalized_email
                      AND accounts.[public_id] = @public_id
                      AND persons.[public_id] = CASE @normalized_email
                          WHEN N''ADMIN.OCC@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000001'')
                          WHEN N''RAMP.AGENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000002'')
                          WHEN N''AIRLINE.CLIENT@DEV.ELEVANT.TEST'' THEN CONVERT(uniqueidentifier, N''30000000-0000-7000-8000-000000000003'')
                      END;

                    IF @@ROWCOUNT <> 1
                        THROW 52104, ''The synthetic Development account changed during credential rotation.'', 1;
                END;
                ');

                REVOKE EXECUTE ON OBJECT::[iam].[set_development_account_credential] FROM [public];
                IF DATABASE_PRINCIPAL_ID(N'guest') IS NOT NULL
                    REVOKE EXECUTE ON OBJECT::[iam].[set_development_account_credential] FROM [guest];

                IF DATABASE_PRINCIPAL_ID(N'elevant_seeder_role') IS NOT NULL
                BEGIN
                    REVOKE EXECUTE ON SCHEMA::[iam] FROM [elevant_seeder_role];
                    GRANT EXECUTE ON OBJECT::[iam].[set_development_account_credential] TO [elevant_seeder_role];
                END;

                IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NOT NULL
                    DENY EXECUTE ON OBJECT::[iam].[set_development_account_credential] TO [elevant_app_role];
                """);
        }
    }
}
