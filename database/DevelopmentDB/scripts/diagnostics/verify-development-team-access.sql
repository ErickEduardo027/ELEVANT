SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [ElevantDevelopmentDb];

IF OBJECT_ID(N'[infra].[database_instances]', N'U') IS NULL
   OR (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
   OR NOT EXISTS (
       SELECT 1
       FROM [infra].[database_instances]
       WHERE [id] = 1 AND [environment_name] = N'Development'
   )
    THROW 51300, 'Team access verification requires the exact Development database.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE [name] = N'elevant_dev_team_editor'
      AND [type] = N'R'
      AND [is_fixed_role] = 0
      AND [owning_principal_id] = DATABASE_PRINCIPAL_ID(N'dbo')
)
    THROW 51301, 'The Development team editor principal is not an exact dbo-owned custom role.', 1;

DECLARE @expected_team_members table
(
    [principal_name] sysname COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY
);

INSERT INTO @expected_team_members ([principal_name])
VALUES
    (N'elevant_dev_erick'),
    (N'elevant_dev_eliezer'),
    (N'elevant_dev_laisha');

IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    LEFT JOIN master.sys.sql_logins AS actual
        ON actual.[name] COLLATE Latin1_General_100_BIN2 = expected.[principal_name]
    WHERE actual.[principal_id] IS NULL
       OR actual.[is_policy_checked] <> 1
       OR actual.[is_expiration_checked] <> 0
       OR actual.[default_database_name] <> N'ElevantDevelopmentDb'
       OR actual.[credential_id] IS NOT NULL
)
    THROW 51302, 'A fixed Development team SQL login is missing or has invalid policy.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN master.sys.server_role_members AS memberships
        ON memberships.[member_principal_id] = SUSER_ID(expected.[principal_name])
)
    THROW 51303, 'A Development team login has a forbidden fixed server role.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN master.sys.server_permissions AS permissions
        ON permissions.[grantee_principal_id] = SUSER_ID(expected.[principal_name])
    WHERE NOT (
        permissions.[class] = 100
        AND permissions.[permission_name] = N'CONNECT SQL'
        AND permissions.[state] = N'G'
    )
)
    THROW 51304, 'A Development team login has a forbidden direct server permission.', 1;

-- SQL Server can hide a user-defined server role from a principal that has
-- ALTER ANY LOGIN but not ALTER ANY SERVER ROLE. This read-only check covers
-- every visible owner. The provisioning transaction additionally attempts the
-- login replacement and translates native DROP LOGIN error 15141, so hidden
-- role ownership still fails closed whenever access is reconciled.
IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN master.sys.databases AS databases
        ON databases.[owner_sid] = SUSER_SID(expected.[principal_name])
)
OR EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN master.sys.server_principals AS owned_principals
        ON owned_principals.[owning_principal_id] = SUSER_ID(expected.[principal_name])
)
OR EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN master.sys.endpoints AS endpoints
        ON endpoints.[principal_id] = SUSER_ID(expected.[principal_name])
)
    THROW 51316, 'A Development team login owns a forbidden server securable.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    LEFT JOIN sys.database_principals AS users
        ON users.[name] COLLATE Latin1_General_100_BIN2 = expected.[principal_name]
    LEFT JOIN master.sys.server_principals AS logins
        ON logins.[name] COLLATE Latin1_General_100_BIN2 = expected.[principal_name]
    WHERE users.[principal_id] IS NULL
       OR users.[sid] <> logins.[sid]
)
    THROW 51305, 'A Development team database user is missing or orphaned.', 1;

