SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @expected_database sysname = N'ElevantDevelopmentDb';
DECLARE @expected_environment nvarchar(32) = N'Development';
DECLARE @product_major_version int = TRY_CONVERT(int, SERVERPROPERTY(N'ProductMajorVersion'));
DECLARE @edition nvarchar(128) = CONVERT(nvarchar(128), SERVERPROPERTY(N'Edition'));

IF COALESCE(@product_major_version, -1) <> 16
    THROW 52000, 'Development requires SQL Server 2022 (major version 16).', 1;

IF COALESCE(@edition, N'') NOT LIKE N'%Developer%'
    THROW 52001, 'Development requires SQL Server Developer Edition.', 1;

IF DB_NAME() <> @expected_database
    THROW 52002, 'Connected database is not the exact Development database.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.databases
    WHERE [name] = @expected_database
      AND [state_desc] = N'ONLINE'
      AND [compatibility_level] = 160
)
    THROW 52003, 'Development database must be online at compatibility level 160.', 1;

IF OBJECT_ID(N'[infra].[database_instances]', N'U') IS NULL
    THROW 52004, 'Development database marker table is missing.', 1;

IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
    THROW 52005, 'Development database marker must be a singleton.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM [infra].[database_instances]
    WHERE [id] = 1
      AND [environment_name] = @expected_environment
)
    THROW 52006, 'Database marker does not identify Development.', 1;

IF OBJECT_ID(N'[infra].[__EFMigrationsHistory]', N'U') IS NULL
    THROW 52007, 'EF migration history is missing.', 1;

DECLARE @expected_migrations table
(
    [migration_id] nvarchar(150) NOT NULL PRIMARY KEY
);

INSERT INTO @expected_migrations ([migration_id])
VALUES
    (N'20260817200402_V1_01_Platform'),
    (N'20260817201128_V1_02_IdentityReference'),
    (N'20260817201608_V1_03_WorkforceCommercial'),
    (N'20260817202135_V1_04_Operations'),
    (N'20260817202420_V1_05_MobileAudit'),
    (N'20260916151935_V1_06_DevelopmentAccountCredentialRotation'),
    (N'20260917161921_V1_07_DevelopmentHumanResourcesAccount'),
    (N'20260924125214_V1_08_RampCorrectionRevisions'),
    (N'20260924145534_V1_09_OperationalCommunication'),
    (N'20260925055507_V1_10_DevelopmentCredentialActivation'),
    (N'20260926062846_AccountChangeFeed'),
    (N'20260926175205_PreinvoiceDraft'),
    (N'20260926211142_PublicCommercialIntake'),
    (N'20260926212152_CommercialGovernance'),
    (N'20260926212759_CommercialProvisioning'),
    (N'20260926213514_ContractDraftConversation'),
    (N'20260927160653_CommercialRepresentativeDetails'),
    (N'20260927161819_ContractRateConfirmation'),
    (N'20260927195557_CommercialMediaAssets'),
    (N'20260927204956_PersonAvatarMedia'),
    (N'20260928155349_PreinvoiceDisputes'),
    (N'20260928163437_NonFiscalInvoices'),
    (N'20260928170918_NonFiscalPayments'),
    (N'20260928174712_ResolvePreinvoiceDisputes'),
    (N'20260928185354_FinancialDocuments'),
    (N'20261004210714_AddRampMobileAccessRequests'),
    (N'20261005133619_OperationAttendanceContributionRevisions'),
    (N'20261005153623_AddServiceClosureRequests'),
    (N'20261005164319_OperationAttendanceValidation'),
    (N'20261007180310_AddDepartmentGovernance'),
    (N'20261008142843_AddFinanceTariffsAndCharges'),
    (N'20261009172055_AddEmployeesPositionsRequisitions'),
    (N'20261019033625_AddFinanceCommercialPlatform'),
    (N'20261019041554_AddFinanceTaxSnapshotsAndCorrections'),
    (N'20261026143722_AddRepresentativeDistrictAndAirlineCodeUniqueness');

