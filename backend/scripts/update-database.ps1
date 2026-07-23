[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Development', 'Testing', 'Production')]
    [string]$Environment,

    [string]$TargetMigration,

    [switch]$AllowProduction
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$connectionVariable = Get-Item -LiteralPath 'Env:ConnectionStrings__ElevantDatabase' -ErrorAction SilentlyContinue
if ($null -eq $connectionVariable -or [string]::IsNullOrWhiteSpace($connectionVariable.Value)) {
    throw 'Configure ConnectionStrings__ElevantDatabase en el entorno antes de actualizar una base.'
}

if ($Environment -eq 'Production') {
    if (-not $AllowProduction) {
        throw 'Production requiere el switch -AllowProduction.'
    }

    $requiredConfirmation = 'UPDATE ELEVANT PRODUCTION'
    $confirmation = Read-Host "Escriba exactamente '$requiredConfirmation' para continuar"
    if ($confirmation -cne $requiredConfirmation) {
        throw 'La confirmacion de Production no coincide; no se realizo ningun cambio.'
    }
}

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$infrastructureProject = 'src/Elevant.Infrastructure/Elevant.Infrastructure.csproj'
$startupProject = 'src/Elevant.Api/Elevant.Api.csproj'
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT

Push-Location $backendRoot
try {
    $env:ASPNETCORE_ENVIRONMENT = $Environment

    & dotnet tool restore
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet tool restore finalizo con codigo $LASTEXITCODE."
    }

    $arguments = @(
        'ef', 'database', 'update'
    )

    if (-not [string]::IsNullOrWhiteSpace($TargetMigration)) {
        $arguments += $TargetMigration
    }

    $arguments += @(
        '--project', $infrastructureProject,
        '--startup-project', $startupProject,
        '--context', 'ElevantDbContext'
    )

    & dotnet @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet ef database update finalizo con codigo $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousEnvironment) {
        Remove-Item Env:ASPNETCORE_ENVIRONMENT -ErrorAction SilentlyContinue
    }
    else {
        $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
    }

    Pop-Location
}
