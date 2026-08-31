-- Manual bootstrap for a new Production SQL Server instance.
-- Run with sqlcmd -b -v CONFIRM_PRODUCTION_DATABASE=ElevantProductionDb.
-- It creates only the physical database and its immutable environment marker;
-- EF migrations create the application schema and never seed business data.

SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];

IF N'$(CONFIRM_PRODUCTION_DATABASE)' <> N'ElevantProductionDb'
    THROW 51010, 'Production bootstrap requires CONFIRM_PRODUCTION_DATABASE=ElevantProductionDb.', 1;

IF DB_ID(N'ElevantProductionDb') IS NOT NULL
BEGIN
    IF OBJECT_ID(N'[ElevantProductionDb].[infra].[database_instances]', N'U') IS NULL
        THROW 51011, 'Existing ElevantProductionDb has no environment marker; refusing to adopt it.', 1;

    DECLARE @existing_environment nvarchar(32);
    EXEC sys.sp_executesql
        N'SELECT @value = [environment_name]
          FROM [ElevantProductionDb].[infra].[database_instances]
          WHERE [id] = 1
            AND (SELECT COUNT_BIG(*) FROM [ElevantProductionDb].[infra].[database_instances]) = 1;',
        N'@value nvarchar(32) OUTPUT',
        @value = @existing_environment OUTPUT;

    IF @existing_environment IS NULL OR @existing_environment <> N'Production'
        THROW 51012, 'Existing database marker is not Production.', 1;

    PRINT N'ElevantProductionDb already exists with a valid Production marker.';
    RETURN;
END;

EXEC(N'CREATE DATABASE [ElevantProductionDb]');

ALTER DATABASE [ElevantProductionDb] SET COMPATIBILITY_LEVEL = 160;
ALTER DATABASE [ElevantProductionDb] SET PAGE_VERIFY CHECKSUM;
ALTER DATABASE [ElevantProductionDb] SET AUTO_CLOSE OFF;
ALTER DATABASE [ElevantProductionDb] SET AUTO_SHRINK OFF;
ALTER DATABASE [ElevantProductionDb] SET QUERY_STORE = ON;
ALTER DATABASE [ElevantProductionDb] SET QUERY_STORE (OPERATION_MODE = READ_WRITE);

DECLARE @data_file sysname = (
    SELECT TOP (1) [name]
    FROM sys.master_files
    WHERE [database_id] = DB_ID(N'ElevantProductionDb') AND [type] = 0
    ORDER BY [file_id]
);
DECLARE @log_file sysname = (
    SELECT TOP (1) [name]
    FROM sys.master_files
    WHERE [database_id] = DB_ID(N'ElevantProductionDb') AND [type] = 1
    ORDER BY [file_id]
);
DECLARE @growth_sql nvarchar(max) =
    N'ALTER DATABASE [ElevantProductionDb] MODIFY FILE (NAME = ' + QUOTENAME(@data_file, '''') + N', FILEGROWTH = 256MB);' +
    N'ALTER DATABASE [ElevantProductionDb] MODIFY FILE (NAME = ' + QUOTENAME(@log_file, '''') + N', FILEGROWTH = 128MB);';
EXEC sys.sp_executesql @growth_sql;

GO

USE [ElevantProductionDb];

IF SCHEMA_ID(N'infra') IS NULL
    EXEC(N'CREATE SCHEMA [infra] AUTHORIZATION [dbo]');

IF OBJECT_ID(N'[infra].[database_instances]', N'U') IS NULL
BEGIN
    EXEC(N'
CREATE TABLE [infra].[database_instances]
(
    [id] tinyint NOT NULL CONSTRAINT [pk_database_instances] PRIMARY KEY,
    [instance_id] uniqueidentifier NOT NULL,
    [environment_name] nvarchar(32) NOT NULL,
    [created_at] datetimeoffset(3) NOT NULL,
    CONSTRAINT [ck_database_instances_singleton] CHECK ([id] = 1),
    CONSTRAINT [ck_database_instances_environment] CHECK ([environment_name] IN (N''Development'', N''Production''))
);

INSERT INTO [infra].[database_instances] ([id], [instance_id], [environment_name], [created_at])
VALUES (1, NEWID(), N''Production'', SYSUTCDATETIME());');
END;

IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
    THROW 51013, 'Production database marker must be a singleton.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM [infra].[database_instances]
    WHERE [id] = 1
      AND [environment_name] = N'Production'
)
    THROW 51014, 'Production database marker is not Production.', 1;

PRINT N'ElevantProductionDb bootstrap completed. Apply the reviewed EF migration bundle next.';