DECLARE @missing_migrations nvarchar(2048);
SELECT @missing_migrations = STRING_AGG(expected.[migration_id], N', ')
FROM @expected_migrations AS expected
WHERE NOT EXISTS (
    SELECT 1
    FROM [infra].[__EFMigrationsHistory] AS applied
    WHERE applied.[MigrationId] = expected.[migration_id]
);

IF @missing_migrations IS NOT NULL
BEGIN
    DECLARE @migration_error nvarchar(2048) = N'Missing required EF migrations: ' + @missing_migrations;
    THROW 52008, @migration_error, 1;
END;

IF (SELECT COUNT_BIG(*) FROM [infra].[__EFMigrationsHistory]) <> (SELECT COUNT_BIG(*) FROM @expected_migrations)
   OR EXISTS (
       SELECT 1
       FROM [infra].[__EFMigrationsHistory] AS applied
       WHERE NOT EXISTS (
           SELECT 1
           FROM @expected_migrations AS expected
           WHERE expected.[migration_id] = applied.[MigrationId]
       )
   )
    THROW 52020, 'EF migration history contains an unexpected v1 migration.', 1;

IF OBJECT_ID(N'[iam].[set_development_account_credential]', N'P') IS NULL
    THROW 52025, 'The restricted Development credential procedure is missing.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.sql_modules
    WHERE [object_id] = OBJECT_ID(N'[iam].[set_development_account_credential]')
      AND [execute_as_principal_id] = -2
)
    THROW 52026, 'The restricted Development credential procedure must execute as owner.', 1;

IF OBJECT_ID(N'[iam].[require_development_hr_password_change]', N'P') IS NULL
    THROW 52032, 'The restricted Development HR activation procedure is missing.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.sql_modules
    WHERE [object_id] = OBJECT_ID(N'[iam].[require_development_hr_password_change]')
      AND [execute_as_principal_id] = -2
)
    THROW 52033, 'The restricted Development HR activation procedure must execute as owner.', 1;

IF NOT EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE [object_id] = OBJECT_ID(N'[iam].[accounts]', N'U')
         AND [name] = N'ux_accounts_normalized_email'
         AND [is_unique] = 1
         AND [has_filter] = 1
         AND REPLACE([filter_definition], N' ', N'') IN (
             N'[normalized_email]ISNOTNULL',
             N'([normalized_email]ISNOTNULL)'
         )
   )
   OR EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE [object_id] = OBJECT_ID(N'[iam].[accounts]', N'U')
         AND [name] = N'ix_accounts_normalized_email'
   )
    THROW 52028, 'Normalized account emails must use the filtered unique index.', 1;

DECLARE @seed_checks table
(
    [check_name] nvarchar(80) NOT NULL PRIMARY KEY,
    [actual_count] bigint NOT NULL,
    [expected_count] bigint NOT NULL
);

INSERT INTO @seed_checks
SELECT N'organizations-natural-keys', COUNT_BIG(*), 2
FROM [iam].[organizations]
WHERE [code] IN (N'AVIAM', N'DEMO-AIR');

INSERT INTO @seed_checks
SELECT N'organizations-deterministic-ids', COUNT_BIG(*), 2
FROM [iam].[organizations]
WHERE ([code] = N'AVIAM' AND [public_id] = CONVERT(uniqueidentifier, N'10000000-0000-7000-8000-000000000001'))
   OR ([code] = N'DEMO-AIR' AND [public_id] = CONVERT(uniqueidentifier, N'10000000-0000-7000-8000-000000000002'));

INSERT INTO @seed_checks
SELECT N'persons-natural-keys', COUNT_BIG(*), 7
FROM [iam].[persons]
WHERE [primary_email] IN (
    N'admin.occ@dev.elevant.test',
    N'ramp.agent@dev.elevant.test',
    N'airline.client@dev.elevant.test',
    N'gestion.humana@dev.elevant.test',
    N'contratos@dev.elevant.test',
    N'finanzas@dev.elevant.test',
    N'super.admin@dev.elevant.test'
);

