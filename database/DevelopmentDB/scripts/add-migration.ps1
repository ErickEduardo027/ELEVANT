[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_]*$')]
    [string]$Name
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$connectionValue = [System.Environment]::GetEnvironmentVariable('ConnectionStrings__ElevantDatabase')
if ([string]::IsNullOrWhiteSpace($connectionValue)) {
    throw 'Configure ConnectionStrings__ElevantDatabase con Initial Catalog=ElevantDevelopmentDb.'
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$solution = 'backend/Elevant.sln'
$persistenceProject = 'database/DevelopmentDB/Elevant.Persistence/Elevant.Persistence.csproj'
$startupProject = 'backend/Elevant.Api/Elevant.Api.csproj'
$previousDatabaseEnvironment = $env:ELEVANT_DATABASE_ENVIRONMENT

Push-Location $repositoryRoot
try {
    $env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'

    & dotnet tool restore
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet tool restore finalizó con código $LASTEXITCODE."
    }

    & dotnet restore $solution --locked-mode
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet restore finalizó con código $LASTEXITCODE."
    }

    & dotnet ef migrations add $Name `
        --project $persistenceProject `
        --startup-project $startupProject `
        --context ElevantDbContext `
        --configuration Release `
        --output-dir Persistence/Migrations

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet ef migrations add finalizó con código $LASTEXITCODE."
    }

    & dotnet ef migrations has-pending-model-changes `
        --project $persistenceProject `
        --startup-project $startupProject `
        --context ElevantDbContext `
        --configuration Release

    if ($LASTEXITCODE -ne 0) {
        throw 'El modelo aún tiene cambios sin migración.'
    }
}
finally {
    if ($null -eq $previousDatabaseEnvironment) {
        Remove-Item Env:ELEVANT_DATABASE_ENVIRONMENT -ErrorAction SilentlyContinue
    }
    else {
        $env:ELEVANT_DATABASE_ENVIRONMENT = $previousDatabaseEnvironment
    }

    Pop-Location
}
