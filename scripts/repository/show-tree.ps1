[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateRange(1, 30)]
    [int]$MaxDepth = 12,

    [string]$OutputFile
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$excludedNames = @('.git', '.vs', '.vscode', '.idea', 'bin', 'obj', 'node_modules', 'TestResults')
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add((Split-Path $repositoryRoot -Leaf))

function Add-TreeItems {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Prefix,
        [Parameter(Mandatory = $true)][int]$Depth
    )

    if ($Depth -ge $MaxDepth) {
        return
    }

    $items = @(
        Get-ChildItem -LiteralPath $Path -Force |
            Where-Object { $excludedNames -notcontains $_.Name } |
            Sort-Object @{ Expression = { -not $_.PSIsContainer } }, Name
    )

    for ($index = 0; $index -lt $items.Count; $index++) {
        $item = $items[$index]
        $isLast = $index -eq ($items.Count - 1)
        $branch = if ($isLast) { '`-- ' } else { '|-- ' }
        $lines.Add("$Prefix$branch$($item.Name)")

        $isReparsePoint = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
        if ($item.PSIsContainer -and -not $isReparsePoint) {
            $childPrefix = if ($isLast) { "$Prefix    " } else { "$Prefix|   " }
            Add-TreeItems -Path $item.FullName -Prefix $childPrefix -Depth ($Depth + 1)
        }
    }
}

Add-TreeItems -Path $repositoryRoot -Prefix '' -Depth 0

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $lines
}
else {
    $resolvedOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFile)
    $lines | Set-Content -LiteralPath $resolvedOutput -Encoding UTF8
    Write-Host "Arbol escrito en $resolvedOutput"
}