INSERT INTO @seed_checks
SELECT N'accounts-deterministic-ids', COUNT_BIG(*), 7
FROM [iam].[accounts]
WHERE [public_id] IN (
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000001'),
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000002'),
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000003'),
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000004'),
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000005'),
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000006'),
    CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000007')
);

INSERT INTO @seed_checks
SELECT N'accounts-hardened-credentials', COUNT_BIG(*), 7
FROM [iam].[accounts]
WHERE [normalized_email] IN (
    N'ADMIN.OCC@DEV.ELEVANT.TEST',
    N'RAMP.AGENT@DEV.ELEVANT.TEST',
    N'AIRLINE.CLIENT@DEV.ELEVANT.TEST',
    N'GESTION.HUMANA@DEV.ELEVANT.TEST',
    N'CONTRATOS@DEV.ELEVANT.TEST',
    N'FINANZAS@DEV.ELEVANT.TEST',
    N'SUPER.ADMIN@DEV.ELEVANT.TEST'
)
  AND [lockout_enabled] = CONVERT(bit, 1)
  AND NULLIF([password_hash], N'') IS NOT NULL
  AND NULLIF([security_stamp], N'') IS NOT NULL;

INSERT INTO @seed_checks
SELECT N'superadmin-governance-access', COUNT_BIG(*), 1
FROM [iam].[accounts] AS accounts
INNER JOIN [iam].[account_roles] AS account_roles ON account_roles.[user_id] = accounts.[id]
INNER JOIN [iam].[roles] AS roles ON roles.[id] = account_roles.[role_id]
INNER JOIN [iam].[organization_memberships] AS memberships ON memberships.[account_id] = accounts.[id]
INNER JOIN [iam].[organizations] AS organizations ON organizations.[id] = memberships.[organization_id]
WHERE accounts.[normalized_email] = N'SUPER.ADMIN@DEV.ELEVANT.TEST'
  AND accounts.[public_id] = CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000007')
  AND roles.[normalized_name] = N'SUPERADMIN'
  AND roles.[portal] = N'BackOffice'
  AND roles.[user_type] = N'superadmin'
  AND organizations.[code] = N'AVIAM'
  AND memberships.[kind] = N'InternalStaff'
  AND memberships.[status] = N'Active';

INSERT INTO @seed_checks
SELECT N'new-personas-role-station-scope', COUNT_BIG(*), 2
FROM [iam].[accounts] AS accounts
INNER JOIN [iam].[account_roles] AS account_roles ON account_roles.[user_id] = accounts.[id]
INNER JOIN [iam].[roles] AS roles ON roles.[id] = account_roles.[role_id]
INNER JOIN [iam].[organization_memberships] AS memberships ON memberships.[account_id] = accounts.[id]
INNER JOIN [iam].[organizations] AS organizations ON organizations.[id] = memberships.[organization_id]
INNER JOIN [iam].[account_station_scopes] AS station_scopes ON station_scopes.[account_id] = accounts.[id]
INNER JOIN [ref].[stations] AS stations ON stations.[id] = station_scopes.[station_id]
WHERE ((accounts.[normalized_email] = N'CONTRATOS@DEV.ELEVANT.TEST' AND roles.[normalized_name] = N'CONTRATOS' AND roles.[user_type] = N'contracts')
    OR (accounts.[normalized_email] = N'FINANZAS@DEV.ELEVANT.TEST' AND roles.[normalized_name] = N'FINANZAS' AND roles.[user_type] = N'finance'))
  AND roles.[portal] = N'BackOffice'
  AND organizations.[code] = N'AVIAM'
  AND memberships.[kind] = N'InternalStaff'
  AND memberships.[status] = N'Active'
  AND stations.[code] = N'PUJ'
  AND station_scopes.[revoked_at] IS NULL;

INSERT INTO @seed_checks
SELECT N'human-resources-identity-access', COUNT_BIG(*), 1
FROM [iam].[accounts] AS accounts
INNER JOIN [iam].[persons] AS persons
    ON persons.[id] = accounts.[person_id]
