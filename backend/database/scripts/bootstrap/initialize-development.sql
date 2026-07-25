SET NOCOUNT ON;

IF DB_ID(N'ElevantDevelopmentDb') IS NULL
BEGIN
    EXEC(N'CREATE DATABASE [ElevantDevelopmentDb]');
END;
GO
