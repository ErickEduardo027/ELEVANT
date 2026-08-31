[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$SqlServerImage = 'mcr.microsoft.com/mssql/server:2022-CU26-ubuntu-22.04@sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89',
    [string]$OpsImage = 'elevant-db-ops:cert-candidate',
    [string]$ReleaseImage = 'elevant-db-release:cert-candidate',
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ExpectedRevision,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ExpectedSource,
    [string]$ProductionBootstrapPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $backendRoot '..')).Path
$defaultProductionBootstrap = Join-Path $backendRoot 'database/scripts/bootstrap/initialize-production.sql'

if ([string]::IsNullOrWhiteSpace($ProductionBootstrapPath)) {
    $productionBootstrapCandidate = $defaultProductionBootstrap
}
elseif ([System.IO.Path]::IsPathRooted($ProductionBootstrapPath)) {
    $productionBootstrapCandidate = $ProductionBootstrapPath
}
else {
    # Explicit relative paths are repository-relative so callers do not depend on
    # the workflow working directory while the monorepo layout is reorganized.
    $productionBootstrapCandidate = Join-Path $repositoryRoot $ProductionBootstrapPath
}

if (-not (Test-Path -LiteralPath $productionBootstrapCandidate -PathType Leaf)) {
    throw "Production certification bootstrap fixture was not found: $productionBootstrapCandidate"
}

$productionBootstrap = (Resolve-Path -LiteralPath $productionBootstrapCandidate).Path
$pathComparison = if ([System.IO.Path]::DirectorySeparatorChar -eq '\') {
    [System.StringComparison]::OrdinalIgnoreCase
}
else {
    [System.StringComparison]::Ordinal
}
$repositoryPrefix = $repositoryRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (-not $productionBootstrap.StartsWith($repositoryPrefix, $pathComparison)) {
    throw 'Production certification bootstrap fixture must be a file inside the repository.'
}
if ([System.IO.Path]::GetExtension($productionBootstrap) -ne '.sql') {
    throw 'Production certification bootstrap fixture must have the .sql extension.'
}

$productionDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path $repositoryRoot 'database/ProductionDB')
).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if ($productionBootstrap.StartsWith($productionDirectory, $pathComparison)) {
    throw 'Production certification fixtures must not be stored in database/ProductionDB.'
}

$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$resourcePrefix = "elevant-cert-$suffix"
$networkName = "$resourcePrefix-data"
$dataVolume = "$resourcePrefix-sql-data"
$backupVolume = "$resourcePrefix-sql-backups"
$sqlContainer = "$resourcePrefix-sql"
$sqlAlias = 'elevant-cert-sql'
$sqlcmd = '/opt/mssql-tools18/bin/sqlcmd'

$passwords = @{
    Sa = "CertSa-Aa1!$suffix"
    Dba = "CertDba-Aa1!$suffix"
    DbaWrong = "CertWrongDba-Aa1!$suffix"
    Migrator = "CertMigrator-Aa1!$suffix"
    App = "CertApp-Aa1!$suffix"
    Seeder = "CertSeeder-Aa1!$suffix"
    Health = "CertHealth-Aa1!$suffix"
    Backup = "CertBackup-Aa1!$suffix"
    Demo = "CertDemo-Aa1!$suffix"
}

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments[0]) failed with exit code $LASTEXITCODE."
    }
}

function Ensure-DockerImage {
    param([Parameter(Mandatory = $true)][string]$Image)

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker image inspect $Image 2>$null | Out-Null
        $inspectExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($inspectExitCode -eq 0) {
        return
    }

    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & docker pull $Image
            $pullExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousPreference
        }
        if ($pullExitCode -eq 0) {
            return
        }
        if ($attempt -lt 5) {
            Start-Sleep -Seconds (2 * $attempt)
        }
    }

    throw "Docker image $Image could not be pulled after five attempts."
}

function Invoke-DockerExpectedFailure {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [Parameter(Mandatory = $true)][string]$ExpectedErrorPattern
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = (& docker @Arguments 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($exitCode -eq 0) {
        throw $FailureMessage
    }
    if ($output -notmatch $ExpectedErrorPattern) {
        throw "$FailureMessage The command failed for an unexpected reason."
    }
}

function Invoke-SqlClient {
    param(
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$Query
    )

    Invoke-Docker -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', $User,
        '-P', $Password,
        '-d', $Database,
        '-C', '-b', '-r', '1',
        '-Q', $Query
    )
}

