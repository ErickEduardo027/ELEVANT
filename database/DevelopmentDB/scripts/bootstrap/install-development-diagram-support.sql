SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Compatibility contract reviewed against the SqlDiagramSupport.sql resource
-- embedded in Microsoft SQL Server Management Studio 22. The object names,
-- signatures, result shapes, return codes, ownership checks, and the
-- fn_diagramobjects bitmask value 255 intentionally track that client contract.
-- Security deviation: SSMS grants diagram procedure execution to public. ELEVANT
-- revokes public access and grants it only to elevant_dev_team_editor.

USE [ElevantDevelopmentDb];

IF OBJECT_ID(N'[infra].[database_instances]', N'U') IS NULL
    THROW 51200, 'Development database marker is missing.', 1;

IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
   OR NOT EXISTS (
       SELECT 1
       FROM [infra].[database_instances]
       WHERE [id] = 1 AND [environment_name] = N'Development'
   )
    THROW 51201, 'Refusing to install diagram support outside the exact Development database.', 1;

IF IS_MEMBER(N'db_owner') <> 1
    THROW 51202, 'Diagram support installation requires the Development DBA.', 1;

IF DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor') IS NULL
    THROW 51203, 'Provision Development team access before installing diagram support.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.schemas
    WHERE [name] = N'dbo'
      AND [principal_id] = DATABASE_PRINCIPAL_ID(N'dbo')
)
    THROW 51212, 'The dbo schema must remain owned by dbo before diagram support is installed.', 1;

DECLARE @diagram_lock_result int;
EXEC @diagram_lock_result = sys.sp_getapplock
    @Resource = N'ElevantDevelopmentDiagramSupportInstallation',
    @LockMode = N'Exclusive',
    @LockOwner = N'Session',
    @LockTimeout = 0;
IF @diagram_lock_result < 0
    THROW 51204, 'Another Development diagram-support installer is already running.', 1;

IF OBJECT_ID(N'dbo.sysdiagrams') IS NOT NULL
   AND OBJECT_ID(N'dbo.sysdiagrams', N'U') IS NULL
    THROW 51205, 'dbo.sysdiagrams exists with an unexpected object type.', 1;

-- The transaction intentionally spans the GO-separated module-definition
-- batches below. sqlcmd keeps one session; with -b, any error closes that
-- session and SQL Server rolls the uncommitted installation back.
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.sysdiagrams', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[sysdiagrams]
    (
        [name] sysname NOT NULL,
        [principal_id] int NOT NULL,
        [diagram_id] int IDENTITY(1, 1) NOT NULL,
        [version] int NULL,
        [definition] varbinary(max) NULL,
        CONSTRAINT [PK_sysdiagrams] PRIMARY KEY ([diagram_id]),
        CONSTRAINT [UK_sysdiagrams_principal_name] UNIQUE ([principal_id], [name])
    );
END;

IF EXISTS (
    SELECT required.[column_name]
    FROM (VALUES
        (N'name', N'sysname', CONVERT(smallint, 256), CONVERT(bit, 0), CONVERT(bit, 0)),
        (N'principal_id', N'int', CONVERT(smallint, 4), CONVERT(bit, 0), CONVERT(bit, 0)),
        (N'diagram_id', N'int', CONVERT(smallint, 4), CONVERT(bit, 0), CONVERT(bit, 1)),
        (N'version', N'int', CONVERT(smallint, 4), CONVERT(bit, 1), CONVERT(bit, 0)),
        (N'definition', N'varbinary', CONVERT(smallint, -1), CONVERT(bit, 1), CONVERT(bit, 0))
    ) AS required([column_name], [type_name], [max_length], [is_nullable], [is_identity])
    LEFT JOIN sys.columns AS actual
        ON actual.[object_id] = OBJECT_ID(N'dbo.sysdiagrams', N'U')
       AND actual.[name] = required.[column_name]
    LEFT JOIN sys.types AS types
        ON types.[user_type_id] = actual.[user_type_id]
    WHERE actual.[column_id] IS NULL
       OR types.[name] <> required.[type_name]
       OR actual.[max_length] <> required.[max_length]
       OR actual.[is_nullable] <> required.[is_nullable]
       OR actual.[is_identity] <> required.[is_identity]
)
    THROW 51206, 'dbo.sysdiagrams does not match the reviewed SSMS storage contract.', 1;