IF EXISTS (
    SELECT members.[name] COLLATE Latin1_General_100_BIN2
    FROM sys.database_role_members AS memberships
    INNER JOIN sys.database_principals AS roles
        ON roles.[principal_id] = memberships.[role_principal_id]
    INNER JOIN sys.database_principals AS members
        ON members.[principal_id] = memberships.[member_principal_id]
    WHERE roles.[name] = N'elevant_dev_team_editor'
    EXCEPT
    SELECT [principal_name] COLLATE Latin1_General_100_BIN2
    FROM @expected_team_members
)
OR EXISTS (
    SELECT [principal_name] COLLATE Latin1_General_100_BIN2
    FROM @expected_team_members
    EXCEPT
    SELECT members.[name] COLLATE Latin1_General_100_BIN2
    FROM sys.database_role_members AS memberships
    INNER JOIN sys.database_principals AS roles
        ON roles.[principal_id] = memberships.[role_principal_id]
    INNER JOIN sys.database_principals AS members
        ON members.[principal_id] = memberships.[member_principal_id]
    WHERE roles.[name] = N'elevant_dev_team_editor'
)
    THROW 51306, 'The Development team editor role membership is not exact.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.database_role_members AS memberships
    WHERE memberships.[member_principal_id] = DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor')
)
    THROW 51307, 'The Development team editor role inherits another database role.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN sys.database_role_members AS memberships
        ON memberships.[member_principal_id] = USER_ID(expected.[principal_name])
    INNER JOIN sys.database_principals AS roles
        ON roles.[principal_id] = memberships.[role_principal_id]
    WHERE roles.[name] <> N'elevant_dev_team_editor'
)
    THROW 51308, 'A Development team user has an unexpected database role.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_team_members AS expected
    INNER JOIN sys.database_permissions AS permissions
        ON permissions.[grantee_principal_id] = USER_ID(expected.[principal_name])
    WHERE NOT (
        permissions.[class] = 0
        AND permissions.[major_id] = 0
        AND permissions.[minor_id] = 0
        AND permissions.[permission_name] = N'CONNECT'
        AND permissions.[state] = N'G'
    )
)
    THROW 51309, 'A Development team user has a forbidden direct database permission.', 1;

-- Schema-level CRUD intentionally covers present and future EF tables. Other
-- object kinds can extend that grant through ownership chains, implicit trigger
-- execution, or mutable sequence state, so they require a separate reviewed
-- permission decision before they may exist in a CRUD schema.
IF EXISTS (
    SELECT 1
    FROM sys.objects AS objects
    INNER JOIN sys.schemas AS schemas
        ON schemas.[schema_id] = objects.[schema_id]
    WHERE schemas.[name] IN (
        N'iam', N'ref', N'hr', N'commercial', N'ops', N'integration'
    )
      AND objects.[type] IN (
          N'V', N'SN', N'FN', N'IF', N'TF', N'FS', N'FT', N'AF',
          N'SO', N'TR', N'TA', N'ET'
      )
)
    THROW 51315, 'A CRUD schema contains a non-table executable or mutable object without an explicit access decision.', 1;

-- A cascading FK whose referenced table is editable can otherwise turn an
-- allowed UPDATE or DELETE into an implicit write in a protected schema.
IF EXISTS (
    SELECT 1
    FROM sys.foreign_keys AS foreign_keys
    INNER JOIN sys.tables AS protected_tables
        ON protected_tables.[object_id] = foreign_keys.[parent_object_id]
    INNER JOIN sys.schemas AS protected_schemas
        ON protected_schemas.[schema_id] = protected_tables.[schema_id]
    INNER JOIN sys.tables AS editable_tables
        ON editable_tables.[object_id] = foreign_keys.[referenced_object_id]
    INNER JOIN sys.schemas AS editable_schemas
        ON editable_schemas.[schema_id] = editable_tables.[schema_id]
    WHERE protected_schemas.[name] IN (N'infra', N'audit')
      AND editable_schemas.[name] IN (
          N'iam', N'ref', N'hr', N'commercial', N'ops', N'integration'
      )
      AND (
          foreign_keys.[delete_referential_action] <> 0
          OR foreign_keys.[update_referential_action] <> 0
      )
)
    THROW 51320, 'A cascading foreign key permits an editable table to mutate a protected schema.', 1;

-- System-versioned and updatable-ledger tables write history implicitly. An
-- editable current table must never send that history to a protected schema.
IF EXISTS (
    SELECT 1
    FROM sys.tables AS editable_tables
    INNER JOIN sys.schemas AS editable_schemas
        ON editable_schemas.[schema_id] = editable_tables.[schema_id]
    INNER JOIN sys.tables AS history_tables
        ON history_tables.[object_id] = editable_tables.[history_table_id]
    INNER JOIN sys.schemas AS history_schemas
        ON history_schemas.[schema_id] = history_tables.[schema_id]
    WHERE editable_schemas.[name] IN (
        N'iam', N'ref', N'hr', N'commercial', N'ops', N'integration'
    )
      AND history_schemas.[name] IN (N'infra', N'audit')
      AND editable_tables.[history_table_id] <> 0
      AND (
          editable_tables.[temporal_type] = 2
          OR editable_tables.[ledger_type] = 2
      )
)
    THROW 51323, 'An editable temporal or ledger table writes history into a protected schema.', 1;

