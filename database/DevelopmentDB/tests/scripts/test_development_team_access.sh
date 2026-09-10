#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
team_sql="$root/scripts/bootstrap/provision-development-team-access.sql"
team_runner="$root/scripts/container/provision-development-team-access.sh"
diagram_sql="$root/scripts/bootstrap/install-development-diagram-support.sql"
diagram_runner="$root/scripts/container/install-development-diagram-support.sh"
team_verifier="$root/scripts/diagnostics/verify-development-team-access.sql"
runtime_verifier="$root/scripts/container/verify-development.sh"
entrypoint="$root/scripts/container/entrypoint.sh"
dockerfile="$root/Dockerfile.ops"
certifier="$root/scripts/certify-database-containers.ps1"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

for file in \
  "$team_sql" \
  "$team_runner" \
  "$diagram_sql" \
  "$diagram_runner" \
  "$team_verifier" \
  "$runtime_verifier" \
  "$entrypoint" \
  "$dockerfile" \
  "$certifier"
do
  [[ -f "$file" ]] || fail "required team-access artifact is missing: $file"
done

bash -n "$team_runner"
bash -n "$diagram_runner"

for unsafe_option in '-P' '-v'; do
  if grep -nE -- "(^|[[:space:]])${unsafe_option}([[:space:]\\]|$)" \
    "$team_runner" "$diagram_runner"; then
    fail "team access must not place a password or scripting secret on sqlcmd argv"
  fi
done

for login in elevant_dev_erick elevant_dev_eliezer elevant_dev_laisha; do
  [[ "$(grep -Fc "N'$login'" "$team_sql")" -ge 2 ]] ||
    fail "fixed reviewed login is missing from team provisioning: $login"
done
if grep -Fq 'TEAM_MEMBER_' "$team_sql" "$team_runner"; then
  fail 'team login identifiers must not be supplied dynamically'
fi

for variable in \
  ELEVANT_DB_TEAM_ERICK_PASSWORD \
  ELEVANT_DB_TEAM_ELIEZER_PASSWORD \
  ELEVANT_DB_TEAM_LAISHA_PASSWORD
do
  grep -Fq "$variable" "$team_sql" || fail "SQL is missing $variable"
  grep -Fq "$variable" "$team_runner" || fail "runner is missing $variable"
done

grep -Fq 'must replace the documented placeholder' "$team_runner" ||
  fail 'the runner must reject documented password placeholders'
grep -Fq 'must replace the documented placeholder' "$diagram_runner" ||
  fail 'the diagram runner must reject the documented DBA placeholder'
for runner in "$team_runner" "$diagram_runner"; do
  if grep -Fq 'ELEVANT_DB_DBA_PASSWORD must be 16-128 characters' "$runner"; then
    fail 'an existing DBA password must not be forced into the team scripting charset'
  fi
done
grep -Fq "LIKE N'REPLACE[_]%'" "$team_sql" ||
  fail 'SQL must independently reject documented password placeholders'

grep -Fq "WITH PASSWORD = " "$team_sql" ||
  fail 'existing logins must reapply the declared password'
grep -Fq "CHECK_POLICY = ON, CHECK_EXPIRATION = OFF" "$team_sql" ||
  fail 'password policy must remain active during password rotation'
if grep -Fq 'CHECK_POLICY = OFF' "$team_sql"; then
  fail 'login reconciliation must never disable CHECK_POLICY'
fi
grep -Fq 'NOT LIKE N'"'"'%[A-Z]%'"'"'' "$team_sql" ||
  fail 'SQL must independently require password complexity categories'
grep -Fq 'must contain uppercase, lowercase, numeric, and special characters' "$team_runner" ||
  fail 'the runner must reject passwords that do not meet complexity categories'
grep -Fq '@login_was_disabled' "$team_sql" ||
  fail 'password rotation must preserve explicit login offboarding'
grep -Fq "N'DROP LOGIN '" "$team_sql" ||
  fail 'reconciliation must replace each fixed login with a fresh SID'
grep -Fq 'BEGIN TRANSACTION;' "$team_sql" ||
  fail 'login replacement and local-user remapping must be transactional'
if grep -Fq "N' ENABLE;'" "$team_sql"; then
  fail 'idempotent provisioning must not reactivate a disabled team login'
fi
grep -Fq '[is_policy_checked] <> 1' "$team_sql" ||
  fail 'provisioning must verify that SQL password policy remains enabled'
grep -Fq "[permission_name] = N'CONNECT SQL'" "$team_verifier" ||
  fail 'server CONNECT SQL must be checked as an exact allowlisted grant'
grep -Fq "permissions.[state] = N'G'" "$team_verifier" ||
  fail 'direct CONNECT grants must not carry delegation rights'

