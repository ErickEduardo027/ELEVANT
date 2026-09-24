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

$developmentDatabaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $developmentDatabaseRoot '../..')).Path
$defaultProductionBootstrap = Join-Path $developmentDatabaseRoot 'tests/scripts/fixtures/initialize-production.sql'

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
$certAdminLogin = "elevant_cert_sysadmin_$suffix"
if ($certAdminLogin -notmatch '^elevant_cert_sysadmin_[0-9a-f]{12}$') {
    throw 'The generated certification administrator login is not safe.'
}

$passwords = @{
    Sa = "CertSa-Aa1!$suffix"
    Dba = "CertDba-Aa1!$suffix"
    DbaWrong = "CertWrongDba-Aa1!$suffix"
    Migrator = "CertMigrator-Aa1!$suffix"
    App = "CertApp-Aa1!$suffix"
    Seeder = "CertSeeder-Aa1!$suffix"
    Health = "CertHealth-Aa1!$suffix"
    Backup = "CertBackup-Aa1!$suffix"
    DemoAdmin = "CertDemoAdmin-Aa1!$suffix"
    DemoAdminRotated = "CertDemoAdmin-Bb2!$suffix"
    DemoRamp = "CertDemoRamp-Aa1!$suffix"
    DemoAirline = "CertDemoAirline-Aa1!$suffix"
    DemoHumanResources = "CertDemoHumanResources-Aa1!$suffix"
    TeamErick = "CertTeamErick-Aa1!$suffix"
    TeamEliezer = "CertTeamEliezer-Aa1!$suffix"
    TeamLaisha = "CertTeamLaisha-Aa1!$suffix"
    TeamErickRotated = "CertTeamErick-Bb2!$suffix"
    TeamEliezerRotated = "CertTeamEliezer-Bb2!$suffix"
    TeamLaishaRotated = "CertTeamLaisha-Bb2!$suffix"
    TeamErickRejected = "CertTeamErick-Cc3!$suffix"
    TeamEliezerRejected = "CertTeamEliezer-Cc3!$suffix"
    TeamLaishaRejected = "CertTeamLaisha-Cc3!$suffix"
    CertAdmin = "CertAdmin-Dd4!$suffix"
}

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments[0]) failed with exit code $LASTEXITCODE."
    }
}

