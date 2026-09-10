SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];

DECLARE @provision_lock_result int;
EXEC @provision_lock_result = sys.sp_getapplock
    @Resource = N'ElevantDevelopmentTeamAccessProvisioning',
    @LockMode = N'Exclusive',
    @LockOwner = N'Session',
    @LockTimeout = 0;
IF @provision_lock_result < 0
    THROW 51100, 'Another Development team-access provisioner is already running.', 1;

IF DB_ID(N'ElevantDevelopmentDb') IS NULL
    THROW 51101, 'ElevantDevelopmentDb does not exist.', 1;

IF OBJECT_ID(N'[ElevantDevelopmentDb].[infra].[database_instances]', N'U') IS NULL
    THROW 51102, 'ElevantDevelopmentDb has no environment marker.', 1;

DECLARE @environment_name nvarchar(32);
DECLARE @marker_count bigint;
EXEC sys.sp_executesql
    N'SELECT
          @count = COUNT_BIG(*),
          @environment = MAX(CASE WHEN [id] = 1 THEN [environment_name] END)
      FROM [ElevantDevelopmentDb].[infra].[database_instances];',
    N'@count bigint OUTPUT, @environment nvarchar(32) OUTPUT',
    @count = @marker_count OUTPUT,
    @environment = @environment_name OUTPUT;

IF @marker_count <> 1 OR @environment_name <> N'Development'
    THROW 51103, 'Refusing to provision team access outside the exact Development database.', 1;

DECLARE @team_members table
(
    [ordinal] tinyint NOT NULL PRIMARY KEY,
    [login_name] sysname NOT NULL UNIQUE,
    [password_value] nvarchar(128) NOT NULL UNIQUE
);

INSERT INTO @team_members ([ordinal], [login_name], [password_value])
VALUES
    (1, N'elevant_dev_erick', N'$(ELEVANT_DB_TEAM_ERICK_PASSWORD)'),
    (2, N'elevant_dev_eliezer', N'$(ELEVANT_DB_TEAM_ELIEZER_PASSWORD)'),
    (3, N'elevant_dev_laisha', N'$(ELEVANT_DB_TEAM_LAISHA_PASSWORD)');

