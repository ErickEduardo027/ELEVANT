SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];

IF DB_ID(N'ElevantDevelopmentDb') IS NULL
BEGIN
    CREATE DATABASE [ElevantDevelopmentDb];
END;

ALTER DATABASE [ElevantDevelopmentDb] SET COMPATIBILITY_LEVEL = 160;
ALTER DATABASE [ElevantDevelopmentDb] SET RECOVERY SIMPLE;
ALTER DATABASE [ElevantDevelopmentDb] SET PAGE_VERIFY CHECKSUM;
ALTER DATABASE [ElevantDevelopmentDb] SET AUTO_CLOSE OFF;
ALTER DATABASE [ElevantDevelopmentDb] SET AUTO_SHRINK OFF;
ALTER DATABASE [ElevantDevelopmentDb] SET QUERY_STORE = ON;
ALTER DATABASE [ElevantDevelopmentDb] SET QUERY_STORE (OPERATION_MODE = READ_WRITE);

DECLARE @data_file sysname = (
    SELECT TOP (1) [name]
    FROM sys.master_files
    WHERE [database_id] = DB_ID(N'ElevantDevelopmentDb') AND [type] = 0
    ORDER BY [file_id]
);
DECLARE @log_file sysname = (
    SELECT TOP (1) [name]
    FROM sys.master_files
    WHERE [database_id] = DB_ID(N'ElevantDevelopmentDb') AND [type] = 1
    ORDER BY [file_id]
);
DECLARE @growth_sql nvarchar(max) =
    N'ALTER DATABASE [ElevantDevelopmentDb] MODIFY FILE (NAME = ' + QUOTENAME(@data_file, '''') + N', FILEGROWTH = 256MB);' +
    N'ALTER DATABASE [ElevantDevelopmentDb] MODIFY FILE (NAME = ' + QUOTENAME(@log_file, '''') + N', FILEGROWTH = 128MB);';
EXEC sys.sp_executesql @growth_sql;

IF SUSER_ID(N'elevant_dev_dba') IS NULL
    CREATE LOGIN [elevant_dev_dba] WITH PASSWORD = N'$(DBA_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF SUSER_ID(N'elevant_dev_migrator') IS NULL
    CREATE LOGIN [elevant_dev_migrator] WITH PASSWORD = N'$(MIGRATOR_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF SUSER_ID(N'elevant_dev_app') IS NULL
    CREATE LOGIN [elevant_dev_app] WITH PASSWORD = N'$(APP_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF SUSER_ID(N'elevant_dev_seeder') IS NULL
    CREATE LOGIN [elevant_dev_seeder] WITH PASSWORD = N'$(SEEDER_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF SUSER_ID(N'elevant_dev_health') IS NULL
    CREATE LOGIN [elevant_dev_health] WITH PASSWORD = N'$(HEALTH_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF SUSER_ID(N'elevant_dev_backup') IS NULL
    CREATE LOGIN [elevant_dev_backup] WITH PASSWORD = N'$(BACKUP_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;

GRANT ALTER ANY LOGIN TO [elevant_dev_dba];
IF IS_SRVROLEMEMBER(N'dbcreator', N'elevant_dev_dba') <> 1
    ALTER SERVER ROLE [dbcreator] ADD MEMBER [elevant_dev_dba];

USE [ElevantDevelopmentDb];

IF SCHEMA_ID(N'infra') IS NULL EXEC(N'CREATE SCHEMA [infra] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'iam') IS NULL EXEC(N'CREATE SCHEMA [iam] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'ref') IS NULL EXEC(N'CREATE SCHEMA [ref] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'hr') IS NULL EXEC(N'CREATE SCHEMA [hr] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'commercial') IS NULL EXEC(N'CREATE SCHEMA [commercial] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'ops') IS NULL EXEC(N'CREATE SCHEMA [ops] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'integration') IS NULL EXEC(N'CREATE SCHEMA [integration] AUTHORIZATION [dbo]');
IF SCHEMA_ID(N'audit') IS NULL EXEC(N'CREATE SCHEMA [audit] AUTHORIZATION [dbo]');

