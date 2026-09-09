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

$environmentVariableNamePattern = '[A-Za-z_][A-Za-z0-9_]*'
$exactEnvironmentReferencePattern = '(?:\$\{' + $environmentVariableNamePattern + '(?::\?[^}\r\n]*)?\}|\$\$\{' + $environmentVariableNamePattern + '\})'
$shellVariableReferencePattern = '\$' + $environmentVariableNamePattern
$githubExpressionPattern = '\$\{\{\s*' + $environmentVariableNamePattern + '(?:\.' + $environmentVariableNamePattern + ')+\s*\}\}'
$powershellEnvironmentReferencePattern = '(?i:\$env:)' + $environmentVariableNamePattern
$powershellPropertyReferencePattern = '\$\(\$' + $environmentVariableNamePattern + '(?:\.' + $environmentVariableNamePattern + ')+\)'
$simpleCommandReferencePattern = '\$\(' + $environmentVariableNamePattern + '\)'
$percentEnvironmentReferencePattern = '%' + $environmentVariableNamePattern + '%'
$javascriptEnvironmentReferencePattern = '(?:process\.env|import\.meta\.env)\.' + $environmentVariableNamePattern
$exactDynamicReferencePattern = '(?:' + (
    $exactEnvironmentReferencePattern,
    $shellVariableReferencePattern,
    $githubExpressionPattern,
    $powershellEnvironmentReferencePattern,
    $powershellPropertyReferencePattern,
    $simpleCommandReferencePattern,
    $percentEnvironmentReferencePattern,
    $javascriptEnvironmentReferencePattern -join '|'
) + ')'
$quotedExactDynamicReferencePattern = '(?:' + $exactDynamicReferencePattern + '|"' + $exactDynamicReferencePattern + '"|\x27' + $exactDynamicReferencePattern + '\x27)'
$exactSensitiveAssignmentReferencePattern = $quotedExactDynamicReferencePattern + '(?:[ \t]*(?=$|;|&&|\|\|)|[ \t]+#.*$|[ \t]+\\[ \t]*$|[ \t]*[,}\]][ \t]*(?:#.*)?$)'
$exactInlineDynamicReferencePattern = $quotedExactDynamicReferencePattern + '(?=$|[;,}\]\s])'
$exactConnectionDynamicReferencePattern = $quotedExactDynamicReferencePattern + '(?=[ \t]*(?:;|$))'
$dynamicReferenceConcatenatedLiteralPattern = '[ \t]*(?:\+|\|\||\?\?|&&|\?)[ \t]*(?:"[^"\r\n]{12,}"?|\x27[^\x27\r\n]{12,}\x27?|`[^`\r\n]{12,}`?)'
$dynamicReferenceDirectSuffixPattern = '(?:[ \t]+|[,}\]])[ \t]*(?!["\x27]?[A-Za-z_][A-Za-z0-9_]*["\x27]?[ \t]*:)["\x27]?[A-Za-z0-9._~+/=!@#%-]{12,}'
$dynamicReferenceSuspiciousSuffixPattern = $quotedExactDynamicReferencePattern + '(?:' + $dynamicReferenceConcatenatedLiteralPattern + '|' + $dynamicReferenceDirectSuffixPattern + ')'
$unsafeDynamicReferencePrefixPattern = '(?:\$\$?\{|\$[A-Za-z_]|(?i:\$env:)|\$\(|%)'
$sensitivePlaceholderPrefixPattern = '(?:\{|<|REPLACE|CHANGE[_-]?ME|CHANGEME|YOUR[_-]|EXAMPLE|PLACEHOLDER|CI[_-]?(?:ONLY|Only)|DESIGN[_-]?ONLY|SYNTHETIC|NOT[_-]?A[_-]?SECRET)'
$sensitiveLiteralCandidatePattern = '(?:"(?!' + $sensitivePlaceholderPrefixPattern + ')[^"\r\n]{12,}"?|\x27(?!' + $sensitivePlaceholderPrefixPattern + ')[^\x27\r\n]{12,}\x27?|(?!' + $sensitivePlaceholderPrefixPattern + ')[^\s"\x27#;]{12,})'
$unrestrictedLiteralCandidatePattern = '(?:"[^"\r\n]{12,}"?|\x27[^\x27\r\n]{12,}\x27?|[^\s"\x27#;]{12,})'
$connectionStringLiteralCandidatePattern = '(?:"(?!' + $sensitivePlaceholderPrefixPattern + ')[^"\r\n]{8,}"?|\x27(?!' + $sensitivePlaceholderPrefixPattern + ')[^\x27\r\n]{8,}\x27?|(?!' + $sensitivePlaceholderPrefixPattern + ')[^;"\x27\r\n]{8,}(?=;|$))'
$sensitiveVariableAssignmentPrefixPattern = '(?:^|;|&&|\|\|)[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*(?:PASSWORD|PWD|TOKEN|AUTH[_-]?KEY)[A-Z0-9_]*[ \t]*[:=][ \t]*'
$sensitiveVariableAssignmentPattern = '(?m)' + $sensitiveVariableAssignmentPrefixPattern + '(?!' + $exactSensitiveAssignmentReferencePattern + ')(?:["\x27]?' + $unsafeDynamicReferencePrefixPattern + '|(?:\\|.*[^\s]\\)[ \t]*$|[|>][+-]?[0-9]*[ \t]*(?:#.*)?$|' + $sensitiveLiteralCandidatePattern + ')'
$beszelSafeLiteralPattern = '["\x27]?REPLACE_WITH_SYSTEM_TOKEN_FROM_BESZEL["\x27]?(?=$|[;,}\]\s])'
$beszelAgentTokenPattern = '(?i)BESZEL_AGENT_TOKEN[ \t]*(?:=|:(?!\?))[ \t]*(?:' + $dynamicReferenceSuspiciousSuffixPattern + '|(?!(?:' + $exactInlineDynamicReferencePattern + '|' + $beszelSafeLiteralPattern + '))(?:["\x27]?' + $unsafeDynamicReferencePrefixPattern + '|' + $unrestrictedLiteralCandidatePattern + '))'
$connectionStringPasswordPrefixPattern = '(?i)(?:^|;)\s*(?:Password|Pwd)\s*=\s*'
$connectionStringPasswordPattern = $connectionStringPasswordPrefixPattern + '(?!' + $exactConnectionDynamicReferencePattern + ')(?:["\x27]?' + $unsafeDynamicReferencePrefixPattern + '|' + $connectionStringLiteralCandidatePattern + ')'
$secretAssignmentPrefixPattern = '(?i)["\x27]?(?:api[_-]?key|client[_-]?secret|flightaware[_-]?(?:key|token)|secret[_-]?key)["\x27]?[ \t]*(?:=|:(?!\?))[ \t]*'
$secretSafeLiteralPattern = '["\x27]?(?:REPLACE_ME_API_KEY|PLACEHOLDER_LOCAL_TEST_TOKEN)["\x27]?[ \t]*[;,]?[ \t]*(?:#.*)?$'
$secretAssignmentPattern = $secretAssignmentPrefixPattern + '(?:' + $dynamicReferenceSuspiciousSuffixPattern + '|(?!(?:' + $exactInlineDynamicReferencePattern + '|' + $secretSafeLiteralPattern + '))(?:["\x27]?' + $unsafeDynamicReferencePrefixPattern + '|' + $unrestrictedLiteralCandidatePattern + '))'