INNER JOIN [iam].[account_roles] AS account_roles
    ON account_roles.[user_id] = accounts.[id]
INNER JOIN [iam].[roles] AS roles
    ON roles.[id] = account_roles.[role_id]
INNER JOIN [iam].[organization_memberships] AS memberships
    ON memberships.[account_id] = accounts.[id]
INNER JOIN [iam].[organizations] AS organizations
    ON organizations.[id] = memberships.[organization_id]
INNER JOIN [iam].[account_station_scopes] AS station_scopes
    ON station_scopes.[account_id] = accounts.[id]
INNER JOIN [ref].[stations] AS stations
    ON stations.[id] = station_scopes.[station_id]
WHERE accounts.[normalized_email] = N'GESTION.HUMANA@DEV.ELEVANT.TEST'
  AND accounts.[public_id] = CONVERT(uniqueidentifier, N'40000000-0000-7000-8000-000000000004')
  AND persons.[public_id] = CONVERT(uniqueidentifier, N'30000000-0000-7000-8000-000000000004')
  AND persons.[first_name] = N'Camila'
  AND persons.[last_name] = N'Development'
  AND persons.[identification_number] = N'DEV-HR-001'
  AND roles.[name] = N'Gestión Humana'
  AND roles.[normalized_name] = N'GESTION_HUMANA'
  AND roles.[portal] = N'BackOffice'
  AND roles.[user_type] = N'human_resources'
  AND organizations.[code] = N'AVIAM'
  AND memberships.[kind] = N'InternalStaff'
  AND memberships.[status] = N'Active'
  AND memberships.[job_title] = N'Gestión Humana'
  AND memberships.[valid_from] = CONVERT(date, N'2026-01-01')
  AND memberships.[valid_to] IS NULL
  AND stations.[code] = N'PUJ'
  AND station_scopes.[revoked_at] IS NULL;

INSERT INTO @seed_checks
SELECT N'reference-airports', COUNT_BIG(*), 2
FROM [ref].[airports]
WHERE ([iata_code] = N'PUJ' AND [public_id] = CONVERT(uniqueidentifier, N'20000000-0000-7000-8000-000000000001'))
   OR ([iata_code] = N'MIA' AND [public_id] = CONVERT(uniqueidentifier, N'20000000-0000-7000-8000-000000000002'));

INSERT INTO @seed_checks
SELECT N'ramp-agent', COUNT_BIG(*), 1
FROM [hr].[ramp_agents]
WHERE [employee_number] = N'DEV-RA-001'
  AND [public_id] = CONVERT(uniqueidentifier, N'50000000-0000-7000-8000-000000000001');

INSERT INTO @seed_checks
SELECT N'hr-employees', COUNT_BIG(*), 3
FROM [hr].[employees]
WHERE [employee_number] IN (N'DEV-RA-001', N'DEV-EMP-FIN-002', N'DEV-RA-002')
  AND [status] = N'Active';

INSERT INTO @seed_checks
SELECT N'commercial-request', COUNT_BIG(*), 1
FROM [commercial].[service_requests]
WHERE [request_code] = N'DEV-REQ-0001'
  AND [public_id] = CONVERT(uniqueidentifier, N'60000000-0000-7000-8000-000000000001');

INSERT INTO @seed_checks
SELECT N'commercial-contract', COUNT_BIG(*), 1
FROM [commercial].[contracts]
WHERE [contract_code] = N'DEV-CONTRACT-0001'
  AND [public_id] = CONVERT(uniqueidentifier, N'60000000-0000-7000-8000-000000000002');

INSERT INTO @seed_checks
SELECT N'operations-turnaround', COUNT_BIG(*), 1
FROM [ops].[turnarounds]
WHERE [operation_code] = N'DEV-TAT-0001'
  AND [public_id] = CONVERT(uniqueidentifier, N'70000000-0000-7000-8000-000000000001');

INSERT INTO @seed_checks
SELECT N'operations-ground-operation', COUNT_BIG(*), 1
FROM [ops].[ground_operations]
WHERE [public_id] = CONVERT(uniqueidentifier, N'70000000-0000-7000-8000-000000000005');