DECLARE @team_database_principals table
(
    [principal_id] int NOT NULL PRIMARY KEY
);

INSERT INTO @team_database_principals ([principal_id])
SELECT DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor')
UNION ALL
SELECT USER_ID([principal_name])
FROM @expected_team_members;

IF EXISTS (
    SELECT 1
    FROM sys.schemas
    WHERE [principal_id] IN (SELECT [principal_id] FROM @team_database_principals)
)
OR EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE [principal_id] IN (SELECT [principal_id] FROM @team_database_principals)
)
OR EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE [owning_principal_id] IN (SELECT [principal_id] FROM @team_database_principals)
)
OR EXISTS (
    SELECT 1
    FROM (
        SELECT [principal_id] FROM sys.assemblies
        UNION ALL SELECT [principal_id] FROM sys.asymmetric_keys
        UNION ALL SELECT [principal_id] FROM sys.certificates
        UNION ALL SELECT [principal_id] FROM sys.symmetric_keys
        UNION ALL SELECT [principal_id] FROM sys.database_scoped_credentials
        UNION ALL SELECT [principal_id] FROM sys.fulltext_catalogs
        UNION ALL SELECT [principal_id] FROM sys.fulltext_stoplists
        UNION ALL SELECT [principal_id] FROM sys.registered_search_property_lists
        UNION ALL SELECT [principal_id] FROM sys.service_message_types
        UNION ALL SELECT [principal_id] FROM sys.service_contracts
        UNION ALL SELECT [principal_id] FROM sys.services
        UNION ALL SELECT [principal_id] FROM sys.routes
        UNION ALL SELECT [principal_id] FROM sys.remote_service_bindings
        UNION ALL SELECT [principal_id] FROM sys.types
        UNION ALL SELECT [principal_id] FROM sys.xml_schema_collections
        UNION ALL SELECT [principal_id] FROM sys.external_languages
        UNION ALL SELECT [principal_id] FROM sys.external_libraries
    ) AS owned_securables
    WHERE owned_securables.[principal_id] IN (
        SELECT [principal_id]
        FROM @team_database_principals
    )
)
    THROW 51310, 'A Development team principal unexpectedly owns a securable.', 1;

DECLARE @expected_permissions table
(
    [class] tinyint NOT NULL,
    [major_id] int NOT NULL,
    [minor_id] int NOT NULL,
    [permission_name] nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [state] char(1) COLLATE Latin1_General_100_BIN2 NOT NULL,
    PRIMARY KEY ([class], [major_id], [minor_id], [permission_name])
);

INSERT INTO @expected_permissions ([class], [major_id], [minor_id], [permission_name], [state])
VALUES
    (0, 0, 0, N'VIEW DEFINITION', N'G'),
    (0, 0, 0, N'CREATE TABLE', N'D'),
    (0, 0, 0, N'CREATE VIEW', N'D'),
    (0, 0, 0, N'CREATE PROCEDURE', N'D'),
    (0, 0, 0, N'CREATE FUNCTION', N'D'),
    (0, 0, 0, N'CREATE TYPE', N'D'),
    (0, 0, 0, N'CREATE SCHEMA', N'D'),
    (0, 0, 0, N'CREATE SYNONYM', N'D'),
    (0, 0, 0, N'CREATE ASSEMBLY', N'D'),
    (0, 0, 0, N'ALTER ANY SCHEMA', N'D'),
    (0, 0, 0, N'ALTER ANY USER', N'D'),
    (0, 0, 0, N'ALTER ANY ROLE', N'D'),
    (0, 0, 0, N'ALTER ANY APPLICATION ROLE', N'D'),
    (0, 0, 0, N'ALTER ANY DATABASE SCOPED CONFIGURATION', N'D'),
    (0, 0, 0, N'BACKUP DATABASE', N'D'),
    (0, 0, 0, N'BACKUP LOG', N'D');