for schema in iam ref hr commercial ops integration; do
  grep -Fq "GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[$schema] TO [elevant_dev_team_editor];" \
    "$team_sql" || fail "functional CRUD grant is missing for $schema"
  grep -Fq "DENY ALTER, EXECUTE, REFERENCES, TAKE OWNERSHIP ON SCHEMA::[$schema] TO [elevant_dev_team_editor];" \
    "$team_sql" || fail "functional DDL boundary is missing for $schema"
done

for schema in infra audit; do
  grep -Fq "GRANT SELECT ON SCHEMA::[$schema] TO [elevant_dev_team_editor];" \
    "$team_sql" || fail "protected schema read grant is missing for $schema"
done
grep -Fq 'DENY CREATE TABLE TO [elevant_dev_team_editor];' "$team_sql" ||
  fail 'CREATE TABLE must be denied'
grep -Fq 'team-delete-migration-history' "$team_sql" ||
  fail 'EF migration history protection must be verified'
grep -Fq 'team-update-marker' "$team_sql" ||
  fail 'Development marker protection must be verified'
grep -Fq 'role permission set is not exact' "$team_verifier" ||
  fail 'team role permission drift must fail closed'
grep -Fq 'unexpectedly owns a securable' "$team_verifier" ||
  fail 'team principal ownership drift must fail closed'
grep -Fq 'exact dbo-owned custom role' "$team_verifier" ||
  fail 'the team principal must remain a dbo-owned non-fixed database role'
grep -Fq 'dbo schema owner is invalid' "$team_verifier" ||
  fail 'diagram execution must verify the dbo schema owner'
grep -Fq 'INNER JOIN master.sys.databases AS databases' "$team_verifier" ||
  fail 'database ownership by a team login must fail closed'
grep -Fq 'IF ERROR_NUMBER() = 15141' "$team_sql" ||
  fail 'hidden server-role ownership must translate the native DROP LOGIN guard'
for object_type in "N'V'" "N'SN'" "N'FN'" "N'IF'" "N'TF'" "N'FS'" "N'FT'" "N'AF'" "N'SO'" "N'TR'" "N'TA'" "N'ET'"; do
  grep -Fq "$object_type" "$team_verifier" ||
    fail "CRUD schema object guard is missing $object_type"
done
grep -Fq 'foreign_keys.[delete_referential_action] <> 0' "$team_verifier" ||
  fail 'protected schemas must reject cascades from editable tables'
grep -Fq 'editable_tables.[temporal_type] = 2' "$team_verifier" ||
  fail 'protected schemas must reject temporal history from editable tables'
grep -Fq 'editable_tables.[ledger_type] = 2' "$team_verifier" ||
  fail 'protected schemas must reject updatable-ledger history from editable tables'
grep -Fq 'editable_tables.[history_table_id]' "$team_verifier" ||
  fail 'implicit protected history writes must be checked through history_table_id'
grep -Fq 'SELECT [principal_id] FROM sys.certificates' "$team_verifier" ||
  fail 'non-object database securable ownership must fail closed'
grep -Fq ':r /opt/elevant-db-ops/sql/verify-development-team-access.sql' "$team_sql" ||
  fail 'team provisioning must run the exact permission verifier'
grep -Fq ':r /opt/elevant-db-ops/sql/verify-development-team-access.sql' "$diagram_sql" ||
  fail 'diagram installation must run the exact permission verifier'
grep -Fq '/opt/elevant-db-ops/sql/verify-development-team-access.sql' "$runtime_verifier" ||
  fail 'normal Development verification must include provisioned team access'
grep -Fq 'SKIP: Development team access has not been provisioned.' "$runtime_verifier" ||
  fail 'normal Development verification must explicitly skip an absent optional team role'
grep -Fq 'Development team access artifacts are partial; refusing to skip verification.' \
  "$runtime_verifier" ||
  fail 'normal Development verification must fail on partial optional artifacts'

grep -Fq 'SqlDiagramSupport.sql resource' "$diagram_sql" ||
  fail 'diagram compatibility provenance must remain documented'
for object in \
  sysdiagrams \
  sp_upgraddiagrams \
  sp_helpdiagrams \
  sp_helpdiagramdefinition \
  sp_creatediagram \
  sp_renamediagram \
  sp_alterdiagram \
  sp_dropdiagram \
  fn_diagramobjects
do
  grep -Fq "$object" "$diagram_sql" ||
    fail "SSMS diagram object is missing: $object"
done
if grep -Fq 'sp_helpdiagramsdefinition' "$diagram_sql"; then
  fail 'diagram definition procedure must use the SSMS 22 singular contract'
fi
[[ "$(grep -Fc 'FROM [public];' "$diagram_sql")" -eq 8 ]] ||
  fail 'all SSMS public diagram grants must be revoked'