IF (SELECT COUNT_BIG(*) FROM sys.columns WHERE [object_id] = OBJECT_ID(N'dbo.sysdiagrams', N'U')) <> 5
    THROW 51207, 'dbo.sysdiagrams contains unexpected columns.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes AS indexes
    INNER JOIN sys.index_columns AS diagram_id_column
        ON diagram_id_column.[object_id] = indexes.[object_id]
       AND diagram_id_column.[index_id] = indexes.[index_id]
       AND diagram_id_column.[key_ordinal] = 1
    INNER JOIN sys.columns AS columns
        ON columns.[object_id] = diagram_id_column.[object_id]
       AND columns.[column_id] = diagram_id_column.[column_id]
    WHERE indexes.[object_id] = OBJECT_ID(N'dbo.sysdiagrams', N'U')
      AND indexes.[is_primary_key] = 1
      AND columns.[name] = N'diagram_id'
)
    THROW 51208, 'dbo.sysdiagrams has no reviewed diagram_id primary key.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes AS indexes
    WHERE indexes.[object_id] = OBJECT_ID(N'dbo.sysdiagrams', N'U')
      AND indexes.[is_unique] = 1
      AND INDEX_COL(N'dbo.sysdiagrams', indexes.[index_id], 1) = N'principal_id'
      AND INDEX_COL(N'dbo.sysdiagrams', indexes.[index_id], 2) = N'name'
      AND INDEX_COL(N'dbo.sysdiagrams', indexes.[index_id], 3) IS NULL
)
    THROW 51209, 'dbo.sysdiagrams has no reviewed owner/name uniqueness constraint.', 1;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_upgraddiagrams]
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID(N'dbo.sysdiagrams', N'U') IS NULL
        THROW 51210, 'dbo.sysdiagrams is missing.', 1;

    RETURN 0;
END;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_helpdiagrams]
    @diagramname sysname = NULL,
    @owner_id int = NULL
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @caller_id int;
    DECLARE @is_dbo bit;

    EXECUTE AS CALLER;
    SELECT
        @caller_id = DATABASE_PRINCIPAL_ID(),
        @is_dbo = CONVERT(bit, IS_MEMBER(N'db_owner'));
    REVERT;

    SELECT
        [Database] = DB_NAME(),
        [Name] = diagrams.[name],
        [ID] = diagrams.[diagram_id],
        [Owner] = USER_NAME(diagrams.[principal_id]),
        [OwnerID] = diagrams.[principal_id]
    FROM [dbo].[sysdiagrams] AS diagrams
    WHERE (@is_dbo = 1 OR diagrams.[principal_id] = @caller_id)
      AND (@diagramname IS NULL OR diagrams.[name] = @diagramname)
      AND (@owner_id IS NULL OR diagrams.[principal_id] = @owner_id)
    ORDER BY [Owner], [OwnerID], [Name];

    RETURN 0;
END;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_helpdiagramdefinition]
    @diagramname sysname,
    @owner_id int = NULL
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    IF @diagramname IS NULL
    BEGIN
        RAISERROR(N'E_INVALIDARG', 16, 1);
        RETURN -1;
    END;

    DECLARE @caller_id int;
    DECLARE @is_dbo bit;
    EXECUTE AS CALLER;
    SELECT
        @caller_id = DATABASE_PRINCIPAL_ID(),
        @is_dbo = CONVERT(bit, IS_MEMBER(N'db_owner'));
    REVERT;

    SET @owner_id = COALESCE(@owner_id, @caller_id);

    IF @is_dbo = 0 AND @owner_id <> @caller_id
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM [dbo].[sysdiagrams]
        WHERE [principal_id] = @owner_id AND [name] = @diagramname
    )
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    SELECT [version], [definition]
    FROM [dbo].[sysdiagrams]
    WHERE [principal_id] = @owner_id AND [name] = @diagramname;

    RETURN 0;
END;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_creatediagram]
    @diagramname sysname,
    @owner_id int = NULL,
    @version int,
    @definition varbinary(max)
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    IF @diagramname IS NULL OR @version IS NULL
    BEGIN
        RAISERROR(N'E_INVALIDARG', 16, 1);
        RETURN -1;
    END;

    DECLARE @caller_id int;
    DECLARE @is_dbo bit;
    EXECUTE AS CALLER;
    SELECT
        @caller_id = DATABASE_PRINCIPAL_ID(),
        @is_dbo = CONVERT(bit, IS_MEMBER(N'db_owner'));
    REVERT;

    SET @owner_id = COALESCE(@owner_id, @caller_id);

    IF @is_dbo = 0 AND @owner_id <> @caller_id
    BEGIN
        RAISERROR(N'E_INVALIDARG', 16, 1);
        RETURN -1;
    END;

    IF EXISTS (
        SELECT 1
        FROM [dbo].[sysdiagrams]
        WHERE [principal_id] = @owner_id AND [name] = @diagramname
    )
    BEGIN
        RAISERROR(N'The name is already used.', 16, 1);
        RETURN -2;
    END;

    INSERT INTO [dbo].[sysdiagrams] ([name], [principal_id], [version], [definition])
    VALUES (@diagramname, @owner_id, @version, @definition);

    RETURN CONVERT(int, SCOPE_IDENTITY());
