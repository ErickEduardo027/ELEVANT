SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];

DECLARE @backup_file nvarchar(1024) = N'$(BACKUP_FILE)';
DECLARE @restore_check_token nvarchar(12) = N'$(RESTORE_CHECK_TOKEN)';

IF LEN(@restore_check_token) <> 12 OR @restore_check_token LIKE N'%[^0-9a-f]%'
    THROW 51022, 'Restore-check token must be exactly 12 lowercase hexadecimal characters.', 1;

IF @backup_file LIKE N'%[^A-Za-z0-9_./]%'
   OR @backup_file NOT LIKE N'/var/opt/mssql/backups/ElevantDevelopmentDb[_]%.bak'
    THROW 51023, 'Restore-check backup path is outside the approved safe pattern.', 1;

DECLARE @check_database sysname = N'ElevantDevelopmentRestoreCheck_' + @restore_check_token;
DECLARE @check_data_file nvarchar(260) = N'/var/opt/mssql/data/' + @check_database + N'.mdf';
DECLARE @check_log_file nvarchar(260) = N'/var/opt/mssql/data/' + @check_database + N'_log.ldf';
DECLARE @checkdb_sql nvarchar(max) =
    N'DBCC CHECKDB (' + QUOTENAME(@check_database) + N') WITH NO_INFOMSGS, ALL_ERRORMSGS;';
DECLARE @cleanup_sql nvarchar(max) =
    N'ALTER DATABASE ' + QUOTENAME(@check_database) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ' +
    N'DROP DATABASE ' + QUOTENAME(@check_database) + N';';
DECLARE @created_by_this_job bit = 0;
DECLARE @lock_result int;

EXEC @lock_result = sys.sp_getapplock
    @Resource = N'ElevantDevelopmentDatabaseOperations',
    @LockMode = N'Exclusive',
    @LockOwner = N'Session',
    @LockTimeout = 0;
IF @lock_result < 0
    THROW 51020, 'Another Development backup or restore-check job is already running.', 1;

IF DB_ID(@check_database) IS NOT NULL
    THROW 51021, 'Generated restore-check database already exists; refusing to replace or delete it.', 1;

BEGIN TRY
    RESTORE VERIFYONLY FROM DISK = @backup_file WITH CHECKSUM;

    DECLARE @restore_sql nvarchar(max) =
        N'RESTORE DATABASE ' + QUOTENAME(@check_database) +
        N' FROM DISK = @backup_file WITH ' +
        N'MOVE N''ElevantDevelopmentDb'' TO N''' + REPLACE(@check_data_file, N'''', N'''''') + N''', ' +
        N'MOVE N''ElevantDevelopmentDb_log'' TO N''' + REPLACE(@check_log_file, N'''', N'''''') + N''', ' +
        N'RECOVERY, CHECKSUM, STATS = 10;';

    EXEC sys.sp_executesql
        @restore_sql,
        N'@backup_file nvarchar(1024)',
        @backup_file = @backup_file;
    SET @created_by_this_job = 1;

    DECLARE @environment nvarchar(32);
    DECLARE @marker_count bigint;
    DECLARE @marker_sql nvarchar(max) =
        N'SELECT
              @count = COUNT_BIG(*),
              @value = MAX(CASE WHEN [id] = 1 THEN [environment_name] END)
          FROM ' + QUOTENAME(@check_database) + N'.[infra].[database_instances];';

    EXEC sys.sp_executesql
        @marker_sql,
        N'@count bigint OUTPUT, @value nvarchar(32) OUTPUT',
        @count = @marker_count OUTPUT,
        @value = @environment OUTPUT;

    IF @marker_count <> 1 OR @environment IS NULL OR @environment <> N'Development'
        THROW 51002, 'Restored database marker is not singleton Development.', 1;

    EXEC sys.sp_executesql @checkdb_sql;
    EXEC sys.sp_executesql @cleanup_sql;
    SET @created_by_this_job = 0;
END TRY
BEGIN CATCH
    IF @created_by_this_job = 1 AND DB_ID(@check_database) IS NOT NULL
    BEGIN
        EXEC sys.sp_executesql @cleanup_sql;
    END;
    THROW;
END CATCH;