IF EXISTS (
    SELECT 1
    FROM @seed_checks
    WHERE [actual_count] <> [expected_count]
)
BEGIN
    SELECT [check_name], [actual_count], [expected_count]
    FROM @seed_checks
    WHERE [actual_count] <> [expected_count]
    ORDER BY [check_name];

    THROW 52009, 'Synthetic Development seed anchors are missing, duplicated, or non-deterministic.', 1;
END;

IF SUSER_SNAME() <> N'elevant_dev_dba'
    THROW 52010, 'Development verification must run as elevant_dev_dba.', 1;

IF COALESCE(HAS_PERMS_BY_NAME(NULL, NULL, N'ALTER ANY LOGIN'), 0) <> 1
    THROW 52011, 'Development DBA lacks ALTER ANY LOGIN.', 1;

IF COALESCE(IS_SRVROLEMEMBER(N'dbcreator', N'elevant_dev_dba'), 0) <> 1
    THROW 52012, 'Development DBA is not a dbcreator member.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.sql_logins
    WHERE [name] = N'sa'
      AND [is_disabled] = 1
)
    THROW 52013, 'The sa login must exist and remain disabled.', 1;

DECLARE @expected_logins table
(
    [principal_name] sysname NOT NULL PRIMARY KEY
);

INSERT INTO @expected_logins ([principal_name])
VALUES
    (N'elevant_dev_dba'),
    (N'elevant_dev_migrator'),
    (N'elevant_dev_app'),
    (N'elevant_dev_seeder'),
    (N'elevant_dev_health'),
    (N'elevant_dev_backup');

IF EXISTS (
    SELECT 1
    FROM @expected_logins AS expected
    LEFT JOIN sys.sql_logins AS actual ON actual.[name] = expected.[principal_name]
    WHERE actual.[principal_id] IS NULL
       OR actual.[is_disabled] <> 0
       OR actual.[is_policy_checked] <> 1
       OR actual.[is_expiration_checked] <> 0
)
    THROW 52014, 'A required Development SQL login is missing, disabled, or has an invalid password policy.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_logins AS expected
    WHERE COALESCE(IS_SRVROLEMEMBER(N'sysadmin', expected.[principal_name]), 0) <> 0
)
    THROW 52015, 'Development service logins must not be sysadmin members.', 1;

DECLARE @expected_server_memberships table
(
    [role_name] sysname NOT NULL,
    [member_name] sysname NOT NULL,
    PRIMARY KEY ([role_name], [member_name])
);

INSERT INTO @expected_server_memberships ([role_name], [member_name])
VALUES (N'dbcreator', N'elevant_dev_dba');

IF EXISTS (
    SELECT 1
    FROM sys.server_role_members AS memberships
    INNER JOIN sys.server_principals AS roles
        ON roles.[principal_id] = memberships.[role_principal_id]
    INNER JOIN sys.server_principals AS members
        ON members.[principal_id] = memberships.[member_principal_id]
    INNER JOIN @expected_logins AS expected_logins
        ON expected_logins.[principal_name] = members.[name]
    WHERE NOT EXISTS (
        SELECT 1
        FROM @expected_server_memberships AS expected
        WHERE expected.[role_name] = roles.[name]
          AND expected.[member_name] = members.[name]
    )
)
    THROW 52021, 'A Development login has an unexpected fixed server role.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.server_permissions AS permissions
    INNER JOIN sys.server_principals AS principals
        ON principals.[principal_id] = permissions.[grantee_principal_id]
    INNER JOIN @expected_logins AS expected
        ON expected.[principal_name] = principals.[name]
    WHERE permissions.[permission_name] = N'CONTROL SERVER'
      AND permissions.[state] IN (N'G', N'W')
)
    THROW 52022, 'A Development login unexpectedly has CONTROL SERVER.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_logins AS expected
    LEFT JOIN sys.database_principals AS actual ON actual.[name] = expected.[principal_name]
    WHERE actual.[principal_id] IS NULL
)
    THROW 52016, 'One or more required Development database users are missing.', 1;