function Wait-Sql {
    param(
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password,
        [string]$Database = 'master'
    )

    for ($attempt = 1; $attempt -le 40; $attempt++) {
        & docker exec $sqlContainer $sqlcmd `
            -S localhost -U $User -P $Password -d $Database -C -b `
            -Q 'SELECT 1' -o /dev/null 2>$null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 3
    }

    throw "SQL Server did not become ready for $User within 120 seconds."
}

function Start-SqlContainer {
    Invoke-Docker -Arguments @(
        'run', '--detach',
        '--name', $sqlContainer,
        '--hostname', $sqlAlias,
        '--network', $networkName,
        '--network-alias', $sqlAlias,
        '--env', 'ACCEPT_EULA=Y',
        '--env', 'MSSQL_PID=Developer',
        '--env', "MSSQL_SA_PASSWORD=$($passwords.Sa)",
        '--env', 'MSSQL_MEMORY_LIMIT_MB=2048',
        '--env', 'TZ=UTC',
        '--mount', "type=volume,source=$dataVolume,target=/var/opt/mssql",
        '--mount', "type=volume,source=$backupVolume,target=/var/opt/mssql/backups",
        '--memory', '4g',
        '--cpus', '1.25',
        '--shm-size', '512m',
        '--stop-timeout', '90',
        $SqlServerImage
    )
}

function Invoke-Release {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Development', 'Production')][string]$Environment,
        [Parameter(Mandatory = $true)][string]$ConnectionString,
        [Parameter(Mandatory = $true)][ValidateSet('migrate', 'seed-development', 'verify-target')][string]$Command
    )

    $arguments = @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_DATABASE_ENVIRONMENT=$Environment",
        '--env', "ConnectionStrings__ElevantDatabase=$ConnectionString"
    )
    if ($Environment -eq 'Production') {
        $arguments += @('--env', 'ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb')
    }
    if ($Command -eq 'seed-development') {
        $arguments += @('--env', "ELEVANT_DEV_SEED_ACCOUNT_PASSWORD=$($passwords.Demo)")
    }
    $arguments += @($ReleaseImage, $Command)

    Invoke-Docker -Arguments $arguments
}

function Invoke-ProductionBootstrap {
    Invoke-Docker -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--mount', "type=bind,source=$productionBootstrap,target=/tmp/initialize-production.sql,readonly",
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'sa',
        '-P', $passwords.Sa,
        '-C', '-b', '-r', '1',
        '-v', 'CONFIRM_PRODUCTION_DATABASE=ElevantProductionDb',
        '-i', '/tmp/initialize-production.sql'
    )
}

function Invoke-BundleTarget {
    param(
        [Parameter(Mandatory = $true)][string]$ConnectionString,
        [Parameter(Mandatory = $true)][string]$Migration
    )

    Invoke-Docker -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'ELEVANT_DATABASE_ENVIRONMENT=Development',
        '--env', "ConnectionStrings__ElevantDatabase=$ConnectionString",
        '--entrypoint', '/app/efbundle',
        $ReleaseImage,
        $Migration
    )
}

function Invoke-Ops {
    param([Parameter(Mandatory = $true)][ValidateSet('provision-development', 'backup-development', 'restore-check-development', 'verify-development')][string]$Command)

    $arguments = @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias"
    )

    switch ($Command) {
        'provision-development' {
            $arguments += @(
                '--env', "MSSQL_SA_PASSWORD=$($passwords.Sa)",
                '--env', "ELEVANT_DB_DBA_PASSWORD=$($passwords.Dba)",
                '--env', "ELEVANT_DB_MIGRATOR_PASSWORD=$($passwords.Migrator)",
                '--env', "ELEVANT_DB_APP_PASSWORD=$($passwords.App)",
                '--env', "ELEVANT_DB_SEEDER_PASSWORD=$($passwords.Seeder)",
                '--env', "ELEVANT_DB_HEALTH_PASSWORD=$($passwords.Health)",
                '--env', "ELEVANT_DB_BACKUP_PASSWORD=$($passwords.Backup)"
            )
        }
        'backup-development' {
            $arguments += @(
                '--env', "ELEVANT_DB_BACKUP_PASSWORD=$($passwords.Backup)",
                '--env', "ELEVANT_DB_DBA_PASSWORD=$($passwords.Dba)",
                '--mount', "type=volume,source=$backupVolume,target=/var/opt/mssql/backups"
            )
        }
        'restore-check-development' {
            $arguments += @(
                '--env', "ELEVANT_DB_DBA_PASSWORD=$($passwords.Dba)",
                '--mount', "type=volume,source=$backupVolume,target=/var/opt/mssql/backups,readonly"
            )
        }
        'verify-development' {
            $arguments += @('--env', "ELEVANT_DB_DBA_PASSWORD=$($passwords.Dba)")
        }
    }

    $arguments += @($OpsImage, $Command)
    Invoke-Docker -Arguments $arguments
}