function Invoke-DockerWithSqlcmdPassword {
    param(
        [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Password,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $passwordWasPresent = Test-Path Env:SQLCMDPASSWORD
    $previousPassword = $env:SQLCMDPASSWORD
    try {
        $env:SQLCMDPASSWORD = $Password
        Invoke-Docker -Arguments $Arguments
    }
    finally {
        if ($passwordWasPresent) {
            $env:SQLCMDPASSWORD = $previousPassword
        }
        else {
            Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-WithScopedEnvironment {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Environment,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    $previousValues = @{}
    $presentVariables = @{}
    try {
        foreach ($name in $Environment.Keys) {
            $presentVariables[$name] = Test-Path -LiteralPath "Env:$name"
            if ($presentVariables[$name]) {
                $previousValues[$name] = (Get-Item -LiteralPath "Env:$name").Value
            }
            Set-Item -LiteralPath "Env:$name" -Value $Environment[$name]
        }

        & $Action
    }
    finally {
        foreach ($name in $Environment.Keys) {
            if ($presentVariables[$name]) {
                Set-Item -LiteralPath "Env:$name" -Value $previousValues[$name]
            }
            else {
                Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
            }
        }
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
        [Parameter(Mandatory = $true)][string]$ExpectedErrorPattern,
        [string]$SqlcmdPassword
    )

    $previousPreference = $ErrorActionPreference
    $passwordWasPresent = Test-Path Env:SQLCMDPASSWORD
    $previousPassword = $env:SQLCMDPASSWORD
    $useSqlcmdPassword = $PSBoundParameters.ContainsKey('SqlcmdPassword')
    $ErrorActionPreference = 'Continue'
    try {
        if ($useSqlcmdPassword) {
            $env:SQLCMDPASSWORD = $SqlcmdPassword
        }
        $output = (& docker @Arguments 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($useSqlcmdPassword) {
            if ($passwordWasPresent) {
                $env:SQLCMDPASSWORD = $previousPassword
            }
            else {
                Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
            }
        }
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

    Invoke-DockerWithSqlcmdPassword -Password $Password -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', $User,
        '-d', $Database,
        '-C', '-b', '-I', '-r', '1',
        '-Q', $Query
    )
}

function Invoke-SqlScalar {
    param(
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$Query
    )

    $output = @(Invoke-DockerWithSqlcmdPassword -Password $Password -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', $User,
        '-d', $Database,
        '-C', '-b', '-r', '1',
        '-h', '-1', '-w', '65535', '-y', '8000',
        '-Q', $Query
    ))

    $values = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne '' })
    if ($values.Count -ne 1) {
        throw 'SQL scalar query did not return exactly one value.'
    }

    return $values[0]
}

function Assert-SqlLoginRejected {
    param(
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password
    )

    Invoke-DockerExpectedFailure `
        -FailureMessage "SQL login $User unexpectedly authenticated with a rejected credential or state." `
        -ExpectedErrorPattern "Login failed for user '$([regex]::Escape($User))'" `
        -SqlcmdPassword $Password `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', $User,
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', 'SELECT 1;'
    )
}

function New-CertificationAdmin {
    # SQLCMD reads the generated password from its inherited scripting-variable
    # environment. Docker and sqlcmd argv contain only the variable name.
    $scopedEnvironment = @{}
    $scopedEnvironment['SQLCMDPASSWORD'] = $passwords.Sa
    $scopedEnvironment['ELEVANT_CERT_ADMIN_PASSWORD'] = $passwords.CertAdmin
    $query = "CREATE LOGIN [$certAdminLogin] WITH PASSWORD = N'`$(ELEVANT_CERT_ADMIN_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF; ALTER SERVER ROLE [sysadmin] ADD MEMBER [$certAdminLogin];"

    Invoke-WithScopedEnvironment -Environment $scopedEnvironment -Action {
        Invoke-Docker -Arguments @(
            'exec',
            '--env', 'SQLCMDPASSWORD',
            '--env', 'ELEVANT_CERT_ADMIN_PASSWORD',
            $sqlContainer,
            $sqlcmd,
            '-S', 'localhost',
            '-U', 'sa',
            '-d', 'master',
            '-C', '-b', '-r', '1',
            '-Q', $query
        )
    }
}

function Invoke-WithCertificationAdmin {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    # Base provisioning has already disabled sa. Privileged drift fixtures use
    # the isolated, ephemeral certifier login and never reopen sa.
    Assert-SqlLoginRejected -User 'sa' -Password $passwords.Sa
    try {
        & $Action
    }
    finally {
        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'master' -Query "ALTER SERVER ROLE [sysadmin] DROP MEMBER [$certAdminLogin];"
        Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query "DROP LOGIN [$certAdminLogin]; IF SUSER_ID(N'$certAdminLogin') IS NOT NULL THROW 53027, 'The ephemeral certification administrator still exists.', 1;"
        Assert-SqlLoginRejected -User $certAdminLogin -Password $passwords.CertAdmin
        Assert-SqlLoginRejected -User 'sa' -Password $passwords.Sa
    }
}

function Wait-Sql {
    param(
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password,
        [string]$Database = 'master'
    )

    $passwordWasPresent = Test-Path Env:SQLCMDPASSWORD
    $previousPassword = $env:SQLCMDPASSWORD
    try {
        $env:SQLCMDPASSWORD = $Password
        for ($attempt = 1; $attempt -le 40; $attempt++) {
            & docker exec --env SQLCMDPASSWORD $sqlContainer $sqlcmd `
                -S localhost -U $User -d $Database -C -b `
                -Q 'SELECT 1' -o /dev/null 2>$null
            if ($LASTEXITCODE -eq 0) {
                return
            }
            Start-Sleep -Seconds 3
        }
    }
    finally {
        if ($passwordWasPresent) {
            $env:SQLCMDPASSWORD = $previousPassword
        }
        else {
            Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
        }
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
        [Parameter(Mandatory = $true)][ValidateSet('migrate', 'seed-development', 'verify-target')][string]$Command,
        [switch]$UseRotatedAdminPassword
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
        $adminPassword = if ($UseRotatedAdminPassword) {
            $passwords.DemoAdminRotated
        }
        else {
            $passwords.DemoAdmin
        }
        $arguments += @(
            '--env', "ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD=$adminPassword",
            '--env', "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD=$($passwords.DemoRamp)",
            '--env', "ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD=$($passwords.DemoAirline)",
            '--env', "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD=$($passwords.DemoHumanResources)"
        )
    }
    $arguments += @($ReleaseImage, $Command)

    Invoke-Docker -Arguments $arguments
}

function Invoke-ProductionBootstrap {
    Invoke-DockerWithSqlcmdPassword -Password $passwords.Sa -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--mount', "type=bind,source=$productionBootstrap,target=/tmp/initialize-production.sql,readonly",
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'sa',
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
    param([Parameter(Mandatory = $true)][ValidateSet('provision-development', 'provision-development-team-access', 'install-development-diagram-support', 'backup-development', 'restore-check-development', 'verify-development')][string]$Command)

    $arguments = @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias"
    )
    $scopedEnvironment = @{}

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
        'provision-development-team-access' {
            $arguments += @(
                '--env', 'ELEVANT_DB_DBA_PASSWORD',
                '--env', 'ELEVANT_DB_TEAM_ERICK_PASSWORD',
                '--env', 'ELEVANT_DB_TEAM_ELIEZER_PASSWORD',
                '--env', 'ELEVANT_DB_TEAM_LAISHA_PASSWORD'
            )
            $scopedEnvironment['ELEVANT_DB_DBA_PASSWORD'] = $passwords.Dba
            $scopedEnvironment['ELEVANT_DB_TEAM_ERICK_PASSWORD'] = $passwords.TeamErick
            $scopedEnvironment['ELEVANT_DB_TEAM_ELIEZER_PASSWORD'] = $passwords.TeamEliezer
            $scopedEnvironment['ELEVANT_DB_TEAM_LAISHA_PASSWORD'] = $passwords.TeamLaisha
        }
        'install-development-diagram-support' {
            $arguments += @('--env', 'ELEVANT_DB_DBA_PASSWORD')
            $scopedEnvironment['ELEVANT_DB_DBA_PASSWORD'] = $passwords.Dba
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
    if ($scopedEnvironment.Count -eq 0) {
        Invoke-Docker -Arguments $arguments
    }
    else {
        Invoke-WithScopedEnvironment -Environment $scopedEnvironment -Action {
            Invoke-Docker -Arguments $arguments
        }
    }
}

function Invoke-TeamProvisionExpectedFailure {
    param(
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [Parameter(Mandatory = $true)][string]$ExpectedErrorPattern
    )

    $arguments = @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias",
        '--env', 'ELEVANT_DB_DBA_PASSWORD',
        '--env', 'ELEVANT_DB_TEAM_ERICK_PASSWORD',
        '--env', 'ELEVANT_DB_TEAM_ELIEZER_PASSWORD',
        '--env', 'ELEVANT_DB_TEAM_LAISHA_PASSWORD',
        $OpsImage,
        'provision-development-team-access'
    )
    $scopedEnvironment = @{}
    $scopedEnvironment['ELEVANT_DB_DBA_PASSWORD'] = $passwords.Dba
    $scopedEnvironment['ELEVANT_DB_TEAM_ERICK_PASSWORD'] = $passwords.TeamErick
    $scopedEnvironment['ELEVANT_DB_TEAM_ELIEZER_PASSWORD'] = $passwords.TeamEliezer
    $scopedEnvironment['ELEVANT_DB_TEAM_LAISHA_PASSWORD'] = $passwords.TeamLaisha

    Invoke-WithScopedEnvironment -Environment $scopedEnvironment -Action {
        Invoke-DockerExpectedFailure `
            -Arguments $arguments `
            -FailureMessage $FailureMessage `
            -ExpectedErrorPattern $ExpectedErrorPattern
    }
}

function Invoke-DiagramInstallExpectedFailure {
    param(
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [Parameter(Mandatory = $true)][string]$ExpectedErrorPattern
    )

    $arguments = @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias",
        '--env', 'ELEVANT_DB_DBA_PASSWORD',
        $OpsImage,
        'install-development-diagram-support'
    )
    $scopedEnvironment = @{}
    $scopedEnvironment['ELEVANT_DB_DBA_PASSWORD'] = $passwords.Dba
    Invoke-WithScopedEnvironment -Environment $scopedEnvironment -Action {
        Invoke-DockerExpectedFailure `
            -Arguments $arguments `
            -FailureMessage $FailureMessage `
            -ExpectedErrorPattern $ExpectedErrorPattern
    }
}

function Invoke-DevelopmentVerifyExpectedFailure {
    param(
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [Parameter(Mandatory = $true)][string]$ExpectedErrorPattern
    )

    $arguments = @(
        'run', '--rm',
        '--network', $networkName,
        '--env', "ELEVANT_SQL_SERVER=$sqlAlias",
        '--env', 'ELEVANT_DB_DBA_PASSWORD',
        $OpsImage,
        'verify-development'
    )
    $scopedEnvironment = @{}
    $scopedEnvironment['ELEVANT_DB_DBA_PASSWORD'] = $passwords.Dba
    Invoke-WithScopedEnvironment -Environment $scopedEnvironment -Action {
        Invoke-DockerExpectedFailure `
            -Arguments $arguments `
            -FailureMessage $FailureMessage `
            -ExpectedErrorPattern $ExpectedErrorPattern
    }
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
$migrationDirectory = Join-Path $developmentDatabaseRoot 'Elevant.Persistence/Persistence/Migrations'
$migrationSources = @(Get-ChildItem -LiteralPath $migrationDirectory -File -Filter '*.cs' |
    Where-Object { $_.Name -ne 'ElevantDbContextModelSnapshot.cs' -and $_.Name -notlike '*.Designer.cs' })
if ($migrationSources.Count -eq 0 -or @($migrationSources |
    Where-Object { $_.BaseName -notmatch '^[0-9]{14}_[A-Za-z0-9_]+$' }).Count -ne 0) {
    throw 'The reviewed EF migration source set is missing or contains an unexpected filename.'
}
$expectedMigrationIds = @($migrationSources | ForEach-Object { $_.BaseName } | Sort-Object -Unique)
if ($expectedMigrationIds.Count -ne $migrationSources.Count) {
    throw 'The reviewed EF migration source set contains duplicate identifiers.'
}
$expectedMigrationValues = ($expectedMigrationIds | ForEach-Object { "    (N'$_')" }) -join ",`n"
$productionIntegrityQuery = @"
IF (SELECT COUNT_BIG(*) FROM [infra].[__EFMigrationsHistory]) <> $($expectedMigrationIds.Count)
   OR EXISTS (
       SELECT history.[MigrationId]
       FROM [infra].[__EFMigrationsHistory] AS history
       EXCEPT
       SELECT expected.[MigrationId]
       FROM (VALUES
$expectedMigrationValues
       ) AS expected([MigrationId])
   )
    THROW 53000, 'Production migrations differ from the reviewed EF source.', 1;

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
"@
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
        -SqlcmdPassword $passwords.Sa `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--mount', "type=bind,source=$productionBootstrap,target=/tmp/initialize-production.sql,readonly",
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'sa',
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
        '--env', "ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD=$($passwords.DemoAdmin)",
        '--env', "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD=$($passwords.DemoRamp)",
        '--env', "ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD=$($passwords.DemoAirline)",
        '--env', "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD=$($passwords.DemoHumanResources)",
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
        '--env', "ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD=$($passwords.DemoAdmin)",
        '--env', "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD=$($passwords.DemoRamp)",
        '--env', "ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD=$($passwords.DemoAirline)",
        '--env', "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD=$($passwords.DemoHumanResources)",
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

    New-CertificationAdmin
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

    Invoke-DockerExpectedFailure `
        -FailureMessage 'Development seed unexpectedly accepted a deployment placeholder.' `
        -ExpectedErrorPattern 'must not contain deployment placeholder text' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'ELEVANT_DATABASE_ENVIRONMENT=Development',
        '--env', 'ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD=REPLACE_ME_AdminAccount!2026',
        '--env', "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD=$($passwords.DemoRamp)",
        '--env', "ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD=$($passwords.DemoAirline)",
        '--env', "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD=$($passwords.DemoHumanResources)",
        '--env', "ConnectionStrings__ElevantDatabase=$developmentSeederConnection",
        $ReleaseImage,
        'seed-development'
    )
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Development seed unexpectedly accepted a shared account secret.' `
        -ExpectedErrorPattern 'must use four distinct passwords' `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'ELEVANT_DATABASE_ENVIRONMENT=Development',
        '--env', "ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD=$($passwords.DemoAdmin)",
        '--env', "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD=$($passwords.DemoAdmin)",
        '--env', "ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD=$($passwords.DemoAirline)",
        '--env', "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD=$($passwords.DemoHumanResources)",
        '--env', "ConnectionStrings__ElevantDatabase=$developmentSeederConnection",
        $ReleaseImage,
        'seed-development'
    )

    $allCredentialStateQuery = @'
SET NOCOUNT ON;
SELECT STRING_AGG(
    CONVERT(nvarchar(max), CONCAT([normalized_email], N'=', [password_hash], N'|', [security_stamp])),
    N';'
) WITHIN GROUP (ORDER BY [normalized_email])
FROM [iam].[accounts]
WHERE [normalized_email] IN (
    N'ADMIN.OCC@DEV.ELEVANT.TEST',
    N'RAMP.AGENT@DEV.ELEVANT.TEST',
    N'AIRLINE.CLIENT@DEV.ELEVANT.TEST',
    N'GESTION.HUMANA@DEV.ELEVANT.TEST'
);
'@
    $adminCredentialStateQuery = @'
SET NOCOUNT ON;
SELECT CONCAT([password_hash], N'|', [security_stamp])
FROM [iam].[accounts]
WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';
'@
    $nonAdminCredentialStateQuery = @'
SET NOCOUNT ON;
SELECT STRING_AGG(
    CONVERT(nvarchar(max), CONCAT([normalized_email], N'=', [password_hash], N'|', [security_stamp])),
    N';'
) WITHIN GROUP (ORDER BY [normalized_email])
FROM [iam].[accounts]
WHERE [normalized_email] IN (
    N'RAMP.AGENT@DEV.ELEVANT.TEST',
    N'AIRLINE.CLIENT@DEV.ELEVANT.TEST',
    N'GESTION.HUMANA@DEV.ELEVANT.TEST'
);
'@

    Invoke-Release -Environment Development -ConnectionString $developmentSeederConnection -Command seed-development
    $credentialsBeforeRepeat = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $allCredentialStateQuery
    Invoke-Release -Environment Development -ConnectionString $developmentSeederConnection -Command seed-development
    $credentialsAfterRepeat = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $allCredentialStateQuery
    if ($credentialsAfterRepeat -cne $credentialsBeforeRepeat) {
        throw 'Repeating the Development seed unexpectedly rehashed an unchanged account password.'
    }

    Invoke-SqlClient -User 'elevant_dev_seeder' -Password $passwords.Seeder -Database 'ElevantDevelopmentDb' -Query @'
IF (SELECT COUNT_BIG(*) FROM [iam].[organizations] WHERE [code] = N'CERT-SENTINEL' AND [public_id] = CONVERT(uniqueidentifier, N'90000000-0000-7000-8000-000000000001')) <> 1
    THROW 53003, 'The second seed removed or duplicated the certification sentinel.', 1;
'@

    Invoke-SqlClient -User 'elevant_dev_migrator' -Password $passwords.Migrator -Database 'ElevantDevelopmentDb' -Query @'
UPDATE [iam].[accounts]
SET [lockout_enabled] = CONVERT(bit, 0),
    [access_failed_count] = 4,
    [lockout_end] = CONVERT(datetimeoffset, N'2099-12-30T12:34:56+00:00')
WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';
'@
    Invoke-Release -Environment Development -ConnectionString $developmentSeederConnection -Command seed-development
    $credentialsAfterLockoutRepair = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $allCredentialStateQuery
    if ($credentialsAfterLockoutRepair -cne $credentialsBeforeRepeat) {
        throw 'Lockout hardening unexpectedly rehashed an unchanged account password.'
    }
    Invoke-SqlClient -User 'elevant_dev_seeder' -Password $passwords.Seeder -Database 'ElevantDevelopmentDb' -Query @'
IF NOT EXISTS (
    SELECT 1
    FROM [iam].[accounts]
    WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST'
      AND [lockout_enabled] = CONVERT(bit, 1)
      AND [access_failed_count] = 4
      AND [lockout_end] = CONVERT(datetimeoffset, N'2099-12-30T12:34:56+00:00')
)
    THROW 53024, 'Credential hardening reset or unlocked the synthetic account.', 1;
'@

    Invoke-DockerExpectedFailure `
        -FailureMessage 'Seeder unexpectedly obtained direct UPDATE on iam.accounts.' `
        -ExpectedErrorPattern 'UPDATE permission was denied' `
        -SqlcmdPassword $passwords.Seeder `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_seeder',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-I', '-r', '1',
        '-Q', "UPDATE [iam].[accounts] SET [lockout_enabled] = 0 WHERE [normalized_email] = N'ADMIN.OCC@DEV.ELEVANT.TEST';"
    )
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Restricted credential procedure unexpectedly accepted an unrelated email.' `
        -ExpectedErrorPattern 'Credential rotation is restricted to synthetic Development accounts' `
        -SqlcmdPassword $passwords.Seeder `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_seeder',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', "EXEC [iam].[set_development_account_credential] N'OUTSIDER@DEV.ELEVANT.TEST', '49999999-0000-7000-8000-000000000999', NULL, NULL;"
    )

    $adminCredentialBeforeRotation = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $adminCredentialStateQuery
    $nonAdminCredentialsBeforeRotation = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $nonAdminCredentialStateQuery
    Invoke-Release `
        -Environment Development `
        -ConnectionString $developmentSeederConnection `
        -Command seed-development `
        -UseRotatedAdminPassword
    $adminCredentialAfterRotation = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $adminCredentialStateQuery
    $nonAdminCredentialsAfterRotation = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $nonAdminCredentialStateQuery
    if ($adminCredentialAfterRotation -ceq $adminCredentialBeforeRotation) {
        throw 'Rotating the admin Development secret did not change its stored credential state.'
    }
    if ($nonAdminCredentialsAfterRotation -cne $nonAdminCredentialsBeforeRotation) {
        throw 'Rotating the admin Development secret changed another synthetic account.'
    }

    $credentialsAfterRotation = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $allCredentialStateQuery
    Invoke-Release `
        -Environment Development `
        -ConnectionString $developmentSeederConnection `
        -Command seed-development `
        -UseRotatedAdminPassword
    $credentialsAfterRotatedRepeat = Invoke-SqlScalar `
        -User 'elevant_dev_seeder' `
        -Password $passwords.Seeder `
        -Database 'ElevantDevelopmentDb' `
        -Query $allCredentialStateQuery
    if ($credentialsAfterRotatedRepeat -cne $credentialsAfterRotation) {
        throw 'Repeating the rotated Development seed unexpectedly rehashed an account password.'
    }

    Invoke-Ops -Command verify-development
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
CREATE USER [elevant_dev_erick] WITHOUT LOGIN;
'@
    Invoke-DevelopmentVerifyExpectedFailure `
        -FailureMessage 'Development verification unexpectedly skipped partial team-access artifacts.' `
        -ExpectedErrorPattern 'artifacts are partial; refusing to skip verification'
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
DROP USER [elevant_dev_erick];
'@

    Invoke-Ops -Command provision-development-team-access
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query @'
ALTER LOGIN [elevant_dev_laisha] DISABLE;
'@
    Invoke-Ops -Command provision-development-team-access
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query @'
IF NOT EXISTS (
    SELECT 1
    FROM sys.sql_logins
    WHERE [name] = N'elevant_dev_laisha'
      AND [is_disabled] = 1
      AND [is_policy_checked] = 1
      AND [is_expiration_checked] = 0
)
    THROW 53015, 'Team provisioning did not preserve explicit login offboarding.', 1;
'@
    Assert-SqlLoginRejected -User 'elevant_dev_laisha' -Password $passwords.TeamLaisha
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query @'
ALTER LOGIN [elevant_dev_laisha] ENABLE;
'@

    $initialTeamPasswords = @{
        elevant_dev_erick = $passwords.TeamErick
        elevant_dev_eliezer = $passwords.TeamEliezer
        elevant_dev_laisha = $passwords.TeamLaisha
    }
    $passwords.TeamErick = $passwords.TeamErickRotated
    $passwords.TeamEliezer = $passwords.TeamEliezerRotated
    $passwords.TeamLaisha = $passwords.TeamLaishaRotated
    Invoke-Ops -Command provision-development-team-access

    foreach ($login in $initialTeamPasswords.Keys) {
        Assert-SqlLoginRejected -User $login -Password $initialTeamPasswords[$login]
    }

    Invoke-WithCertificationAdmin -Action {
        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'master' -Query @'
CREATE SERVER ROLE [elevant_team_forbidden_role] AUTHORIZATION [elevant_dev_erick];
'@
        Invoke-TeamProvisionExpectedFailure `
            -FailureMessage 'Team provisioning unexpectedly accepted server-role ownership.' `
            -ExpectedErrorPattern 'owns a forbidden server securable'
        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'master' -Query @'
DROP SERVER ROLE [elevant_team_forbidden_role];
'@
        Invoke-Ops -Command provision-development-team-access

        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'master' -Query @'
CREATE DATABASE [ElevantTeamAccessOther];
'@
        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'ElevantTeamAccessOther' -Query @'
CREATE USER [unexpected_erick_mapping] FOR LOGIN [elevant_dev_erick];
ALTER ROLE [db_owner] ADD MEMBER [unexpected_erick_mapping];
'@
        Invoke-Ops -Command provision-development-team-access
        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'ElevantTeamAccessOther' -Query @'
IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE [name] = N'unexpected_erick_mapping'
)
    THROW 53020, 'The external test mapping unexpectedly disappeared instead of becoming orphaned.', 1;

IF EXISTS (
    SELECT 1
    FROM sys.database_principals AS users
    INNER JOIN master.sys.server_principals AS logins
        ON logins.[sid] = users.[sid]
    WHERE users.[name] = N'unexpected_erick_mapping'
      AND logins.[name] = N'elevant_dev_erick'
)
    THROW 53021, 'Login SID replacement did not neutralize the external database mapping.', 1;
'@
        Invoke-DockerExpectedFailure `
            -FailureMessage 'A reconciled team login unexpectedly retained access to another database.' `
            -ExpectedErrorPattern 'Cannot open database|Login failed' `
            -SqlcmdPassword $passwords.TeamErick `
            -Arguments @(
            'run', '--rm',
            '--network', $networkName,
            '--env', 'SQLCMDPASSWORD',
            '--entrypoint', $sqlcmd,
            $SqlServerImage,
            '-S', "$sqlAlias,1433",
            '-U', 'elevant_dev_erick',
            '-d', 'ElevantTeamAccessOther',
            '-C', '-b', '-r', '1',
            '-Q', 'SELECT 1;'
        )
        Invoke-SqlClient -User $certAdminLogin -Password $passwords.CertAdmin -Database 'master' -Query @'
ALTER DATABASE [ElevantTeamAccessOther] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [ElevantTeamAccessOther];
'@
    }
    Invoke-Ops -Command provision-development-team-access

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
GRANT CONTROL TO [elevant_dev_team_editor];
'@
    $teamSidsBeforeRejectedReconciliation = Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query @'
SET NOCOUNT ON;
SELECT [name], CONVERT(varchar(170), [sid], 2) AS [sid]
FROM sys.sql_logins
WHERE [name] IN (N'elevant_dev_erick', N'elevant_dev_eliezer', N'elevant_dev_laisha')
ORDER BY [name];
'@
    $teamSidsBeforeRejectedReconciliation = ($teamSidsBeforeRejectedReconciliation | Out-String).Trim()

    $acceptedTeamPasswords = @{
        elevant_dev_erick = $passwords.TeamErick
        elevant_dev_eliezer = $passwords.TeamEliezer
        elevant_dev_laisha = $passwords.TeamLaisha
    }
    $passwords.TeamErick = $passwords.TeamErickRejected
    $passwords.TeamEliezer = $passwords.TeamEliezerRejected
    $passwords.TeamLaisha = $passwords.TeamLaishaRejected
    try {
        Invoke-TeamProvisionExpectedFailure `
            -FailureMessage 'Team provisioning unexpectedly accepted a privileged role grant.' `
            -ExpectedErrorPattern 'role permission set is not exact'
    }
    finally {
        $rejectedTeamPasswords = @{
            elevant_dev_erick = $passwords.TeamErick
            elevant_dev_eliezer = $passwords.TeamEliezer
            elevant_dev_laisha = $passwords.TeamLaisha
        }
        $passwords.TeamErick = $acceptedTeamPasswords.elevant_dev_erick
        $passwords.TeamEliezer = $acceptedTeamPasswords.elevant_dev_eliezer
        $passwords.TeamLaisha = $acceptedTeamPasswords.elevant_dev_laisha
    }

    $teamSidsAfterRejectedReconciliation = Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'master' -Query @'
SET NOCOUNT ON;
SELECT [name], CONVERT(varchar(170), [sid], 2) AS [sid]
FROM sys.sql_logins
WHERE [name] IN (N'elevant_dev_erick', N'elevant_dev_eliezer', N'elevant_dev_laisha')
ORDER BY [name];
'@
    $teamSidsAfterRejectedReconciliation = ($teamSidsAfterRejectedReconciliation | Out-String).Trim()
    if ($teamSidsAfterRejectedReconciliation -ne $teamSidsBeforeRejectedReconciliation) {
        throw 'Rejected team reconciliation did not roll back all login SIDs.'
    }
    foreach ($login in $rejectedTeamPasswords.Keys) {
        Assert-SqlLoginRejected -User $login -Password $rejectedTeamPasswords[$login]
        Invoke-SqlClient -User $login -Password $acceptedTeamPasswords[$login] -Database 'ElevantDevelopmentDb' -Query 'SELECT 1;'
    }

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
REVOKE CONTROL FROM [elevant_dev_team_editor];
'@
    Invoke-Ops -Command provision-development-team-access

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
CREATE VIEW [ops].[team_access_forbidden_view]
AS
    SELECT [id], [environment_name]
    FROM [infra].[database_instances];
'@
    Invoke-TeamProvisionExpectedFailure `
        -FailureMessage 'Team provisioning unexpectedly accepted a view inside a CRUD schema.' `
        -ExpectedErrorPattern 'CRUD schema contains a non-table executable or mutable object'
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
DROP VIEW [ops].[team_access_forbidden_view];
'@
    Invoke-Ops -Command provision-development-team-access

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
CREATE TABLE [ops].[team_access_cascade_parent]
(
    [id] int NOT NULL CONSTRAINT [PK_team_access_cascade_parent] PRIMARY KEY
);
CREATE TABLE [audit].[team_access_cascade_child]
(
    [id] int NOT NULL CONSTRAINT [PK_team_access_cascade_child] PRIMARY KEY,
    [parent_id] int NOT NULL,
    CONSTRAINT [FK_team_access_cascade_child_parent]
        FOREIGN KEY ([parent_id])
        REFERENCES [ops].[team_access_cascade_parent] ([id])
        ON DELETE CASCADE
);
'@
    Invoke-TeamProvisionExpectedFailure `
        -FailureMessage 'Team provisioning unexpectedly accepted a cascade into a protected schema.' `
        -ExpectedErrorPattern 'cascading foreign key permits an editable table to mutate a protected schema'
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
DROP TABLE [audit].[team_access_cascade_child];
DROP TABLE [ops].[team_access_cascade_parent];
'@
    Invoke-Ops -Command provision-development-team-access

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
CREATE TABLE [ops].[team_access_temporal_probe]
(
    [id] int NOT NULL CONSTRAINT [PK_team_access_temporal_probe] PRIMARY KEY,
    [value] int NOT NULL,
    [valid_from] datetime2 GENERATED ALWAYS AS ROW START HIDDEN
        CONSTRAINT [DF_team_access_temporal_probe_valid_from] DEFAULT SYSUTCDATETIME(),
    [valid_to] datetime2 GENERATED ALWAYS AS ROW END HIDDEN
        CONSTRAINT [DF_team_access_temporal_probe_valid_to]
        DEFAULT CONVERT(datetime2, N'9999-12-31 23:59:59.9999999'),
    PERIOD FOR SYSTEM_TIME ([valid_from], [valid_to])
)
WITH (
    SYSTEM_VERSIONING = ON (
        HISTORY_TABLE = [infra].[team_access_temporal_probe_history],
        DATA_CONSISTENCY_CHECK = ON
    )
);
'@
    Invoke-DevelopmentVerifyExpectedFailure `
        -FailureMessage 'Development verification unexpectedly accepted protected temporal history.' `
        -ExpectedErrorPattern 'editable temporal or ledger table writes history into a protected schema'
    Invoke-TeamProvisionExpectedFailure `
        -FailureMessage 'Team provisioning unexpectedly accepted protected temporal history.' `
        -ExpectedErrorPattern 'editable temporal or ledger table writes history into a protected schema'
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
ALTER TABLE [ops].[team_access_temporal_probe] SET (SYSTEM_VERSIONING = OFF);
DROP TABLE [ops].[team_access_temporal_probe];
DROP TABLE [infra].[team_access_temporal_probe_history];
'@
    Invoke-Ops -Command provision-development-team-access

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
CREATE TABLE [ops].[team_access_certification]
(
    [id] int NOT NULL CONSTRAINT [PK_team_access_certification] PRIMARY KEY,
    [value] nvarchar(32) NOT NULL
);
'@
    Invoke-SqlClient -User 'elevant_dev_erick' -Password $passwords.TeamErick -Database 'ElevantDevelopmentDb' -Query @'
INSERT INTO [ops].[team_access_certification] ([id], [value]) VALUES (1, N'created');
IF (SELECT [value] FROM [ops].[team_access_certification] WHERE [id] = 1) <> N'created'
    THROW 53016, 'Team editor SELECT or INSERT behavior failed.', 1;
UPDATE [ops].[team_access_certification] SET [value] = N'updated' WHERE [id] = 1;
IF (SELECT [value] FROM [ops].[team_access_certification] WHERE [id] = 1) <> N'updated'
    THROW 53017, 'Team editor UPDATE behavior failed.', 1;
DELETE FROM [ops].[team_access_certification] WHERE [id] = 1;
IF EXISTS (SELECT 1 FROM [ops].[team_access_certification])
    THROW 53018, 'Team editor DELETE behavior failed.', 1;
'@
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Team editor unexpectedly changed a functional table definition.' `
        -ExpectedErrorPattern 'permission was denied|do(?:es)? not have permissions?' `
        -SqlcmdPassword $passwords.TeamErick `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_erick',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', 'ALTER TABLE [ops].[team_access_certification] ADD [forbidden] int NULL;'
    )
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Team editor unexpectedly changed the immutable Development marker.' `
        -ExpectedErrorPattern 'UPDATE permission was denied' `
        -SqlcmdPassword $passwords.TeamErick `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_erick',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', "UPDATE [infra].[database_instances] SET [environment_name] = N'Production' WHERE [id] = 1;"
    )
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Team editor unexpectedly mutated EF migration history.' `
        -ExpectedErrorPattern 'DELETE permission was denied' `
        -SqlcmdPassword $passwords.TeamErick `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_erick',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', 'DELETE FROM [infra].[__EFMigrationsHistory] WHERE 1 = 0;'
    )
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
DROP TABLE [ops].[team_access_certification];
'@

    Invoke-SqlClient -User 'elevant_dev_erick' -Password $passwords.TeamErick -Database 'ElevantDevelopmentDb' -Query @'