IF EXISTS (
    SELECT 1
    FROM @expected_logins AS expected
    INNER JOIN sys.database_principals AS database_users
        ON database_users.[name] = expected.[principal_name]
    INNER JOIN master.sys.server_principals AS server_logins
        ON server_logins.[name] = expected.[principal_name]
    WHERE database_users.[sid] <> server_logins.[sid]
)
    THROW 52024, 'A Development database user is orphaned from its SQL login.', 1;

DECLARE @expected_memberships table
(
    [role_name] sysname NOT NULL,
    [member_name] sysname NOT NULL,
    PRIMARY KEY ([role_name], [member_name])
);

INSERT INTO @expected_memberships ([role_name], [member_name])
VALUES
    (N'db_owner', N'elevant_dev_dba'),
    (N'db_owner', N'elevant_dev_migrator'),
    (N'elevant_app_role', N'elevant_dev_app'),
    (N'elevant_seeder_role', N'elevant_dev_seeder'),
    (N'db_backupoperator', N'elevant_dev_backup');

IF EXISTS (
    SELECT 1
    FROM @expected_memberships
    WHERE COALESCE(IS_ROLEMEMBER([role_name], [member_name]), 0) <> 1
)
    THROW 52017, 'One or more Development database role memberships are missing.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.database_role_members AS memberships
    INNER JOIN sys.database_principals AS roles
        ON roles.[principal_id] = memberships.[role_principal_id]
    INNER JOIN sys.database_principals AS members
        ON members.[principal_id] = memberships.[member_principal_id]
    INNER JOIN @expected_logins AS expected_logins
        ON expected_logins.[principal_name] = members.[name]
    WHERE NOT EXISTS (
        SELECT 1
        FROM @expected_memberships AS expected
        WHERE expected.[role_name] = roles.[name]
          AND expected.[member_name] = members.[name]
    )
)
    THROW 52023, 'A Development database user has an unexpected role membership.', 1;

IF EXISTS (
    SELECT 1
    FROM (VALUES
        (N'elevant_dev_app'),
        (N'elevant_dev_seeder'),
        (N'elevant_dev_health'),
        (N'elevant_dev_backup')
    ) AS restricted([principal_name])
    WHERE COALESCE(IS_ROLEMEMBER(N'db_owner', restricted.[principal_name]), 0) <> 0
)
    THROW 52018, 'A restricted Development login is unexpectedly a db_owner member.', 1;

CREATE TABLE #permission_checks
(
    [check_name] nvarchar(100) NOT NULL,
    [actual_value] int NOT NULL,
    [expected_value] int NOT NULL
);

EXECUTE AS USER = N'elevant_dev_app';
INSERT INTO #permission_checks VALUES
    (N'app-select-iam', COALESCE(HAS_PERMS_BY_NAME(N'iam', N'SCHEMA', N'SELECT'), 0), 1),
    (N'app-insert-ops', COALESCE(HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'INSERT'), 0), 1),
    (N'app-execute-integration', COALESCE(HAS_PERMS_BY_NAME(N'integration', N'SCHEMA', N'EXECUTE'), 0), 1),
    (N'app-select-marker', COALESCE(HAS_PERMS_BY_NAME(N'infra.database_instances', N'OBJECT', N'SELECT'), 0), 1),
    (N'app-insert-audit', COALESCE(HAS_PERMS_BY_NAME(N'audit', N'SCHEMA', N'INSERT'), 0), 1),
    (N'app-select-outbox', COALESCE(HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'SELECT'), 0), 1),
    (N'app-insert-outbox', COALESCE(HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'INSERT'), 0), 1),
    (N'app-update-outbox', COALESCE(HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'UPDATE'), 0), 1),
    (N'app-delete-outbox', COALESCE(HAS_PERMS_BY_NAME(N'infra.outbox_messages', N'OBJECT', N'DELETE'), 0), 0),
    (N'app-select-account-changes', COALESCE(HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'SELECT'), 0), 1),
    (N'app-insert-account-changes', COALESCE(HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'INSERT'), 0), 1),
    (N'app-update-account-changes', COALESCE(HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'UPDATE'), 0), 0),
    (N'app-delete-account-changes', COALESCE(HAS_PERMS_BY_NAME(N'infra.account_changes', N'OBJECT', N'DELETE'), 0), 0),
    (N'app-delete-audit', COALESCE(HAS_PERMS_BY_NAME(N'audit', N'SCHEMA', N'DELETE'), 0), 0),
    (N'app-execute-credential-procedure', COALESCE(HAS_PERMS_BY_NAME(N'iam.set_development_account_credential', N'OBJECT', N'EXECUTE'), 0), 0),
    (N'app-execute-hr-activation-procedure', COALESCE(HAS_PERMS_BY_NAME(N'iam.require_development_hr_password_change', N'OBJECT', N'EXECUTE'), 0), 0),
    (N'app-alter-iam', COALESCE(HAS_PERMS_BY_NAME(N'iam', N'SCHEMA', N'ALTER'), 0), 0),
    (N'app-read-migration-history', COALESCE(HAS_PERMS_BY_NAME(N'infra.__EFMigrationsHistory', N'OBJECT', N'SELECT'), 0), 0);
