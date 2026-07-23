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
    throw 'Configure ConnectionStrings__ElevantDatabase en el entorno antes de crear una migracion.'
}

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$infrastructureProject = 'src/Elevant.Infrastructure/Elevant.Infrastructure.csproj'
$startupProject = 'src/Elevant.Api/Elevant.Api.csproj'

Push-Location $backendRoot
try {
    & dotnet tool restore
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet tool restore finalizo con codigo $LASTEXITCODE."
    }

    & dotnet ef migrations add $Name `
        --project $infrastructureProject `
        --startup-project $startupProject `
        --context ElevantDbContext `
        --output-dir Persistence/Migrations

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet ef migrations add finalizo con codigo $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