IF IS_ROLEMEMBER(N'elevant_dev_team_editor') <> 1
    THROW 53009, 'The certified Erick login is not a team editor.', 1;

IF HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'SELECT') <> 1
   OR HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'INSERT') <> 1
   OR HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'UPDATE') <> 1
   OR HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'DELETE') <> 1
   OR HAS_PERMS_BY_NAME(N'ops', N'SCHEMA', N'ALTER') <> 0
   OR HAS_PERMS_BY_NAME(N'infra.database_instances', N'OBJECT', N'SELECT') <> 1
   OR HAS_PERMS_BY_NAME(N'infra.database_instances', N'OBJECT', N'UPDATE') <> 0
   OR HAS_PERMS_BY_NAME(N'infra.__EFMigrationsHistory', N'OBJECT', N'DELETE') <> 0
   OR HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE TABLE') <> 0
    THROW 53010, 'The certified team editor permission boundary is invalid.', 1;
'@

    Invoke-Ops -Command install-development-diagram-support
    Invoke-Ops -Command install-development-diagram-support

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
GRANT EXECUTE ON OBJECT::[dbo].[sp_helpdiagrams] TO [public];
GRANT EXECUTE ON OBJECT::[dbo].[sp_creatediagram] TO [elevant_dev_app];
'@
    Invoke-DiagramInstallExpectedFailure `
        -FailureMessage 'Diagram installation unexpectedly accepted a positive third-party grant.' `
        -ExpectedErrorPattern 'unexpected positive permission for another principal'
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
IF NOT EXISTS (
    SELECT 1
    FROM sys.database_permissions
    WHERE [class] = 1
      AND [major_id] = OBJECT_ID(N'dbo.sp_helpdiagrams')
      AND [grantee_principal_id] = DATABASE_PRINCIPAL_ID(N'public')
      AND [permission_name] = N'EXECUTE'
      AND [state] IN (N'G', N'W')
)
    THROW 53023, 'Failed diagram installation did not roll back its public REVOKE.', 1;