[[ "$(grep -Fc 'TO [elevant_dev_team_editor];' "$diagram_sql")" -ge 8 ]] ||
  fail 'diagram execution and storage restrictions must target the editor role'
grep -Fq 'fn_diagramobjects]() <> 255' "$diagram_sql" ||
  fail 'the complete SSMS diagram object bitmask must be verified'
grep -Fq 'BEGIN TRANSACTION;' "$diagram_sql" ||
  fail 'diagram installation must be atomic across all object batches'
grep -Fq 'COMMIT TRANSACTION;' "$diagram_sql" ||
  fail 'diagram installation must commit only after exact verification'
diagram_commit_line=$(grep -nF 'COMMIT TRANSACTION;' "$diagram_sql" | tail -n 1 | cut -d: -f1)
diagram_pass_line=$(grep -nF 'PASS: controlled Development SSMS diagram support is installed.' "$diagram_sql" | tail -n 1 | cut -d: -f1)
[[ -n "$diagram_commit_line" && -n "$diagram_pass_line" && "$diagram_pass_line" -gt "$diagram_commit_line" ]] ||
  fail 'diagram installation must report success only after its transaction commits'
grep -Fq 'unexpected positive permission for another principal' "$team_verifier" ||
  fail 'diagram objects must reject positive grants to third parties'
grep -Fq 'DENY EXECUTE ON OBJECT::[dbo].[sp_upgraddiagrams] TO [elevant_dev_team_editor];' \
  "$diagram_sql" ||
  fail 'sp_upgraddiagrams must remain DBA-only'
if grep -Fq 'GRANT EXECUTE ON OBJECT::[dbo].[sp_upgraddiagrams] TO [elevant_dev_team_editor];' \
  "$diagram_sql"; then
  fail 'team editors must never receive sp_upgraddiagrams execution rights'
fi
grep -Fq 'modules.[execute_as_principal_id] <> DATABASE_PRINCIPAL_ID(N'"'"'dbo'"'"')' \
  "$team_verifier" ||
  fail 'diagram modules must be verified as explicit EXECUTE AS dbo'
grep -Fq "N' TO SCHEMA OWNER;'" "$diagram_sql" ||
  fail 'diagram installation must normalize adopted object ownership'
grep -Fq 'EXEC sys.sp_executesql @authorization_statement;' "$diagram_sql" ||
  fail 'diagram ownership normalization must execute a prebuilt safe statement'
grep -Fq "AND [principal_id] IS NOT NULL" "$team_verifier" ||
  fail 'diagram verification must reject explicit object ownership'

for command in provision-development-team-access install-development-diagram-support; do
  grep -Fq "$command)" "$entrypoint" || fail "entrypoint is missing $command"
  grep -Fq "$command.sh" "$dockerfile" || fail "ops image is missing $command"
  [[ "$(grep -Fc "Invoke-Ops -Command $command" "$certifier")" -ge 2 ]] ||
    fail "container certification must prove $command idempotency"
done

grep -Fq '$passwords.TeamErick = $passwords.TeamErickRotated' "$certifier" ||
  fail 'container certification must exercise password rotation'
grep -Fq 'Assert-SqlLoginRejected -User $login -Password $initialTeamPasswords[$login]' "$certifier" ||
  fail 'container certification must prove old team passwords stop authenticating'
grep -Fq 'Team provisioning did not preserve explicit login offboarding' "$certifier" ||
  fail 'container certification must prove disabled logins stay disabled'
grep -Fq 'GRANT CONTROL TO [elevant_dev_team_editor]' "$certifier" ||
  fail 'container certification must inject and detect privileged role drift'
grep -Fq 'Rejected team reconciliation did not roll back all login SIDs.' "$certifier" ||
  fail 'container certification must prove rejected reconciliation is SID-atomic'
grep -Fq 'TeamErickRejected' "$certifier" ||
  fail 'container certification must prove rejected password rotation is rolled back'
grep -Fq 'CREATE SERVER ROLE [elevant_team_forbidden_role] AUTHORIZATION [elevant_dev_erick]' \
  "$certifier" ||
  fail 'container certification must inject and detect team server ownership'
grep -Fq 'CREATE USER [unexpected_erick_mapping] FOR LOGIN [elevant_dev_erick]' \
  "$certifier" ||
  fail 'container certification must inject a cross-database membership drift'
grep -Fq 'Login SID replacement did not neutralize the external database mapping' \
  "$certifier" ||
  fail 'container certification must prove cross-database mappings become orphaned'
grep -Fq 'Development verification unexpectedly skipped partial team-access artifacts.' \
  "$certifier" ||
  fail 'container certification must reject partial optional team-access state'
grep -Fq 'CREATE VIEW [ops].[team_access_forbidden_view]' "$certifier" ||
  fail 'container certification must exercise the CRUD-schema object guard'
grep -Fq 'ON DELETE CASCADE' "$certifier" ||
  fail 'container certification must reject cascades from editable into protected schemas'