END;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_renamediagram]
    @diagramname sysname,
    @owner_id int = NULL,
    @new_diagramname sysname
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    IF @diagramname IS NULL OR @new_diagramname IS NULL
    BEGIN
        RAISERROR(N'Invalid value', 16, 1);
        RETURN -1;
    END;

    DECLARE @caller_id int;
    DECLARE @is_dbo bit;
    EXECUTE AS CALLER;
    SELECT
        @caller_id = DATABASE_PRINCIPAL_ID(),
        @is_dbo = CONVERT(bit, IS_MEMBER(N'db_owner'));
    REVERT;

    SET @owner_id = COALESCE(@owner_id, @caller_id);

    IF @is_dbo = 0 AND @owner_id <> @caller_id
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM [dbo].[sysdiagrams]
        WHERE [principal_id] = @owner_id AND [name] = @diagramname
    )
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    IF EXISTS (
        SELECT 1
        FROM [dbo].[sysdiagrams]
        WHERE [principal_id] = @owner_id
          AND [name] = @new_diagramname
          AND [name] <> @diagramname
    )
    BEGIN
        RAISERROR(N'The name is already used.', 16, 1);
        RETURN -2;
    END;

    UPDATE [dbo].[sysdiagrams]
    SET [name] = @new_diagramname
    WHERE [principal_id] = @owner_id AND [name] = @diagramname;

    RETURN 0;
END;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_alterdiagram]
    @diagramname sysname,
    @owner_id int = NULL,
    @version int,
    @definition varbinary(max)
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    IF @diagramname IS NULL
    BEGIN
        RAISERROR(N'Invalid argument', 16, 1);
        RETURN -1;
    END;

    DECLARE @caller_id int;
    DECLARE @is_dbo bit;
    EXECUTE AS CALLER;
    SELECT
        @caller_id = DATABASE_PRINCIPAL_ID(),
        @is_dbo = CONVERT(bit, IS_MEMBER(N'db_owner'));
    REVERT;

    SET @owner_id = COALESCE(@owner_id, @caller_id);

    IF @is_dbo = 0 AND @owner_id <> @caller_id
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM [dbo].[sysdiagrams]
        WHERE [principal_id] = @owner_id AND [name] = @diagramname
    )
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    UPDATE [dbo].[sysdiagrams]
    SET [version] = COALESCE(@version, [version]),
        [definition] = @definition
    WHERE [principal_id] = @owner_id AND [name] = @diagramname;

    RETURN 0;
END;

GO

CREATE OR ALTER PROCEDURE [dbo].[sp_dropdiagram]
    @diagramname sysname,
    @owner_id int = NULL
WITH EXECUTE AS N'dbo'
AS
BEGIN
    SET NOCOUNT ON;

    IF @diagramname IS NULL
    BEGIN
        RAISERROR(N'Invalid value', 16, 1);
        RETURN -1;
    END;

    DECLARE @caller_id int;
    DECLARE @is_dbo bit;
    EXECUTE AS CALLER;
    SELECT
        @caller_id = DATABASE_PRINCIPAL_ID(),
        @is_dbo = CONVERT(bit, IS_MEMBER(N'db_owner'));
    REVERT;

    SET @owner_id = COALESCE(@owner_id, @caller_id);

    IF @is_dbo = 0 AND @owner_id <> @caller_id
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    DELETE FROM [dbo].[sysdiagrams]
    WHERE [principal_id] = @owner_id AND [name] = @diagramname;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR(N'Diagram does not exist or you do not have permission.', 16, 1);
        RETURN -3;
    END;

    RETURN 0;
END;

GO

CREATE OR ALTER FUNCTION [dbo].[fn_diagramobjects]()
RETURNS int
WITH EXECUTE AS N'dbo'
AS
BEGIN
    DECLARE @installed_objects int = 0;

    IF OBJECT_ID(N'dbo.sp_upgraddiagrams', N'P') IS NOT NULL SET @installed_objects += 1;
    IF OBJECT_ID(N'dbo.sysdiagrams', N'U') IS NOT NULL SET @installed_objects += 2;
    IF OBJECT_ID(N'dbo.sp_helpdiagrams', N'P') IS NOT NULL SET @installed_objects += 4;
    IF OBJECT_ID(N'dbo.sp_helpdiagramdefinition', N'P') IS NOT NULL SET @installed_objects += 8;
    IF OBJECT_ID(N'dbo.sp_creatediagram', N'P') IS NOT NULL SET @installed_objects += 16;
    IF OBJECT_ID(N'dbo.sp_renamediagram', N'P') IS NOT NULL SET @installed_objects += 32;
    IF OBJECT_ID(N'dbo.sp_alterdiagram', N'P') IS NOT NULL SET @installed_objects += 64;
    IF OBJECT_ID(N'dbo.sp_dropdiagram', N'P') IS NOT NULL SET @installed_objects += 128;

    RETURN @installed_objects;
