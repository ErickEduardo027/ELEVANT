[CmdletBinding(PositionalBinding = $false)]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git es necesario para identificar los archivos no ignorados.'
}

$relativeFiles = @(& git -C $repositoryRoot ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo obtener la lista de archivos de Git.'
}

$rules = @(
    [PSCustomObject]@{ Name = 'private-key'; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' },
    [PSCustomObject]@{ Name = 'github-token'; Pattern = '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}' },
    [PSCustomObject]@{ Name = 'github-fine-grained-token'; Pattern = 'github_pat_[A-Za-z0-9_]{30,}' },
    [PSCustomObject]@{ Name = 'aws-access-key'; Pattern = '(?:AKIA|ASIA)[A-Z0-9]{16}' },
    [PSCustomObject]@{ Name = 'slack-token'; Pattern = 'xox[baprs]-[A-Za-z0-9-]{20,}' },
    [PSCustomObject]@{ Name = 'connection-string-password'; Pattern = '(?i)(?:Password|Pwd)\s*=\s*(?!\$\{|%|\{|<|REPLACE|CHANGE[_-]?ME|CHANGEME|PLACEHOLDER)[^;\s"'']{8,}' },
    [PSCustomObject]@{ Name = 'secret-assignment'; Pattern = '(?i)(?:api[_-]?key|client[_-]?secret|flightaware[_-]?(?:key|token)|secret[_-]?key)\s*[:=]\s*["'']?(?!\$\{|\$env:|<|REPLACE|CHANGE[_-]?ME|CHANGEME|YOUR[_-]|EXAMPLE|PLACEHOLDER)[A-Za-z0-9_+\-/=]{12,}' }
)

$findings = New-Object System.Collections.Generic.List[string]

foreach ($relativeFile in $relativeFiles) {
    $fullPath = Join-Path $repositoryRoot $relativeFile
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        continue
    }

    $fileInfo = Get-Item -LiteralPath $fullPath
    if ($fileInfo.Length -gt 2MB) {
        continue
    }

    foreach ($rule in $rules) {
        $matches = @(Select-String -LiteralPath $fullPath -Pattern $rule.Pattern -AllMatches -ErrorAction SilentlyContinue)
        foreach ($match in $matches) {
            $findings.Add(('{0}:{1}: {2}' -f $relativeFile, $match.LineNumber, $rule.Name))
        }
    }
}

if ($findings.Count -gt 0) {
    Write-Error 'Se detectaron posibles secretos. Por seguridad no se muestran los valores.'
    $findings | Sort-Object -Unique | ForEach-Object { Write-Host $_ }
    exit 1
}

Write-Host ("No se detectaron secretos en {0} archivos no ignorados." -f $relativeFiles.Count)
