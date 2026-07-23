[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Invoke-DotNet {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & dotnet @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet finalizo con codigo $LASTEXITCODE."
    }
}

Push-Location $backendRoot
try {
    Invoke-DotNet -Arguments @('tool', 'restore')
    Invoke-DotNet -Arguments @('restore', 'Elevant.sln', '--locked-mode')
    Invoke-DotNet -Arguments @('build', 'Elevant.sln', '--configuration', $Configuration, '--no-restore')

    $testResults = Join-Path $backendRoot 'TestResults'
    if (-not (Test-Path -LiteralPath $testResults)) {
        New-Item -ItemType Directory -Path $testResults | Out-Null
    }

    Invoke-DotNet -Arguments @(
        'test',
        'Elevant.sln',
        '--configuration', $Configuration,
        '--no-build',
        '--logger', 'trx',
        '--results-directory', $testResults
    )
}
finally {
    Pop-Location
}
