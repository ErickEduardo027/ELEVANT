SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];

DECLARE @lock_result int;
EXEC @lock_result = sys.sp_getapplock
    @Resource = N'ElevantDevelopmentDatabaseOperations',
    @LockMode = N'Exclusive',
    @LockOwner = N'Session',
    @LockTimeout = 0;
IF @lock_result < 0
    THROW 51020, 'Another Development backup or restore-check job is already running.', 1;

BACKUP DATABASE [ElevantDevelopmentDb]
TO DISK = N'$(BACKUP_FILE)'
WITH COPY_ONLY, INIT, CHECKSUM, COMPRESSION, STATS = 10;