IF EXISTS (
    SELECT 1
    FROM @team_members
    WHERE LEN([password_value]) < 16
       OR LEN([password_value]) > 128
       OR [password_value] COLLATE Latin1_General_100_BIN2 LIKE N'%[^-A-Za-z0-9!@#%_+=:.,?]%'
       OR [password_value] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[A-Z]%'
       OR [password_value] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[a-z]%'
       OR [password_value] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[0-9]%'
       OR [password_value] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[-!@#%_+=:.,?]%'
       OR [password_value] = [login_name]
       OR UPPER([password_value]) LIKE N'REPLACE[_]%'
       OR UPPER([password_value]) LIKE N'PLACEHOLDER[_]%'
       OR UPPER([password_value]) LIKE N'CHANGE[_]ME%'
       OR UPPER([password_value]) LIKE N'CHANGEME%'
)
    THROW 51104, 'Each team password must satisfy the approved secret transport contract.', 1;

DECLARE @statement nvarchar(max);
DECLARE @error_message nvarchar(2048);

DECLARE @login_name sysname;
DECLARE @password_value nvarchar(128);

BEGIN TRY
    BEGIN TRANSACTION;

DECLARE team_login_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT [login_name], [password_value]
    FROM @team_members
    ORDER BY [ordinal];

OPEN team_login_cursor;
FETCH NEXT FROM team_login_cursor INTO @login_name, @password_value;

WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @login_was_disabled bit = 0;

    IF SUSER_ID(@login_name) IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM sys.sql_logins
            WHERE [name] = @login_name
        )
        BEGIN
            SET @error_message = N'Refusing to adopt non-SQL principal ' + QUOTENAME(@login_name) + N'.';
            THROW 51105, @error_message, 1;
        END;

        IF EXISTS (
            SELECT 1
            FROM sys.sql_logins
            WHERE [name] = @login_name
              AND [credential_id] IS NOT NULL
        )
        BEGIN
            SET @error_message = N'Team login has a forbidden server credential: ' + QUOTENAME(@login_name) + N'.';
            THROW 51117, @error_message, 1;
        END;

        IF EXISTS (
            SELECT 1
            FROM sys.server_role_members
            WHERE [member_principal_id] = SUSER_ID(@login_name)
        )
        BEGIN
            SET @error_message = N'Team login has a forbidden fixed server role: ' + QUOTENAME(@login_name) + N'.';
            THROW 51106, @error_message, 1;
        END;

        IF EXISTS (
            SELECT 1
            FROM sys.server_permissions
            WHERE [grantee_principal_id] = SUSER_ID(@login_name)
              AND NOT (
                  [class] = 100
                  AND [permission_name] = N'CONNECT SQL'
                  AND [state] = N'G'
              )
        )
        BEGIN
            SET @error_message = N'Team login has a forbidden direct server permission: ' + QUOTENAME(@login_name) + N'.';
            THROW 51107, @error_message, 1;
        END;

        IF EXISTS (
            SELECT 1
            FROM sys.databases
            WHERE [owner_sid] = SUSER_SID(@login_name)
        )
        OR EXISTS (
            SELECT 1
            FROM sys.server_principals
            WHERE [owning_principal_id] = SUSER_ID(@login_name)
        )
        OR EXISTS (
            SELECT 1
            FROM sys.endpoints
            WHERE [principal_id] = SUSER_ID(@login_name)
        )
        BEGIN
            SET @error_message = N'Team login owns a forbidden server securable: ' + QUOTENAME(@login_name) + N'.';
            THROW 51114, @error_message, 1;
        END;

        SELECT @login_was_disabled = [is_disabled]
        FROM sys.sql_logins
        WHERE [name] = @login_name;

        -- Replacing the server login intentionally assigns a fresh SID. Any
        -- same-named user left in another database is therefore orphaned and
        -- cannot grant this login access. DROP LOGIN also fails closed while
        -- an interactive team session is active, so operators must reconcile
        -- access during a short, announced SSMS maintenance window.
        SET @statement = N'DROP LOGIN ' + QUOTENAME(@login_name) + N';';
        BEGIN TRY
            EXEC sys.sp_executesql @statement;
        END TRY
        BEGIN CATCH
            -- ALTER ANY LOGIN does not grant metadata visibility for custom
            -- server roles. SQL Server still fails DROP LOGIN with 15141 when
            -- the hidden role is owned by this login; translate that native
            -- fail-closed result into the stable controller contract.
            IF ERROR_NUMBER() = 15141
            BEGIN
                SET @error_message = N'Team login owns a forbidden server securable: ' + QUOTENAME(@login_name) + N'.';
                THROW 51114, @error_message, 1;
            END;
            THROW;
        END CATCH;
    END;

    SET @statement =
        N'CREATE LOGIN ' + QUOTENAME(@login_name) +
        N' WITH PASSWORD = ' + QUOTENAME(@password_value, '''') +
        N', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, ' +
        N'DEFAULT_DATABASE = [ElevantDevelopmentDb];';
    EXEC sys.sp_executesql @statement;

    -- A disabled login is an explicit offboarding control. Reconciliation
    -- preserves that state after replacing the login and rotating its secret.
    IF @login_was_disabled = 1
    BEGIN
        SET @statement = N'ALTER LOGIN ' + QUOTENAME(@login_name) + N' DISABLE;';
        EXEC sys.sp_executesql @statement;
    END;

    IF EXISTS (
        SELECT 1
        FROM sys.sql_logins
        WHERE [name] = @login_name
          AND (
              [is_policy_checked] <> 1
              OR [is_expiration_checked] <> 0
              OR [default_database_name] <> N'ElevantDevelopmentDb'
              OR [is_disabled] <> @login_was_disabled
              OR [credential_id] IS NOT NULL
          )
    )
    BEGIN
        SET @error_message = N'Team login policy or enabled state is invalid: ' + QUOTENAME(@login_name) + N'.';
        THROW 51112, @error_message, 1;
    END;

    IF EXISTS (
        SELECT 1
        FROM sys.server_role_members
        WHERE [member_principal_id] = SUSER_ID(@login_name)
    )
    BEGIN
        SET @error_message = N'Team login has a forbidden fixed server role: ' + QUOTENAME(@login_name) + N'.';
        THROW 51106, @error_message, 1;
    END;

    IF EXISTS (
        SELECT 1
        FROM sys.server_permissions
        WHERE [grantee_principal_id] = SUSER_ID(@login_name)
          AND NOT (
              [class] = 100
              AND [permission_name] = N'CONNECT SQL'
              AND [state] = N'G'
          )
    )
    BEGIN
        SET @error_message = N'Team login has a forbidden direct server permission: ' + QUOTENAME(@login_name) + N'.';
        THROW 51107, @error_message, 1;
    END;

    IF EXISTS (
        SELECT 1
        FROM sys.databases
        WHERE [owner_sid] = SUSER_SID(@login_name)
    )
    OR EXISTS (
        SELECT 1
        FROM sys.server_principals
        WHERE [owning_principal_id] = SUSER_ID(@login_name)
    )
    OR EXISTS (
        SELECT 1
        FROM sys.endpoints
        WHERE [principal_id] = SUSER_ID(@login_name)
    )
    BEGIN
        SET @error_message = N'Team login owns a forbidden server securable: ' + QUOTENAME(@login_name) + N'.';
        THROW 51114, @error_message, 1;
    END;

    FETCH NEXT FROM team_login_cursor INTO @login_name, @password_value;
END;

CLOSE team_login_cursor;
DEALLOCATE team_login_cursor;

USE [ElevantDevelopmentDb];

IF DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor') IS NULL
    CREATE ROLE [elevant_dev_team_editor] AUTHORIZATION [dbo];

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE [name] = N'elevant_dev_team_editor'
      AND [type] = N'R'
      AND [is_fixed_role] = 0
      AND [owning_principal_id] = DATABASE_PRINCIPAL_ID(N'dbo')
)
    THROW 51113, 'The Development team editor principal is not an exact dbo-owned custom role.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.database_role_members
    WHERE [member_principal_id] = DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor')
)
    THROW 51108, 'The Development team editor role must not inherit another database role.', 1;

GRANT VIEW DEFINITION TO [elevant_dev_team_editor];

GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[iam] TO [elevant_dev_team_editor];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[ref] TO [elevant_dev_team_editor];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[hr] TO [elevant_dev_team_editor];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[commercial] TO [elevant_dev_team_editor];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[ops] TO [elevant_dev_team_editor];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[integration] TO [elevant_dev_team_editor];

DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[iam] TO [elevant_dev_team_editor];
DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[ref] TO [elevant_dev_team_editor];
DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[hr] TO [elevant_dev_team_editor];
DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[commercial] TO [elevant_dev_team_editor];
DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[ops] TO [elevant_dev_team_editor];
DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[integration] TO [elevant_dev_team_editor];

GRANT SELECT ON SCHEMA::[infra] TO [elevant_dev_team_editor];
GRANT SELECT ON SCHEMA::[audit] TO [elevant_dev_team_editor];
DENY INSERT, UPDATE, DELETE, ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP
    ON SCHEMA::[infra] TO [elevant_dev_team_editor];
DENY INSERT, UPDATE, DELETE, ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP
    ON SCHEMA::[audit] TO [elevant_dev_team_editor];

DENY CREATE TABLE TO [elevant_dev_team_editor];
DENY CREATE VIEW TO [elevant_dev_team_editor];
DENY CREATE PROCEDURE TO [elevant_dev_team_editor];
DENY CREATE FUNCTION TO [elevant_dev_team_editor];
DENY CREATE TYPE TO [elevant_dev_team_editor];
DENY CREATE SCHEMA TO [elevant_dev_team_editor];
DENY CREATE SYNONYM TO [elevant_dev_team_editor];
DENY CREATE ASSEMBLY TO [elevant_dev_team_editor];
DENY ALTER ANY SCHEMA TO [elevant_dev_team_editor];
DENY ALTER ANY USER TO [elevant_dev_team_editor];
DENY ALTER ANY ROLE TO [elevant_dev_team_editor];
DENY ALTER ANY APPLICATION ROLE TO [elevant_dev_team_editor];
DENY ALTER ANY DATABASE SCOPED CONFIGURATION TO [elevant_dev_team_editor];
DENY BACKUP DATABASE TO [elevant_dev_team_editor];
DENY BACKUP LOG TO [elevant_dev_team_editor];

DECLARE @database_members table
(
    [ordinal] tinyint NOT NULL PRIMARY KEY,
    [login_name] sysname NOT NULL UNIQUE
);

INSERT INTO @database_members ([ordinal], [login_name])
VALUES
    (1, N'elevant_dev_erick'),
    (2, N'elevant_dev_eliezer'),
    (3, N'elevant_dev_laisha');

DECLARE @database_login sysname;
DECLARE database_user_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT [login_name]
    FROM @database_members
    ORDER BY [ordinal];

OPEN database_user_cursor;
FETCH NEXT FROM database_user_cursor INTO @database_login;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF USER_ID(@database_login) IS NULL
    BEGIN
        SET @statement =
            N'CREATE USER ' + QUOTENAME(@database_login) +
            N' FOR LOGIN ' + QUOTENAME(@database_login) + N';';
        EXEC sys.sp_executesql @statement;
    END
    ELSE
    BEGIN
        SET @statement =
            N'ALTER USER ' + QUOTENAME(@database_login) +
            N' WITH LOGIN = ' + QUOTENAME(@database_login) + N';';
        EXEC sys.sp_executesql @statement;
    END;

    IF EXISTS (
        SELECT 1
        FROM sys.database_role_members AS memberships
        WHERE memberships.[member_principal_id] = USER_ID(@database_login)
          AND memberships.[role_principal_id] <> DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor')
    )
    BEGIN
        SET @error_message = N'Team user has a forbidden database role: ' + QUOTENAME(@database_login) + N'.';
        THROW 51109, @error_message, 1;
    END;

    IF EXISTS (
        SELECT 1
        FROM sys.database_permissions
        WHERE [grantee_principal_id] = USER_ID(@database_login)
          AND NOT (
              [class] = 0
              AND [major_id] = 0
              AND [minor_id] = 0
              AND [permission_name] = N'CONNECT'
              AND [state] = N'G'
          )
    )
    BEGIN
        SET @error_message = N'Team user has a forbidden direct database permission: ' + QUOTENAME(@database_login) + N'.';
        THROW 51110, @error_message, 1;
    END;

    IF IS_ROLEMEMBER(N'elevant_dev_team_editor', @database_login) <> 1
    BEGIN
        SET @statement =
            N'ALTER ROLE [elevant_dev_team_editor] ADD MEMBER ' +
            QUOTENAME(@database_login) + N';';
        EXEC sys.sp_executesql @statement;
    END;

    FETCH NEXT FROM database_user_cursor INTO @database_login;
END;

CLOSE database_user_cursor;
DEALLOCATE database_user_cursor;

CREATE TABLE #team_permission_checks
(
    [check_name] nvarchar(100) NOT NULL,
    [actual_value] int NOT NULL,
    [expected_value] int NOT NULL
);

EXECUTE AS USER = N'elevant_dev_erick';
INSERT INTO #team_permission_checks VALUES
    (N'team-select-iam', COALESCE(HAS_PERMS_BY_NAME(N'iam', N'SCHEMA', N'SELECT'), 0), 1),
    (N'team-insert-ref', COALESCE(HAS_PERMS_BY_NAME(N'ref', N'SCHEMA', N'INSERT'), 0), 1),
    (N'team-update-hr', COALESCE(HAS_PERMS_BY_NAME(N'hr', N'SCHEMA', N'UPDATE'), 0), 1),
    (N'team-delete-commercial', COALESCE(HAS_PERMS_BY_NAME(N'commercial', N'SCHEMA', N'DELETE'), 0), 1),
    (N'team-insert-ops', COALESCE(HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'INSERT'), 0), 1),
    (N'team-update-integration', COALESCE(HAS_PERMS_BY_NAME(N'integration', N'SCHEMA', N'UPDATE'), 0), 1),
    (N'team-select-infra', COALESCE(HAS_PERMS_BY_NAME(N'infra', N'SCHEMA', N'SELECT'), 0), 1),
    (N'team-update-marker', COALESCE(HAS_PERMS_BY_NAME(N'infra.database_instances', N'OBJECT', N'UPDATE'), 0), 0),
    (N'team-delete-migration-history', COALESCE(HAS_PERMS_BY_NAME(N'infra.__EFMigrationsHistory', N'OBJECT', N'DELETE'), 0), 0),
    (N'team-select-audit', COALESCE(HAS_PERMS_BY_NAME(N'audit', N'SCHEMA', N'SELECT'), 0), 1),
    (N'team-insert-audit', COALESCE(HAS_PERMS_BY_NAME(N'audit', N'SCHEMA', N'INSERT'), 0), 0),
    (N'team-alter-ops', COALESCE(HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'ALTER'), 0), 0),
    (N'team-execute-ops', COALESCE(HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'EXECUTE'), 0), 0),
    (N'team-create-table', COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE TABLE'), 0), 0),
    (N'team-alter-users', COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'ALTER ANY USER'), 0), 0),
    (N'team-backup-database', COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'BACKUP DATABASE'), 0), 0),
    (N'team-view-definition', COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'VIEW DEFINITION'), 0), 1);
REVERT;

IF EXISTS (
    SELECT 1
    FROM #team_permission_checks
    WHERE [actual_value] <> [expected_value]
)
BEGIN
    SELECT [check_name], [actual_value], [expected_value]
    FROM #team_permission_checks
    WHERE [actual_value] <> [expected_value]
    ORDER BY [check_name];

    THROW 51111, 'Development team access permission verification failed.', 1;
END;

:r /opt/elevant-db-ops/sql/verify-development-team-access.sql

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;

PRINT N'PASS: Development team SQL logins and least-privilege CRUD role are ready.';