REVERT;

EXECUTE AS USER = N'elevant_dev_seeder';
INSERT INTO #permission_checks VALUES
    (N'seeder-select-ref', COALESCE(HAS_PERMS_BY_NAME(N'ref', N'SCHEMA', N'SELECT'), 0), 1),
    (N'seeder-insert-commercial', COALESCE(HAS_PERMS_BY_NAME(N'commercial', N'SCHEMA', N'INSERT'), 0), 1),
    (N'seeder-update-iam', COALESCE(HAS_PERMS_BY_NAME(N'iam', N'SCHEMA', N'UPDATE'), 0), 0),
    (N'seeder-update-accounts', COALESCE(HAS_PERMS_BY_NAME(N'iam.accounts', N'OBJECT', N'UPDATE'), 0), 0),
    (N'seeder-update-hr', COALESCE(HAS_PERMS_BY_NAME(N'hr', N'SCHEMA', N'UPDATE'), 0), 0),
    (N'seeder-delete-ops', COALESCE(HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'DELETE'), 0), 0),
    (N'seeder-execute-iam', COALESCE(HAS_PERMS_BY_NAME(N'iam', N'SCHEMA', N'EXECUTE'), 0), 0),
    (N'seeder-execute-credential-procedure', COALESCE(HAS_PERMS_BY_NAME(N'iam.set_development_account_credential', N'OBJECT', N'EXECUTE'), 0), 1),
    (N'seeder-execute-hr-activation-procedure', COALESCE(HAS_PERMS_BY_NAME(N'iam.require_development_hr_password_change', N'OBJECT', N'EXECUTE'), 0), 1),
    (N'seeder-select-marker', COALESCE(HAS_PERMS_BY_NAME(N'infra.database_instances', N'OBJECT', N'SELECT'), 0), 1),
    (N'seeder-alter-ref', COALESCE(HAS_PERMS_BY_NAME(N'ref', N'SCHEMA', N'ALTER'), 0), 0),
    (N'seeder-read-migration-history', COALESCE(HAS_PERMS_BY_NAME(N'infra.__EFMigrationsHistory', N'OBJECT', N'SELECT'), 0), 0);
REVERT;

EXECUTE AS USER = N'elevant_dev_health';
INSERT INTO #permission_checks VALUES
    (N'health-select-marker', COALESCE(HAS_PERMS_BY_NAME(N'infra.database_instances', N'OBJECT', N'SELECT'), 0), 1),
    (N'health-select-business-data', COALESCE(HAS_PERMS_BY_NAME(N'ref.stations', N'OBJECT', N'SELECT'), 0), 0),
    (N'health-alter-infra', COALESCE(HAS_PERMS_BY_NAME(N'infra', N'SCHEMA', N'ALTER'), 0), 0);
REVERT;