REVOKE EXECUTE ON OBJECT::[dbo].[sp_helpdiagrams] FROM [public];
REVOKE EXECUTE ON OBJECT::[dbo].[sp_creatediagram] FROM [elevant_dev_app];
'@
    Invoke-Ops -Command install-development-diagram-support

    # CREATE OR ALTER preserves explicit ownership. Adopt a deliberately
    # hostile owner and prove the installer restores schema ownership before
    # editors use the EXECUTE AS dbo modules.
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
ALTER AUTHORIZATION ON OBJECT::[dbo].[sp_helpdiagrams] TO [elevant_dev_app];
IF NOT EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE [object_id] = OBJECT_ID(N'dbo.sp_helpdiagrams')
      AND [principal_id] = DATABASE_PRINCIPAL_ID(N'elevant_dev_app')
)
    THROW 53024, 'The diagram ownership drift probe was not installed.', 1;
'@
    Invoke-Ops -Command install-development-diagram-support
    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
IF EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE [object_id] = OBJECT_ID(N'dbo.sp_helpdiagrams')
      AND [principal_id] IS NOT NULL
)
    THROW 53025, 'Diagram installation did not restore schema ownership.', 1;
'@
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Application login retained ALTER through stale diagram ownership.' `
        -ExpectedErrorPattern 'ALTER permission was denied|do(?:es)? not have permissions?' `
        -SqlcmdPassword $passwords.App `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_app',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', 'ALTER PROCEDURE [dbo].[sp_helpdiagrams] AS SELECT 1 AS [forbidden];'
    )

    Invoke-DockerExpectedFailure `
        -FailureMessage 'A team editor unexpectedly executed the DBA-only diagram upgrader.' `
        -ExpectedErrorPattern 'EXECUTE permission was denied|do(?:es)? not have permissions?' `
        -SqlcmdPassword $passwords.TeamErick `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_erick',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', 'EXEC [dbo].[sp_upgraddiagrams];'
    )

    Invoke-SqlClient -User 'elevant_dev_erick' -Password $passwords.TeamErick -Database 'ElevantDevelopmentDb' -Query @'