function Assert-ImageContract {
    param(
        [Parameter(Mandatory = $true)][string]$Image,
        [string]$Revision,
        [string]$Source
    )

    $json = & docker image inspect $Image | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $json.Count -ne 1) {
        throw "Image $Image is unavailable."
    }
    if ($json[0].Os -ne 'linux' -or $json[0].Architecture -ne 'amd64') {
        throw "Image $Image is not linux/amd64."
    }
    if ([string]::IsNullOrWhiteSpace($json[0].Config.User) -or $json[0].Config.User -in @('0', 'root')) {
        throw "Image $Image does not declare a non-root runtime user."
    }
    if ($Revision) {
        $labels = $json[0].Config.Labels
        if ($null -eq $labels) {
            throw "Image $Image has no OCI revision label."
        }
        $revisionProperty = $labels.PSObject.Properties['org.opencontainers.image.revision']
        if ($null -eq $revisionProperty -or $revisionProperty.Value -ne $Revision) {
            throw "Image $Image was not built from expected revision $Revision."
        }
    }
    if ($Source) {
        $labels = $json[0].Config.Labels
        if ($null -eq $labels) {
            throw "Image $Image has no OCI source label."
        }
        $sourceProperty = $labels.PSObject.Properties['org.opencontainers.image.source']
        if ($null -eq $sourceProperty -or $sourceProperty.Value -ne $Source) {
            throw "Image $Image was not linked to expected source $Source."
        }
    }
}

$productionConnection = "Server=$sqlAlias,1433;Initial Catalog=ElevantProductionDb;User ID=sa;Password=$($passwords.Sa);Encrypt=True;TrustServerCertificate=True"
$developmentMigratorConnection = "Server=$sqlAlias,1433;Initial Catalog=ElevantDevelopmentDb;User ID=elevant_dev_migrator;Password=$($passwords.Migrator);Encrypt=True;TrustServerCertificate=True"
$developmentSeederConnection = "Server=$sqlAlias,1433;Initial Catalog=ElevantDevelopmentDb;User ID=elevant_dev_seeder;Password=$($passwords.Seeder);Encrypt=True;TrustServerCertificate=True"
$productionIntegrityQuery = @'
IF (SELECT COUNT_BIG(*) FROM [infra].[__EFMigrationsHistory]) <> 5
    THROW 53000, 'Production does not contain the five v1 migrations.', 1;

IF (SELECT COUNT_BIG(*) FROM [infra].[database_instances]) <> 1
   OR NOT EXISTS (
       SELECT 1
       FROM [infra].[database_instances]
       WHERE [id] = 1 AND [environment_name] = N'Production'
   )
    THROW 53001, 'Production environment marker is invalid after deployment.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.tables AS tables
    INNER JOIN sys.schemas AS schemas ON schemas.[schema_id] = tables.[schema_id]
    CROSS APPLY (
        SELECT SUM(partitions.[rows]) AS [row_count]
        FROM sys.partitions AS partitions
        WHERE partitions.[object_id] = tables.[object_id]
          AND partitions.[index_id] IN (0, 1)
    ) AS counts
    WHERE schemas.[name] IN (N'iam', N'ref', N'hr', N'commercial', N'ops', N'integration', N'audit')
      AND COALESCE(counts.[row_count], 0) <> 0
)
    THROW 53002, 'Production contains business rows.', 1;
'@
$succeeded = $false

