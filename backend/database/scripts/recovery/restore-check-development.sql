SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];

DECLARE @backup_file nvarchar(1024) = N'$(BACKUP_FILE)';
DECLARE @check_database sysname = N'ElevantDevelopmentRestoreCheck';

BEGIN TRY
    RESTORE VERIFYONLY FROM DISK = @backup_file WITH CHECKSUM;

    IF DB_ID(@check_database) IS NOT NULL
    BEGIN
        ALTER DATABASE [ElevantDevelopmentRestoreCheck] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [ElevantDevelopmentRestoreCheck];
    END;

    RESTORE DATABASE [ElevantDevelopmentRestoreCheck]
    FROM DISK = @backup_file
    WITH
        MOVE N'ElevantDevelopmentDb' TO N'/var/opt/mssql/data/ElevantDevelopmentRestoreCheck.mdf',
        MOVE N'ElevantDevelopmentDb_log' TO N'/var/opt/mssql/data/ElevantDevelopmentRestoreCheck_log.ldf',
        RECOVERY,
        REPLACE,
        CHECKSUM,
        STATS = 10;

    DECLARE @environment nvarchar(32);
    EXEC sys.sp_executesql
        N'SELECT @value = [environment_name] FROM [ElevantDevelopmentRestoreCheck].[infra].[database_instances] WHERE [id] = 1;',
        N'@value nvarchar(32) OUTPUT',
        @value = @environment OUTPUT;

    IF @environment <> N'Development'
        THROW 51002, 'Restored database marker is not Development.', 1;

    DBCC CHECKDB ([ElevantDevelopmentRestoreCheck]) WITH NO_INFOMSGS, ALL_ERRORMSGS;

    ALTER DATABASE [ElevantDevelopmentRestoreCheck] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [ElevantDevelopmentRestoreCheck];
END TRY
BEGIN CATCH
    IF DB_ID(@check_database) IS NOT NULL
    BEGIN
        ALTER DATABASE [ElevantDevelopmentRestoreCheck] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [ElevantDevelopmentRestoreCheck];
    END;
    THROW;
END CATCH;