END;

GO

DECLARE @diagram_objects table
(
    [object_name] sysname NOT NULL PRIMARY KEY,
    [object_type] varchar(10) NOT NULL
);

INSERT INTO @diagram_objects ([object_name], [object_type])
VALUES
    (N'sysdiagrams', 'TABLE'),
    (N'sp_upgraddiagrams', 'PROCEDURE'),
    (N'sp_helpdiagrams', 'PROCEDURE'),
    (N'sp_helpdiagramdefinition', 'PROCEDURE'),
    (N'sp_creatediagram', 'PROCEDURE'),
    (N'sp_renamediagram', 'PROCEDURE'),
    (N'sp_alterdiagram', 'PROCEDURE'),
    (N'sp_dropdiagram', 'PROCEDURE'),
    (N'fn_diagramobjects', 'FUNCTION');

DECLARE @object_name sysname;
DECLARE @object_type varchar(10);
DECLARE @authorization_statement nvarchar(max);
DECLARE diagram_object_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT [object_name], [object_type]
    FROM @diagram_objects
    ORDER BY [object_name];

OPEN diagram_object_cursor;
FETCH NEXT FROM diagram_object_cursor INTO @object_name, @object_type;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- CREATE OR ALTER preserves an explicit object owner. Normalize every
    -- adopted SSMS object back to schema ownership so no former owner can
    -- rewrite a module that executes as dbo.
    IF EXISTS (
        SELECT 1
        FROM sys.objects
        WHERE [object_id] = OBJECT_ID(QUOTENAME(N'dbo') + N'.' + QUOTENAME(@object_name))
          AND [principal_id] IS NOT NULL
    )
    BEGIN
        SET @authorization_statement =
            N'ALTER AUTHORIZATION ON OBJECT::[dbo].' + QUOTENAME(@object_name) +
            N' TO SCHEMA OWNER;';
        EXEC sys.sp_executesql @authorization_statement;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.extended_properties
        WHERE [class] = 1
          AND [major_id] = OBJECT_ID(QUOTENAME(N'dbo') + N'.' + QUOTENAME(@object_name))
          AND [minor_id] = 0
          AND [name] = N'microsoft_database_tools_support'
    )
    BEGIN
        EXEC sys.sp_addextendedproperty
            @name = N'microsoft_database_tools_support',
            @value = 1,
            @level0type = N'SCHEMA',
            @level0name = N'dbo',
            @level1type = @object_type,
            @level1name = @object_name;
    END;

    FETCH NEXT FROM diagram_object_cursor INTO @object_name, @object_type;
END;

CLOSE diagram_object_cursor;
DEALLOCATE diagram_object_cursor;

-- SSMS 22 uses sp_upgraddiagrams only while a DBA installs or upgrades the
-- support objects. Editors never need it, and it deliberately remains denied.
REVOKE EXECUTE ON OBJECT::[dbo].[sp_upgraddiagrams] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_helpdiagrams] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_helpdiagramdefinition] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_creatediagram] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_renamediagram] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_alterdiagram] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_dropdiagram] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[fn_diagramobjects] FROM [public];

DENY EXECUTE ON OBJECT::[dbo].[sp_upgraddiagrams] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[sp_helpdiagrams] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[sp_helpdiagramdefinition] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[sp_creatediagram] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[sp_renamediagram] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[sp_alterdiagram] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[sp_dropdiagram] TO [guest];
DENY EXECUTE ON OBJECT::[dbo].[fn_diagramobjects] TO [guest];

DENY EXECUTE ON OBJECT::[dbo].[sp_upgraddiagrams] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[sp_helpdiagrams] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[sp_helpdiagramdefinition] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[sp_creatediagram] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[sp_renamediagram] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[sp_alterdiagram] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[sp_dropdiagram] TO [elevant_dev_team_editor];
GRANT EXECUTE ON OBJECT::[dbo].[fn_diagramobjects] TO [elevant_dev_team_editor];

DENY SELECT, INSERT, UPDATE, DELETE, ALTER, REFERENCES
    ON OBJECT::[dbo].[sysdiagrams] TO [elevant_dev_team_editor];

IF [dbo].[fn_diagramobjects]() <> 255
    THROW 51211, 'The reviewed SSMS diagram object set is incomplete.', 1;

:r /opt/elevant-db-ops/sql/verify-development-team-access.sql

COMMIT TRANSACTION;

PRINT N'PASS: controlled Development SSMS diagram support is installed.';
