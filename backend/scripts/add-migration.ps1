[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_]*$')]
    [string]$Name
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$connectionVariable = Get-Item -LiteralPath 'Env:ConnectionStrings__ElevantDatabase' -ErrorAction SilentlyContinue
if ($null -eq $connectionVariable -or [string]::IsNullOrWhiteSpace($connectionVariable.Value)) {
    throw 'Configure ConnectionStrings__ElevantDatabase con Initial Catalog=ElevantDevelopmentDb.'
}

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$infrastructureProject = 'src/Elevant.Infrastructure/Elevant.Infrastructure.csproj'
$startupProject = 'src/Elevant.Api/Elevant.Api.csproj'
$previousDatabaseEnvironment = $env:ELEVANT_DATABASE_ENVIRONMENT

Push-Location $backendRoot
try {
    $env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'

    & dotnet tool restore
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet tool restore finalizó con código $LASTEXITCODE."
    }

    & dotnet restore Elevant.sln --locked-mode
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet restore finalizó con código $LASTEXITCODE."
    }

    & dotnet ef migrations add $Name `
        --project $infrastructureProject `
        --startup-project $startupProject `
        --context ElevantDbContext `
        --configuration Release `
        --output-dir Persistence/Migrations

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet ef migrations add finalizó con código $LASTEXITCODE."
    }

    & dotnet ef migrations has-pending-model-changes `
        --project $infrastructureProject `
        --startup-project $startupProject `
        --context ElevantDbContext `
        --configuration Release `
        --no-build

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