INSERT INTO @expected_permissions ([class], [major_id], [minor_id], [permission_name], [state])
SELECT
    3,
    SCHEMA_ID(schemas.[schema_name]),
    0,
    permissions.[permission_name],
    permissions.[state]
FROM (VALUES
    (N'iam'),
    (N'ref'),
    (N'hr'),
    (N'commercial'),
    (N'ops'),
    (N'integration')
) AS schemas([schema_name])
CROSS JOIN (VALUES
    (N'SELECT', N'G'),
    (N'INSERT', N'G'),
    (N'UPDATE', N'G'),
    (N'DELETE', N'G'),
    (N'ALTER', N'D'),
    (N'EXECUTE', N'D'),
    (N'REFERENCES', N'D'),
    (N'TAKE OWNERSHIP', N'D')
) AS permissions([permission_name], [state]);

INSERT INTO @expected_permissions ([class], [major_id], [minor_id], [permission_name], [state])
SELECT
    3,
    SCHEMA_ID(schemas.[schema_name]),
    0,
    permissions.[permission_name],
    permissions.[state]
FROM (VALUES (N'infra'), (N'audit')) AS schemas([schema_name])
CROSS JOIN (VALUES
    (N'SELECT', N'G'),
    (N'INSERT', N'D'),
    (N'UPDATE', N'D'),
    (N'DELETE', N'D'),
    (N'ALTER', N'D'),
    (N'EXECUTE', N'D'),
    (N'REFERENCES', N'D'),
    (N'TAKE OWNERSHIP', N'D')
) AS permissions([permission_name], [state]);

DECLARE @diagram_object_count int = (
    SELECT COUNT(*)
    FROM (VALUES
        (N'sysdiagrams', N'U'),
        (N'sp_upgraddiagrams', N'P'),
        (N'sp_helpdiagrams', N'P'),
        (N'sp_helpdiagramdefinition', N'P'),
        (N'sp_creatediagram', N'P'),
        (N'sp_renamediagram', N'P'),
        (N'sp_alterdiagram', N'P'),
        (N'sp_dropdiagram', N'P'),
        (N'fn_diagramobjects', N'FN')
    ) AS expected([object_name], [object_type])
    WHERE OBJECT_ID(N'dbo.' + expected.[object_name], expected.[object_type]) IS NOT NULL
);

IF @diagram_object_count NOT IN (0, 9)
    THROW 51311, 'The controlled SSMS diagram object set is partial.', 1;