EXECUTE AS USER = N'elevant_dev_backup';
INSERT INTO #permission_checks VALUES
    (N'backup-database', COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'BACKUP DATABASE'), 0), 1),
    (N'backup-select-business-data', COALESCE(HAS_PERMS_BY_NAME(N'ops.turnarounds', N'OBJECT', N'SELECT'), 0), 0),
    (N'backup-alter-ops', COALESCE(HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'ALTER'), 0), 0);
REVERT;

IF EXISTS (
    SELECT 1
    FROM #permission_checks
    WHERE [actual_value] <> [expected_value]
)
BEGIN
    SELECT [check_name], [actual_value], [expected_value]
    FROM #permission_checks
    WHERE [actual_value] <> [expected_value]
    ORDER BY [check_name];

    THROW 52019, 'One or more effective Development permissions are incorrect.', 1;
END;

DECLARE @seeder_role_id int = DATABASE_PRINCIPAL_ID(N'elevant_seeder_role');
DECLARE @app_role_id int = DATABASE_PRINCIPAL_ID(N'elevant_app_role');
DECLARE @credential_procedure_id int = OBJECT_ID(N'[iam].[set_development_account_credential]', N'P');
DECLARE @hr_activation_procedure_id int = OBJECT_ID(N'[iam].[require_development_hr_password_change]', N'P');

IF NOT EXISTS (
       SELECT 1
       FROM sys.database_permissions
       WHERE [grantee_principal_id] = @seeder_role_id
         AND [class] = 1
         AND [major_id] = @credential_procedure_id
         AND [minor_id] = 0
         AND [permission_name] = N'EXECUTE'
         AND [state] IN (N'G', N'W')
   )
   OR NOT EXISTS (
       SELECT 1
       FROM sys.database_permissions
       WHERE [grantee_principal_id] = @seeder_role_id
         AND [class] = 1
         AND [major_id] = @hr_activation_procedure_id
         AND [minor_id] = 0
         AND [permission_name] = N'EXECUTE'
         AND [state] IN (N'G', N'W')
   )
   OR EXISTS (
       SELECT 1
       FROM sys.database_permissions
       WHERE [grantee_principal_id] = @seeder_role_id
         AND [permission_name] = N'EXECUTE'
         AND [state] IN (N'G', N'W')
         AND NOT ([class] = 1 AND [major_id] IN (@credential_procedure_id, @hr_activation_procedure_id) AND [minor_id] = 0)
   )
   OR EXISTS (
       SELECT 1
       FROM sys.database_permissions
       WHERE [class] = 1
         AND [major_id] IN (@credential_procedure_id, @hr_activation_procedure_id)
         AND [minor_id] = 0
         AND [permission_name] = N'EXECUTE'
         AND [state] IN (N'G', N'W')
         AND [grantee_principal_id] <> @seeder_role_id
   )
    THROW 52027, 'Seeder EXECUTE must be granted only on the restricted Development credential procedures.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_permissions
    WHERE [grantee_principal_id] = @app_role_id
      AND [class] = 1
      AND [major_id] = @credential_procedure_id
      AND [minor_id] = 0
      AND [permission_name] = N'EXECUTE'
      AND [state] = N'D'
)
    THROW 52029, 'Application role must be denied EXECUTE on the Development credential procedure.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_permissions
    WHERE [grantee_principal_id] = @app_role_id
      AND [class] = 1
      AND [major_id] = @hr_activation_procedure_id
      AND [minor_id] = 0
      AND [permission_name] = N'EXECUTE'
      AND [state] = N'D'
)
    THROW 52034, 'Application role must be denied EXECUTE on the Development HR activation procedure.', 1;

PRINT N'PASS: SQL Server 2022 Developer Edition and database configuration.';
PRINT N'PASS: exact ElevantDevelopmentDb target and immutable Development marker.';
PRINT N'PASS: required EF migration chain.';
PRINT N'PASS: deterministic Development seed anchors and observable uniqueness.';
PRINT N'PASS: least-privilege login roles, effective permissions, and disabled sa.';
