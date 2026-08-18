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
    [PSCustomObject]@{ Name = 'tailscale-auth-key'; Pattern = 'tskey-(?:auth|client|api|webhook|scim)-[A-Za-z0-9_-]{20,}' },
    [PSCustomObject]@{ Name = 'telegram-bot-url'; Pattern = 'telegram://[0-9]{6,12}:[A-Za-z0-9_-]{30,}@telegram' },
    [PSCustomObject]@{ Name = 'healthchecks-ping-url'; Pattern = 'https://hc-ping\.com/[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27,}' },
    [PSCustomObject]@{ Name = 'beszel-agent-token'; Pattern = '(?i)BESZEL_AGENT_TOKEN\s*[:=]\s*["'']?(?!\$\{|\$env:|<|REPLACE|CHANGE[_-]?ME|CHANGEME|YOUR[_-]|EXAMPLE|PLACEHOLDER)[A-Za-z0-9._~+/=-]{12,}' },
    [PSCustomObject]@{ Name = 'sensitive-variable-assignment'; Pattern = '(?m)^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:PASSWORD|PWD|TOKEN|AUTH[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*["'']?(?!\$\{|\$env:|\$\(\$[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\)|\$\([A-Za-z_][A-Za-z0-9_]*\)|%|\{|<|REPLACE|CHANGE[_-]?ME|CHANGEME|YOUR[_-]|EXAMPLE|PLACEHOLDER|CI[_-]?(?:ONLY|Only)|DESIGN[_-]?ONLY|SYNTHETIC|NOT[_-]?A[_-]?SECRET)[^\s"''#;]{12,}' },
    [PSCustomObject]@{ Name = 'connection-string-password'; Pattern = '(?i)(?:^|;)\s*(?:Password|Pwd)\s*=\s*(?!\$\{|\$\(\$[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\)|%|\{|<|REPLACE|CHANGE[_-]?ME|CHANGEME|PLACEHOLDER|CI[_-]?ONLY|DESIGN[_-]?ONLY|SYNTHETIC|NOT[_-]?A[_-]?SECRET)[^;\s"'']{8,}' },
    [PSCustomObject]@{ Name = 'secret-assignment'; Pattern = '(?i)(?:api[_-]?key|client[_-]?secret|flightaware[_-]?(?:key|token)|secret[_-]?key)\s*[:=]\s*["'']?(?!\$\{|\$env:|<|REPLACE|CHANGE[_-]?ME|CHANGEME|YOUR[_-]|EXAMPLE|PLACEHOLDER)[A-Za-z0-9_+\-/=]{12,}' }
)

$rulesByName = @{}
foreach ($rule in $rules) {
    $rulesByName[$rule.Name] = $rule.Pattern
}

$ruleSelfTests = @(
    [PSCustomObject]@{
        Rule = 'tailscale-auth-key'
        Value = ('tskey-' + 'auth-' + ('A' * 32))
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'telegram-bot-url'
        Value = ('telegram://' + ('1' * 9) + ':' + ('A' * 35) + '@telegram?chats=1')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'healthchecks-ping-url'
        Value = ('https://hc-ping.com/' + '11111111-1111-1111-1111-111111111111')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('BESZEL_AGENT_' + 'TOKEN=' + ('A' * 32))
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('BESZEL_AGENT_' + 'TOKEN=REPLACE_WITH_SYSTEM_TOKEN_FROM_BESZEL')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('MSSQL_SA_' + 'PASSWORD=' + ('A' * 32))
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${ELEVANT_DB_DBA_PASSWORD:?required}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=REPLACE_WITH_RANDOM_PASSWORD')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=$($passwords.Dba)')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=' + ('A' * 20) + ';Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=$($passwords.Sa);Encrypt=True')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=$([char]65' + ('A' * 20) + ');Encrypt=True')
        ShouldMatch = $true
    }
)

foreach ($selfTest in $ruleSelfTests) {
    $actual = [regex]::IsMatch($selfTest.Value, $rulesByName[$selfTest.Rule])
    if ($actual -ne $selfTest.ShouldMatch) {
        throw ('Falló el self-test de la regla {0}.' -f $selfTest.Rule)
    }
}

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
        $matches = @(Select-String -LiteralPath $fullPath -Pattern $rule.Pattern -AllMatches -CaseSensitive -ErrorAction SilentlyContinue)
        foreach ($match in $matches) {
            $findings.Add(('{0}:{1}: {2}' -f $relativeFile, $match.LineNumber, $rule.Name))
        }
    }
}

if ($findings.Count -gt 0) {
    Write-Host 'Se detectaron posibles secretos. Solo se muestran archivo, línea y regla; nunca el valor.' -ForegroundColor Red
    $findings | Sort-Object -Unique | ForEach-Object { Write-Host $_ }
    exit 1
}

Write-Host ("No se detectaron secretos en {0} archivos no ignorados." -f $relativeFiles.Count)