IF OBJECT_ID(N'[infra].[database_instances]', N'U') IS NULL
BEGIN
    CREATE TABLE [infra].[database_instances]
    (
        [id] tinyint NOT NULL CONSTRAINT [pk_database_instances] PRIMARY KEY,
        [instance_id] uniqueidentifier NOT NULL,
        [environment_name] nvarchar(32) NOT NULL,
        [created_at] datetimeoffset(3) NOT NULL,
        CONSTRAINT [ck_database_instances_singleton] CHECK ([id] = 1),
        CONSTRAINT [ck_database_instances_environment] CHECK ([environment_name] IN (N'Development', N'Production'))
    );

    INSERT INTO [infra].[database_instances] ([id], [instance_id], [environment_name], [created_at])
    VALUES (1, NEWID(), N'Development', SYSUTCDATETIME());
END;

IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
    THROW 51000, 'The database environment marker is not a singleton.', 1;
IF NOT EXISTS (
    SELECT 1
    FROM [infra].[database_instances]
    WHERE [id] = 1 AND [environment_name] = N'Development'
)
    THROW 51001, 'Refusing to provision a database not marked Development.', 1;

IF USER_ID(N'elevant_dev_dba') IS NULL CREATE USER [elevant_dev_dba] FOR LOGIN [elevant_dev_dba];
IF USER_ID(N'elevant_dev_migrator') IS NULL CREATE USER [elevant_dev_migrator] FOR LOGIN [elevant_dev_migrator];
IF USER_ID(N'elevant_dev_app') IS NULL CREATE USER [elevant_dev_app] FOR LOGIN [elevant_dev_app];
IF USER_ID(N'elevant_dev_seeder') IS NULL CREATE USER [elevant_dev_seeder] FOR LOGIN [elevant_dev_seeder];
IF USER_ID(N'elevant_dev_health') IS NULL CREATE USER [elevant_dev_health] FOR LOGIN [elevant_dev_health];
IF USER_ID(N'elevant_dev_backup') IS NULL CREATE USER [elevant_dev_backup] FOR LOGIN [elevant_dev_backup];

IF DATABASE_PRINCIPAL_ID(N'elevant_app_role') IS NULL CREATE ROLE [elevant_app_role] AUTHORIZATION [dbo];
IF DATABASE_PRINCIPAL_ID(N'elevant_seeder_role') IS NULL CREATE ROLE [elevant_seeder_role] AUTHORIZATION [dbo];

IF IS_ROLEMEMBER(N'db_owner', N'elevant_dev_dba') <> 1 ALTER ROLE [db_owner] ADD MEMBER [elevant_dev_dba];
IF IS_ROLEMEMBER(N'db_owner', N'elevant_dev_migrator') <> 1 ALTER ROLE [db_owner] ADD MEMBER [elevant_dev_migrator];
IF IS_ROLEMEMBER(N'elevant_app_role', N'elevant_dev_app') <> 1 ALTER ROLE [elevant_app_role] ADD MEMBER [elevant_dev_app];
IF IS_ROLEMEMBER(N'elevant_seeder_role', N'elevant_dev_seeder') <> 1 ALTER ROLE [elevant_seeder_role] ADD MEMBER [elevant_dev_seeder];
IF IS_ROLEMEMBER(N'db_backupoperator', N'elevant_dev_backup') <> 1 ALTER ROLE [db_backupoperator] ADD MEMBER [elevant_dev_backup];

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[iam] TO [elevant_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[ref] TO [elevant_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[hr] TO [elevant_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[commercial] TO [elevant_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[ops] TO [elevant_app_role];
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[integration] TO [elevant_app_role];
GRANT SELECT, INSERT ON SCHEMA::[audit] TO [elevant_app_role];

GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[iam] TO [elevant_seeder_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[ref] TO [elevant_seeder_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[hr] TO [elevant_seeder_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[commercial] TO [elevant_seeder_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[ops] TO [elevant_seeder_role];
GRANT SELECT ON OBJECT::[infra].[database_instances] TO [elevant_dev_seeder];
GRANT SELECT ON OBJECT::[infra].[database_instances] TO [elevant_dev_health];
GRANT SELECT ON OBJECT::[infra].[database_instances] TO [elevant_dev_app];

PRINT N'Elevant Development database provisioning completed.';