$rules = @(
    [PSCustomObject]@{ Name = 'private-key'; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' },
    [PSCustomObject]@{ Name = 'github-token'; Pattern = '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}' },
    [PSCustomObject]@{ Name = 'github-fine-grained-token'; Pattern = 'github_pat_[A-Za-z0-9_]{30,}' },
    [PSCustomObject]@{ Name = 'aws-access-key'; Pattern = '(?:AKIA|ASIA)[A-Z0-9]{16}' },
    [PSCustomObject]@{ Name = 'slack-token'; Pattern = 'xox[baprs]-[A-Za-z0-9-]{20,}' },
    [PSCustomObject]@{ Name = 'tailscale-auth-key'; Pattern = 'tskey-(?:auth|client|api|webhook|scim)-[A-Za-z0-9_-]{20,}' },
    [PSCustomObject]@{ Name = 'telegram-bot-url'; Pattern = 'telegram://[0-9]{6,12}:[A-Za-z0-9_-]{30,}@telegram' },
    [PSCustomObject]@{ Name = 'healthchecks-ping-url'; Pattern = 'https://hc-ping\.com/[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27,}' },
    [PSCustomObject]@{ Name = 'beszel-agent-token'; Pattern = $beszelAgentTokenPattern },
    [PSCustomObject]@{ Name = 'sensitive-variable-assignment'; Pattern = $sensitiveVariableAssignmentPattern },
    [PSCustomObject]@{ Name = 'connection-string-password'; Pattern = $connectionStringPasswordPattern },
    [PSCustomObject]@{ Name = 'secret-assignment'; Pattern = $secretAssignmentPattern }
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
        Rule = 'beszel-agent-token'
        Value = ('BESZEL_AGENT_' + 'TOKEN=${BESZEL_AGENT_TOKEN}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('BESZEL_AGENT_' + 'TOKEN=${MISSING:-ThisLooksLikeARealSecret1234}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('BESZEL_AGENT_' + 'TOKEN="${VAR}"ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('docker run -e BESZEL_AGENT_' + 'TOKEN=ThisLooksLikeARealSecret1234 image')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('docker run -e BESZEL_AGENT_' + 'TOKEN=${BESZEL_AGENT_TOKEN} image')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('docker run -e BESZEL_AGENT_' + 'TOKEN="${SAFE_TOKEN}",ThisLooksLikeARealSecret1234 image')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('echo ${BESZEL_AGENT_' + 'TOKEN:=ThisLooksLikeARealSecret1234}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'beszel-agent-token'
        Value = ('echo ${BESZEL_AGENT_' + 'TOKEN:?required}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('MSSQL_SA_' + 'PASSWORD=' + ('A' * 32))
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${ELEVANT_DB_DBA_PASSWORD}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="$${ELEVANT_DB_DBA_PASSWORD}"')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_HEALTH_' + 'PASSWORD="$${ELEVANT_DB_HEALTH_PASSWORD}";')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('DB_' + 'PASSWORD: "${SAFE_PASSWORD}",')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${ELEVANT_DB_DBA_PASSWORD:?required}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=$${ELEVANT_DB_DBA_PASSWORD:?required}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=$${MISSING:-ThisLooksLikeARealSecret1234}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=$${ELEVANT_DB_DBA_PASSWORD:?required')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=$${ELEVANT_DB_DBA_PASSWORD}literal-suffix')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="$${ELEVANT_DB_DBA_PASSWORD}"ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="${VAR}"ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="${ELEVANT_DB_DBA_PASSWORD')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${MISSING:-ThisLooksLikeARealSecret1234}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="${MISSING:-ThisLooksLikeARealSecret1234}"')
        ShouldMatch = $true
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
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="$env:SAFE_PASSWORD"')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="$env:SAFE_PASSWORD-ThisLooksLikeARealSecret1234"')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="$($passwords.Dba)ThisLooksLikeARealSecret1234"')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="This Is A Real Secret 1234"')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="${VAR}" \')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD="${VAR}"\')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${VAR} # documented reference')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${VAR}#ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${VAR}; echo safe')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${VAR}; NEXT_' + 'PASSWORD=ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=${VAR} && echo safe')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD=Short\')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('ELEVANT_DB_DBA_' + 'PASSWORD: |')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'sensitive-variable-assignment'
        Value = ('MSSQL_SA_' + 'PASSWORD="CI-Only_StrongPassword!2026"')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=' + ('A' * 20) + ';Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=' + ('A' * 8) + ';Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=correct horse battery staple;Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=$($passwords.Sa);Encrypt=True')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=${SAFE_PASSWORD};Encrypt=True')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=$env:SAFE_PASSWORD;Encrypt=True')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=${MISSING:-ThisLooksLikeARealSecret1234};Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=${VAR}ThisLooksLikeARealSecret1234;Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password="$env:SAFE_PASSWORD"ThisLooksLikeARealSecret1234;Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'connection-string-password'
        Value = ('Server=db;' + 'Password=$([char]65' + ('A' * 20) + ');Encrypt=True')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret=${CLIENT_SECRET}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret=${MISSING:-ThisLooksLikeARealSecret1234}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret="${VAR}"ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret="${SAFE_SECRET}" ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret="${SAFE_SECRET}",ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret="${SAFE_SECRET}"}ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('{"client_' + 'secret":"ThisLooksLikeARealSecret1234"}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('{"client_' + 'secret":"${CLIENT_SECRET}"}')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('- client_' + 'secret: ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const api' + 'Key = "ThisLooksLikeARealSecret1234";')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const api' + 'Key = process.env.API_KEY;')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = import.meta.env.VITE_CLIENT_SECRET;')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET + "ThisLooksLikeARealSecret1234";')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('client_' + 'secret=$env:SAFE_SECRET + "ThisLooksLikeARealSecret1234"')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET + `ThisLooksLikeARealSecret1234`;')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET + process.env.SECRET_SUFFIX;')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET || "ThisLooksLikeARealSecret1234";')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET ?? "ThisLooksLikeARealSecret1234";')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET && "ThisLooksLikeARealSecret1234";')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET ? "ThisLooksLikeARealSecret1234" : process.env.SECRET_SUFFIX;')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET || process.env.SECRET_SUFFIX;')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const client' + 'Secret = process.env.CLIENT_SECRET ?? import.meta.env.VITE_SECRET_SUFFIX;')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const config = { api' + 'Key: process.env.API_KEY, };')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('API_' + 'KEY=REPLACE_ME_API_KEY')
        ShouldMatch = $false
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('API_' + 'KEY=EXAMPLE_ThisLooksLikeARealSecret1234')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const stripeApi' + 'Key="ThisLooksLikeARealSecret1234"')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('const oauthClient' + 'Secret="ThisLooksLikeARealSecret1234"')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('{api' + 'Key:"ThisLooksLikeARealSecret1234"}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('echo ${API_' + 'KEY:=ThisLooksLikeARealSecret1234}')
        ShouldMatch = $true
    },
    [PSCustomObject]@{
        Rule = 'secret-assignment'
        Value = ('echo ${API_' + 'KEY:?required}')
        ShouldMatch = $false
    }
)

$selfTestNumber = 0
foreach ($selfTest in $ruleSelfTests) {
    $selfTestNumber++
    $actual = [regex]::IsMatch($selfTest.Value, $rulesByName[$selfTest.Rule])
    if ($actual -ne $selfTest.ShouldMatch) {
        throw ('Falló el self-test #{0} de la regla {1}.' -f $selfTestNumber, $selfTest.Rule)
    }
}

$findings = New-Object System.Collections.Generic.List[string]

foreach ($relativeFile in $relativeFiles) {
    $fullPath = Join-Path $repositoryRoot $relativeFile
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        continue
    }

    $fileInfo = Get-Item -LiteralPath $fullPath -Force
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