IF @diagram_object_count = 9
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sys.schemas
        WHERE [name] = N'dbo'
          AND [principal_id] = DATABASE_PRINCIPAL_ID(N'dbo')
    )
        THROW 51314, 'The dbo schema owner is invalid for controlled diagram execution.', 1;

    IF EXISTS (
        SELECT 1
        FROM sys.objects
        WHERE [object_id] IN (
            OBJECT_ID(N'dbo.sysdiagrams'),
            OBJECT_ID(N'dbo.sp_upgraddiagrams'),
            OBJECT_ID(N'dbo.sp_helpdiagrams'),
            OBJECT_ID(N'dbo.sp_helpdiagramdefinition'),
            OBJECT_ID(N'dbo.sp_creatediagram'),
            OBJECT_ID(N'dbo.sp_renamediagram'),
            OBJECT_ID(N'dbo.sp_alterdiagram'),
            OBJECT_ID(N'dbo.sp_dropdiagram'),
            OBJECT_ID(N'dbo.fn_diagramobjects')
        )
          AND [principal_id] IS NOT NULL
    )
        THROW 51322, 'A controlled SSMS diagram object is not owned through the dbo schema.', 1;

    IF [dbo].[fn_diagramobjects]() <> 255
        THROW 51312, 'The controlled SSMS diagram object mask is invalid.', 1;

    IF EXISTS (
        SELECT 1
        FROM sys.database_permissions AS permissions
        INNER JOIN sys.database_principals AS grantees
            ON grantees.[principal_id] = permissions.[grantee_principal_id]
        WHERE permissions.[class] = 1
          AND permissions.[major_id] IN (
              OBJECT_ID(N'dbo.sysdiagrams'),
              OBJECT_ID(N'dbo.sp_upgraddiagrams'),
              OBJECT_ID(N'dbo.sp_helpdiagrams'),
              OBJECT_ID(N'dbo.sp_helpdiagramdefinition'),
              OBJECT_ID(N'dbo.sp_creatediagram'),
              OBJECT_ID(N'dbo.sp_renamediagram'),
              OBJECT_ID(N'dbo.sp_alterdiagram'),
              OBJECT_ID(N'dbo.sp_dropdiagram'),
              OBJECT_ID(N'dbo.fn_diagramobjects')
          )
          AND permissions.[state] IN (N'G', N'W')
          AND grantees.[name] <> N'elevant_dev_team_editor'
    )
        THROW 51321, 'A controlled SSMS diagram object has an unexpected positive permission for another principal.', 1;

    IF EXISTS (
        SELECT expected.[object_name]
        FROM (VALUES
            (N'sp_upgraddiagrams'),
            (N'sp_helpdiagrams'),
            (N'sp_helpdiagramdefinition'),
            (N'sp_creatediagram'),
            (N'sp_renamediagram'),
            (N'sp_alterdiagram'),
            (N'sp_dropdiagram'),
            (N'fn_diagramobjects')
        ) AS expected([object_name])
        LEFT JOIN sys.sql_modules AS modules
            ON modules.[object_id] = OBJECT_ID(N'dbo.' + expected.[object_name])
        WHERE modules.[object_id] IS NULL
           OR modules.[execute_as_principal_id] <> DATABASE_PRINCIPAL_ID(N'dbo')
    )
        THROW 51319, 'A controlled SSMS diagram module does not execute explicitly as dbo.', 1;

    INSERT INTO @expected_permissions ([class], [major_id], [minor_id], [permission_name], [state])
    SELECT
        1,
        OBJECT_ID(N'dbo.' + procedures.[object_name]),
        0,
        N'EXECUTE',
        N'G'
    FROM (VALUES
        (N'sp_helpdiagrams'),
        (N'sp_helpdiagramdefinition'),
        (N'sp_creatediagram'),
        (N'sp_renamediagram'),
        (N'sp_alterdiagram'),
        (N'sp_dropdiagram'),
        (N'fn_diagramobjects')
    ) AS procedures([object_name]);

    INSERT INTO @expected_permissions ([class], [major_id], [minor_id], [permission_name], [state])
    VALUES (
        1,
        OBJECT_ID(N'dbo.sp_upgraddiagrams'),
        0,
        N'EXECUTE',
        N'D'
    );

    INSERT INTO @expected_permissions ([class], [major_id], [minor_id], [permission_name], [state])
    SELECT
        1,
        OBJECT_ID(N'dbo.sysdiagrams'),
        0,
        permissions.[permission_name],
        N'D'
    FROM (VALUES
        (N'SELECT'),
        (N'INSERT'),
        (N'UPDATE'),
        (N'DELETE'),
        (N'ALTER'),
        (N'REFERENCES')
    ) AS permissions([permission_name]);
END;

IF EXISTS (
    SELECT
        permissions.[class],
        permissions.[major_id],
        permissions.[minor_id],
        permissions.[permission_name] COLLATE Latin1_General_100_BIN2,
        permissions.[state] COLLATE Latin1_General_100_BIN2
    FROM sys.database_permissions AS permissions
    WHERE permissions.[grantee_principal_id] = DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor')
    EXCEPT
    SELECT
        [class],
        [major_id],
        [minor_id],
        [permission_name] COLLATE Latin1_General_100_BIN2,
        [state] COLLATE Latin1_General_100_BIN2
    FROM @expected_permissions
)
OR EXISTS (
    SELECT
        [class],
        [major_id],
        [minor_id],
        [permission_name] COLLATE Latin1_General_100_BIN2,
        [state] COLLATE Latin1_General_100_BIN2
    FROM @expected_permissions
    EXCEPT
    SELECT
        permissions.[class],
        permissions.[major_id],
        permissions.[minor_id],
        permissions.[permission_name] COLLATE Latin1_General_100_BIN2,
        permissions.[state] COLLATE Latin1_General_100_BIN2
    FROM sys.database_permissions AS permissions
    WHERE permissions.[grantee_principal_id] = DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor')
)
    THROW 51313, 'The Development team editor role permission set is not exact.', 1;

PRINT N'PASS: Development team access memberships, ownership, and permissions are exact.';