IF [dbo].[fn_diagramobjects]() <> 255
    THROW 53019, 'The team editor could not inspect the installed SSMS diagram contract.', 1;

DECLARE @diagram_id int;
EXEC @diagram_id = [dbo].[sp_creatediagram]
    @diagramname = N'certification-erick',
    @version = 1,
    @definition = 0x0102;
IF @diagram_id <= 0
    THROW 53011, 'The team editor could not create its own diagram.', 1;
'@

    # Reconciliation replaces the server SID but remaps the existing database
    # principal, so a personal diagram must remain owned by the same editor.
    Invoke-Ops -Command provision-development-team-access

    Invoke-SqlClient -User 'elevant_dev_dba' -Password $passwords.Dba -Database 'ElevantDevelopmentDb' -Query @'
IF (
    SELECT COUNT_BIG(*)
    FROM [dbo].[sysdiagrams]
    WHERE [principal_id] = DATABASE_PRINCIPAL_ID(N'elevant_dev_erick')
      AND [name] = N'certification-erick'
) <> 1
    THROW 53022, 'Login reconciliation did not preserve personal diagram ownership.', 1;
'@

    Invoke-SqlClient -User 'elevant_dev_erick' -Password $passwords.TeamErick -Database 'ElevantDevelopmentDb' -Query @'