try {
    $dockerInfo = & docker info --format '{{.OSType}}|{{.Architecture}}'
    if ($LASTEXITCODE -ne 0 -or $dockerInfo -ne 'linux|x86_64') {
        throw 'Certification requires a healthy linux/x86_64 Docker engine.'
    }

    Assert-ImageContract -Image $OpsImage -Revision $ExpectedRevision -Source $ExpectedSource
    Assert-ImageContract -Image $ReleaseImage -Revision $ExpectedRevision -Source $ExpectedSource
    Ensure-DockerImage -Image $SqlServerImage
    Assert-ImageContract -Image $SqlServerImage

    Invoke-Docker -Arguments @('network', 'create', '--driver', 'bridge', '--internal', $networkName)
    Invoke-Docker -Arguments @('volume', 'create', $dataVolume)
    Invoke-Docker -Arguments @('volume', 'create', $backupVolume)
    Invoke-Docker -Arguments @(
        'run', '--rm',
        '--network', 'none',
        '--user', '0:0',
        '--cap-drop', 'ALL',
        '--cap-add', 'CHOWN',
        '--cap-add', 'FOWNER',
        '--security-opt', 'no-new-privileges:true',
        '--mount', "type=volume,source=$backupVolume,target=/var/opt/mssql/backups",
        $OpsImage,
        'initialize-backup-storage'
    )
    Start-SqlContainer
    Wait-Sql -User 'sa' -Password $passwords.Sa

    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'master' -Query @'
CREATE DATABASE [ElevantProductionDb];
EXEC [ElevantProductionDb].sys.sp_executesql N'CREATE SCHEMA [infra] AUTHORIZATION [dbo];';
EXEC [ElevantProductionDb].sys.sp_executesql N'
CREATE TABLE [infra].[database_instances]
(
    [id] tinyint NOT NULL PRIMARY KEY,
    [instance_id] uniqueidentifier NOT NULL,
    [environment_name] nvarchar(32) NOT NULL,
    [created_at] datetimeoffset(3) NOT NULL
);';
'@
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Production bootstrap unexpectedly accepted an empty environment marker.' `
        -ExpectedErrorPattern 'Existing database marker is not Production\.' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--mount', "type=bind,source=$productionBootstrap,target=/tmp/initialize-production.sql,readonly",
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'sa',
        '-P', $passwords.Sa,
        '-C', '-b', '-r', '1',
        '-v', 'CONFIRM_PRODUCTION_DATABASE=ElevantProductionDb',
        '-i', '/tmp/initialize-production.sql'
    )
    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'master' -Query @'
IF (SELECT COUNT_BIG(*) FROM [ElevantProductionDb].[infra].[database_instances]) <> 0
    THROW 53009, 'Rejected Production marker validation changed the marker.', 1;
ALTER DATABASE [ElevantProductionDb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [ElevantProductionDb];
'@

    Invoke-ProductionBootstrap
    Invoke-ProductionBootstrap

    Invoke-Release -Environment Production -ConnectionString $productionConnection -Command migrate
    Invoke-Release -Environment Production -ConnectionString $productionConnection -Command verify-target
    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'ElevantProductionDb' -Query $productionIntegrityQuery

    Invoke-DockerExpectedFailure `
        -FailureMessage 'Development seed unexpectedly ran with a declared Production target.' `
        -ExpectedErrorPattern 'The Development seeder is forbidden outside Development\.' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'ELEVANT_DATABASE_ENVIRONMENT=Production',
        '--env', 'ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb',
        '--env', "ELEVANT_DEV_SEED_ACCOUNT_PASSWORD=$($passwords.Demo)",
        '--env', "ConnectionStrings__ElevantDatabase=$productionConnection",
        $ReleaseImage,
        'seed-development'
    )
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Cross-environment database name guard unexpectedly accepted Production as Development.' `
        -ExpectedErrorPattern 'Database target mismatch: Development requires Initial Catalog=ElevantDevelopmentDb\.' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'ELEVANT_DATABASE_ENVIRONMENT=Development',
        '--env', "ELEVANT_DEV_SEED_ACCOUNT_PASSWORD=$($passwords.Demo)",
        '--env', "ConnectionStrings__ElevantDatabase=$productionConnection",
        $ReleaseImage,
        'seed-development'
    )
    Invoke-Release -Environment Production -ConnectionString $productionConnection -Command verify-target
    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'ElevantProductionDb' -Query $productionIntegrityQuery

    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'master' -Query @'