grep -Fq 'SYSTEM_VERSIONING = ON' "$certifier" ||
  fail 'container certification must create a protected temporal-history probe'
grep -Fq 'HISTORY_TABLE = [infra].[team_access_temporal_probe_history]' "$certifier" ||
  fail 'container certification must place temporal history in a protected schema'
grep -Fq 'Development verification unexpectedly accepted protected temporal history.' \
  "$certifier" ||
  fail 'container certification must reject protected temporal history during normal verification'
grep -Fq 'function New-CertificationAdmin' "$certifier" ||
  fail 'certification must create its ephemeral sysadmin before sa is disabled'
grep -Fq "'--env', 'ELEVANT_CERT_ADMIN_PASSWORD'" "$certifier" ||
  fail 'the ephemeral sysadmin password must be inherited by name, not Docker argv value'
grep -Fq 'function Invoke-WithCertificationAdmin' "$certifier" ||
  fail 'privileged certification probes must use the ephemeral administrator'
grep -Fq 'The ephemeral certification administrator still exists.' "$certifier" ||
  fail 'certification must remove and verify its ephemeral administrator'
[[ "$(grep -Fc 'do(?:es)? not have permissions?' "$certifier")" -eq 3 ]] ||
  fail 'permission-denial probes must accept SQL Server do/does and singular/plural wording'
for operation in \
  'INSERT INTO [ops].[team_access_certification]' \
  'SELECT [value] FROM [ops].[team_access_certification]' \
  'UPDATE [ops].[team_access_certification]' \
  'DELETE FROM [ops].[team_access_certification]'
do
  grep -Fq "$operation" "$certifier" ||
    fail "container certification is missing actual team CRUD behavior: $operation"
done
grep -Fq 'ALTER TABLE [ops].[team_access_certification]' "$certifier" ||
  fail 'container certification must execute a denied DDL attempt'
grep -Fq "UPDATE [infra].[database_instances]" "$certifier" ||
  fail 'container certification must execute a denied protected-marker write'
grep -Fq 'DELETE FROM [infra].[__EFMigrationsHistory] WHERE 1 = 0' "$certifier" ||
  fail 'container certification must execute a denied EF-history write'
for variable in \
  ELEVANT_DB_DBA_PASSWORD \
  ELEVANT_DB_TEAM_ERICK_PASSWORD \
  ELEVANT_DB_TEAM_ELIEZER_PASSWORD \
  ELEVANT_DB_TEAM_LAISHA_PASSWORD
do
  grep -Fq "'--env', '$variable'" "$certifier" ||
    fail "container certification must import $variable by name"
  if [[ "$variable" != ELEVANT_DB_DBA_PASSWORD ]] &&
    grep -Fq -- "--env', \"$variable=" "$certifier"; then
    fail "container certification must not place $variable values on Docker argv"
  fi
done
for operation in sp_creatediagram sp_helpdiagrams sp_helpdiagramdefinition sp_renamediagram sp_alterdiagram sp_dropdiagram; do
  grep -Fq "$operation" "$certifier" ||
    fail "container certification is missing diagram behavior: $operation"
done
grep -Fq 'unexpectedly executed the DBA-only diagram upgrader' "$certifier" ||
  fail 'container certification must prove sp_upgraddiagrams remains DBA-only'
grep -Fq 'Diagram installation unexpectedly accepted a positive third-party grant.' \
  "$certifier" ||
  fail 'container certification must reject third-party diagram grants'
grep -Fq 'Failed diagram installation did not roll back its public REVOKE.' \
  "$certifier" ||
  fail 'container certification must prove late diagram failures roll back atomically'
grep -Fq 'ALTER AUTHORIZATION ON OBJECT::[dbo].[sp_helpdiagrams] TO [elevant_dev_app];' \
  "$certifier" ||
  fail 'container certification must inject explicit diagram ownership drift'
grep -Fq 'Application login retained ALTER through stale diagram ownership.' \
  "$certifier" ||
  fail 'container certification must prove normalized diagram owners cannot alter modules'
grep -Fq 'unexpectedly opened another editor owned diagram' "$certifier" ||
  fail 'container certification must prove diagram owner isolation'
grep -Fq 'Login reconciliation did not preserve personal diagram ownership' "$certifier" ||
  fail 'container certification must prove diagram ownership survives login SID replacement'
grep -Fq "WHERE [Name] = N'certification-erick'" "$certifier" ||
  fail 'team diagram certification must verify ownership through sp_helpdiagrams output'
grep -Fq 'IF [dbo].[fn_diagramobjects]() <> 255' "$certifier" ||
  fail 'container certification must prove editor access to the SSMS diagram probe'

printf 'DEVELOPMENT_TEAM_ACCESS_TOOLING_OK\n'