CREATE TABLE #help
(
    [Database] sysname,
    [Name] sysname,
    [ID] int,
    [Owner] sysname,
    [OwnerID] int
);
INSERT INTO #help
EXEC [dbo].[sp_helpdiagrams] @diagramname = N'certification-erick';
IF (
    SELECT COUNT_BIG(*)
    FROM #help
    WHERE [Name] = N'certification-erick'
      AND [Owner] = N'elevant_dev_erick'
) <> 1
    THROW 53012, 'The diagram help contract did not return the owned diagram.', 1;

EXEC [dbo].[sp_renamediagram]
    @diagramname = N'certification-erick',
    @new_diagramname = N'certification-erick-renamed';
EXEC [dbo].[sp_alterdiagram]
    @diagramname = N'certification-erick-renamed',
    @version = 2,
    @definition = 0x0304;

CREATE TABLE #definition ([version] int, [definition] varbinary(max));
INSERT INTO #definition
EXEC [dbo].[sp_helpdiagramdefinition]
    @diagramname = N'certification-erick-renamed';
IF NOT EXISTS (SELECT 1 FROM #definition WHERE [version] = 2 AND [definition] = 0x0304)
    THROW 53013, 'The diagram definition contract did not preserve the update.', 1;
'@

    Invoke-DockerExpectedFailure `
        -FailureMessage 'A team editor unexpectedly opened another editor owned diagram.' `
        -ExpectedErrorPattern 'Diagram does not exist or you do not have permission\.' `
        -SqlcmdPassword $passwords.TeamEliezer `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_eliezer',
        '-d', 'ElevantDevelopmentDb',
        '-C', '-b', '-r', '1',
        '-Q', "DECLARE @owner_id int = DATABASE_PRINCIPAL_ID(N'elevant_dev_erick'); EXEC [dbo].[sp_helpdiagramdefinition] @diagramname = N'certification-erick-renamed', @owner_id = @owner_id;"
    )

    Invoke-SqlClient -User 'elevant_dev_erick' -Password $passwords.TeamErick -Database 'ElevantDevelopmentDb' -Query @'
