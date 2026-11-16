[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Development', 'Production')]
    [string]$Environment,

    [switch]$AllowProduction
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$connectionVariable = Get-Item -LiteralPath 'Env:ConnectionStrings__ElevantDatabase' -ErrorAction SilentlyContinue
if ($null -eq $connectionVariable -or [string]::IsNullOrWhiteSpace($connectionVariable.Value)) {
    throw 'Configure ConnectionStrings__ElevantDatabase antes de actualizar una base.'
}

if ($Environment -eq 'Production') {
    if (-not $AllowProduction) {
        throw 'Production requiere el switch -AllowProduction.'
    }

    $requiredConfirmation = 'MIGRATE ElevantProductionDb SCHEMA ONLY'
    $confirmation = Read-Host "Escriba exactamente '$requiredConfirmation' para continuar"
    if ($confirmation -cne $requiredConfirmation) {
        throw 'La confirmación de Production no coincide; no se realizó ningún cambio.'
    }
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$solution = 'backend/Elevant.sln'
$persistenceProject = 'database/DevelopmentDB/Elevant.Persistence/Elevant.Persistence.csproj'
$startupProject = 'backend/Elevant.Api/Elevant.Api.csproj'
$databaseToolProject = 'database/DevelopmentDB/Elevant.DatabaseTool/Elevant.DatabaseTool.csproj'
$previousAspNetEnvironment = $env:ASPNETCORE_ENVIRONMENT
$previousDatabaseEnvironment = $env:ELEVANT_DATABASE_ENVIRONMENT
$previousProductionConfirmation = $env:ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE

Push-Location $repositoryRoot
try {
    $env:ASPNETCORE_ENVIRONMENT = $Environment
    $env:ELEVANT_DATABASE_ENVIRONMENT = $Environment

    if ($Environment -eq 'Production') {
        $env:ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE = 'ElevantProductionDb'
    }
    else {
        Remove-Item Env:ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE -ErrorAction SilentlyContinue
    }

    & dotnet tool restore
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet tool restore finalizó con código $LASTEXITCODE."
    }

    & dotnet restore $solution --locked-mode
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet restore finalizó con código $LASTEXITCODE."
    }

    & dotnet build $solution --configuration Release --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet build finalizó con código $LASTEXITCODE."
    }

    & dotnet run --project $databaseToolProject --configuration Release --no-build -- verify-target
    if ($LASTEXITCODE -ne 0) {
        throw "La verificación del destino finalizó con código $LASTEXITCODE."
    }

    & dotnet ef database update `
        --project $persistenceProject `
        --startup-project $startupProject `
        --context ElevantDbContext `
        --configuration Release `
        --no-build

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet ef database update finalizó con código $LASTEXITCODE."
    }

    & dotnet run --project $databaseToolProject --configuration Release --no-build -- verify-target
    if ($LASTEXITCODE -ne 0) {
        throw "La verificación posterior finalizó con código $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousAspNetEnvironment) { Remove-Item Env:ASPNETCORE_ENVIRONMENT -ErrorAction SilentlyContinue }
    else { $env:ASPNETCORE_ENVIRONMENT = $previousAspNetEnvironment }

    if ($null -eq $previousDatabaseEnvironment) { Remove-Item Env:ELEVANT_DATABASE_ENVIRONMENT -ErrorAction SilentlyContinue }
    else { $env:ELEVANT_DATABASE_ENVIRONMENT = $previousDatabaseEnvironment }

    if ($null -eq $previousProductionConfirmation) { Remove-Item Env:ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE -ErrorAction SilentlyContinue }
    else { $env:ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE = $previousProductionConfirmation }

    Pop-Location
}
