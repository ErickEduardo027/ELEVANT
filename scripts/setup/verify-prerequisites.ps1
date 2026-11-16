[CmdletBinding(PositionalBinding = $false)]
param(
    [switch]$RequireDocker,
    [switch]$RequireNode
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$failures = New-Object System.Collections.Generic.List[string]

function Test-CommandAvailable {
    param([Parameter(Mandatory = $true)][string]$Name)

    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host 'Comprobando prerrequisitos de Elevant...'

if (-not (Test-CommandAvailable -Name 'git')) {
    $failures.Add('Git no esta disponible en PATH.')
}
else {
    Write-Host ('[OK] Git: {0}' -f (& git --version))
}

if (-not (Test-CommandAvailable -Name 'dotnet')) {
    $failures.Add('.NET SDK no esta disponible en PATH.')
}
else {
    Push-Location $repositoryRoot
    try {
        $dotnetVersion = (& dotnet --version)
        if ($LASTEXITCODE -ne 0) {
            $failures.Add('No se pudo resolver el SDK definido por global.json.')
        }
        elseif ($dotnetVersion -notmatch '^10\.') {
            $failures.Add("global.json resolvio .NET $dotnetVersion; se requiere .NET 10.x.")
        }
        else {
            Write-Host ("[OK] .NET SDK: {0}" -f $dotnetVersion)
        }
    }
    finally {
        Pop-Location
    }
}

if (Test-CommandAvailable -Name 'docker') {
    & docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host '[OK] Docker Compose v2 esta disponible.'
    }
    elseif ($RequireDocker) {
        $failures.Add('Docker existe, pero Docker Compose v2 no esta disponible.')
    }
    else {
        Write-Warning 'Docker Compose v2 no esta disponible; solo es necesario para contenedores.'
    }
}
elseif ($RequireDocker) {
    $failures.Add('Docker no esta disponible en PATH.')
}
else {
    Write-Warning 'Docker no esta disponible; no impide compilar ni probar el backend.'
}

$nodeAvailable = Test-CommandAvailable -Name 'node'
$corepackAvailable = Test-CommandAvailable -Name 'corepack'
if ($nodeAvailable -and $corepackAvailable) {
    Write-Host '[OK] Node.js y Corepack estan disponibles.'
}
elseif ($RequireNode) {
    $failures.Add('Node.js y Corepack son obligatorios para esta ejecucion.')
}
else {
    Write-Warning 'Node.js/Corepack aun no estan completos; solo son necesarios para web o movil.'
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) {
        Write-Error $failure
    }

    exit 1
}

Write-Host 'Todos los prerrequisitos obligatorios estan disponibles.'