EXEC [dbo].[sp_dropdiagram] @diagramname = N'certification-erick-renamed';
CREATE TABLE #remaining
(
    [Database] sysname,
    [Name] sysname,
    [ID] int,
    [Owner] sysname,
    [OwnerID] int
);
INSERT INTO #remaining
EXEC [dbo].[sp_helpdiagrams] @diagramname = N'certification-erick-renamed';
IF EXISTS (SELECT 1 FROM #remaining)
    THROW 53014, 'The owned diagram was not deleted.', 1;
'@

    Invoke-Ops -Command verify-development
    Invoke-SqlClient -User 'elevant_dev_app' -Password $passwords.App -Database 'ElevantDevelopmentDb' -Query @'
IF NOT EXISTS (SELECT 1 FROM [infra].[database_instances] WHERE [id] = 1 AND [environment_name] = N'Development')
    THROW 53005, 'Application login could not read the Development marker.', 1;
'@
    Invoke-DockerExpectedFailure `
        -FailureMessage 'Application login unexpectedly changed the immutable marker.' `
        -ExpectedErrorPattern 'UPDATE permission was denied' `
        -SqlcmdPassword $passwords.App `
        -Arguments @(
        'run', '--rm',
        '--network', $networkName,
        '--env', 'SQLCMDPASSWORD',
        '--entrypoint', $sqlcmd,
        $SqlServerImage,
        '-S', "$sqlAlias,1433",
        '-U', 'elevant_dev_app',
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
    Invoke-SqlClient -User 'elevant_dev_erick' -Password $passwords.TeamErick -Database 'ElevantDevelopmentDb' -Query 'SELECT 1;'

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