CREATE DATABASE [ElevantDevelopmentDb];
'@
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Development provisioner unexpectedly adopted an unmarked existing database.' `
        -ExpectedErrorPattern 'Existing ElevantDevelopmentDb has no environment marker; refusing to adopt it\.' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias",
        '--env', "MSSQL_SA_PASSWORD=$($passwords.Sa)",
        '--env', "ELEVANT_DB_DBA_PASSWORD=$($passwords.Dba)",
        '--env', "ELEVANT_DB_MIGRATOR_PASSWORD=$($passwords.Migrator)",
        '--env', "ELEVANT_DB_APP_PASSWORD=$($passwords.App)",
        '--env', "ELEVANT_DB_SEEDER_PASSWORD=$($passwords.Seeder)",
        '--env', "ELEVANT_DB_HEALTH_PASSWORD=$($passwords.Health)",
        '--env', "ELEVANT_DB_BACKUP_PASSWORD=$($passwords.Backup)",
        $OpsImage,
        'provision-development'
    )
    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'master' -Query @'
IF OBJECT_ID(N'[ElevantDevelopmentDb].[infra].[database_instances]', N'U') IS NOT NULL
   OR SUSER_ID(N'elevant_dev_dba') IS NOT NULL
    THROW 53007, 'Rejected Development adoption still changed database or login state.', 1;

ALTER DATABASE [ElevantDevelopmentDb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [ElevantDevelopmentDb];
'@

    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'master' -Query "CREATE LOGIN [elevant_dev_dba] WITH PASSWORD = N'$($passwords.DbaWrong)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;"
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Provisioner unexpectedly disabled sa before authenticating the declared Development DBA secret.' `
        -ExpectedErrorPattern 'Declared Development DBA credentials failed verification; sa remains unchanged\.' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias",
        '--env', "MSSQL_SA_PASSWORD=$($passwords.Sa)",
        '--env', "ELEVANT_DB_DBA_PASSWORD=$($passwords.Dba)",
        '--env', "ELEVANT_DB_MIGRATOR_PASSWORD=$($passwords.Migrator)",
        '--env', "ELEVANT_DB_APP_PASSWORD=$($passwords.App)",
        '--env', "ELEVANT_DB_SEEDER_PASSWORD=$($passwords.Seeder)",
        '--env', "ELEVANT_DB_HEALTH_PASSWORD=$($passwords.Health)",
        '--env', "ELEVANT_DB_BACKUP_PASSWORD=$($passwords.Backup)",
        $OpsImage,
        'provision-development'
    )
    Invoke-SqlClient -User 'sa' -Password $passwords.Sa -Database 'master' -Query "IF EXISTS (SELECT 1 FROM sys.sql_logins WHERE [name] = N'sa' AND [is_disabled] = 1) THROW 53008, 'sa was disabled before DBA authentication succeeded.', 1; ALTER LOGIN [elevant_dev_dba] WITH PASSWORD = N'$($passwords.Dba)';"

    Invoke-Ops -Command provision-development
    Invoke-Ops -Command provision-development
    Invoke-Release -Environment Development -ConnectionString $developmentMigratorConnection -Command verify-target
    Invoke-BundleTarget -ConnectionString $developmentMigratorConnection -Migration '20260817201608_V1_03_WorkforceCommercial'
    Invoke-SqlClient -User 'elevant_dev_migrator' -Password $passwords.Migrator -Database 'ElevantDevelopmentDb' -Query @'
IF (SELECT COUNT_BIG(*) FROM [infra].[__EFMigrationsHistory]) <> 3
    THROW 53006, 'The controlled upgrade baseline does not contain exactly three migrations.', 1;
'@

    Invoke-SqlClient -User 'elevant_dev_seeder' -Password $passwords.Seeder -Database 'ElevantDevelopmentDb' -Query @'
IF EXISTS (SELECT 1 FROM [iam].[organizations] WHERE [code] = N'CERT-SENTINEL')
    THROW 53002, 'Certification sentinel unexpectedly already exists.', 1;

INSERT INTO [iam].[organizations] ([code], [legal_name], [display_name], [type], [status], [public_id])
VALUES (N'CERT-SENTINEL', N'Certification Sentinel', N'Certification Sentinel', N'Internal', N'Active', CONVERT(uniqueidentifier, N'90000000-0000-7000-8000-000000000001'));
'@

    Invoke-Release -Environment Development -ConnectionString $developmentMigratorConnection -Command migrate
    Invoke-Release -Environment Development -ConnectionString $developmentMigratorConnection -Command verify-target
    Invoke-Release -Environment Development -ConnectionString $developmentSeederConnection -Command seed-development
    Invoke-Release -Environment Development -ConnectionString $developmentSeederConnection -Command seed-development
    Invoke-SqlClient -User 'elevant_dev_seeder' -Password $passwords.Seeder -Database 'ElevantDevelopmentDb' -Query @'
IF (SELECT COUNT_BIG(*) FROM [iam].[organizations] WHERE [code] = N'CERT-SENTINEL' AND [public_id] = CONVERT(uniqueidentifier, N'90000000-0000-7000-8000-000000000001')) <> 1
    THROW 53003, 'The second seed removed or duplicated the certification sentinel.', 1;
'@

    Invoke-Ops -Command verify-development
    Invoke-SqlClient -User 'elevant_dev_app' -Password $passwords.App -Database 'ElevantDevelopmentDb' -Query @'
IF NOT EXISTS (SELECT 1 FROM [infra].[database_instances] WHERE [id] = 1 AND [environment_name] = N'Development')
    THROW 53005, 'Application login could not read the Development marker.', 1;
'@
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Application login unexpectedly changed the immutable marker.' `
        -ExpectedErrorPattern 'UPDATE permission was denied' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_app',
        '-P', $passwords.App,
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', "UPDATE [infra].[database_instances] SET [environment_name] = N'Production' WHERE [id] = 1;"
    )

    Invoke-Ops -Command backup-development
    $backupArtifacts = @(
        & docker run --rm `
            --network none `
            --mount "type=volume,source=$backupVolume,target=/var/opt/mssql/backups,readonly" `
            --entrypoint /usr/bin/find `
            $OpsImage `
            /var/opt/mssql/backups -maxdepth 1 -type f -printf '%f\n'
    )
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the certified backup volume.'
    }
    if ($backupArtifacts.Count -ne 1 -or $backupArtifacts[0] -notmatch '^ElevantDevelopmentDb_[0-9]{8}T[0-9]{15}Z_[0-9a-f]{12}\.bak$') {
        throw 'Backup was not atomically published with the exact approved name.'
    }
    Invoke-Ops -Command restore-check-development
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query @'
IF EXISTS (
    SELECT 1
    FROM sys.databases
    WHERE [name] = N'ElevantDevelopmentRestoreCheck'
       OR [name] LIKE N'ElevantDevelopmentRestoreCheck[_]%'
)
    THROW 53004, 'A restore-check temporary database was not removed.', 1;
'@

    Invoke-Docker -Arguments @('stop', '--timeout', '90', $sqlContainer)
    Invoke-Docker -Arguments @('rm', $sqlContainer)
    Start-SqlContainer
    Invoke-Ops -Command provision-development
    Wait-Sql -User 'elevant_dev_health' -Password $passwords.Health -Database 'ElevantDevelopmentDb'
    Invoke-Ops -Command verify-development

    $succeeded = $true
}
finally {
    if ($resourcePrefix -notmatch '^elevant-cert-[0-9a-f]{12}$') {
        throw 'Refusing cleanup because the certification resource prefix is invalid.'
    }

    $cleanupFailures = [System.Collections.Generic.List[string]]::new()
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if (-not $succeeded) {
            & docker logs --tail 80 $sqlContainer 2>$null
        }

        & docker rm --force $sqlContainer 2>$null | Out-Null
        & docker volume rm $dataVolume 2>$null | Out-Null
        & docker volume rm $backupVolume 2>$null | Out-Null
        & docker network rm $networkName 2>$null | Out-Null

        $cleanupChecks = @(
            @('container', 'inspect', $sqlContainer),
            @('volume', 'inspect', $dataVolume),
            @('volume', 'inspect', $backupVolume),
            @('network', 'inspect', $networkName)
        )
        foreach ($check in $cleanupChecks) {
            & docker @check 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $cleanupFailures.Add($check[-1])
            }
        }
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($cleanupFailures.Count -gt 0) {
        throw "Certification cleanup left Docker resources: $($cleanupFailures -join ', ')."
    }
}

if ($succeeded) {
    Invoke-Docker -Arguments @(
        'image', 'inspect', $OpsImage, $ReleaseImage,
        '--format', '{{index .RepoTags 0}}|{{.Id}}|{{.Size}}|{{.Config.User}}|{{.Os}}/{{.Architecture}}'
    )
    Write-Output "PASS: database container certification completed and removed isolated resources $resourcePrefix."
}
