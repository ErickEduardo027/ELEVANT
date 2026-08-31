#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly BACKEND_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly GUARD="$BACKEND_ROOT/scripts/deployment/guard-api-publication.sh"
readonly TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

pass_count=0
pass() {
  printf 'PASS: %s\n' "$1"
  pass_count=$((pass_count + 1))
}
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

new_repository() {
  local name="$1"
  local root="$TEST_ROOT/$name"
  local work="$root/work"
  mkdir -p "$root"
  git init --quiet --bare "$root/origin.git"
  git init --quiet --initial-branch=Development "$work"
  git -C "$work" config core.autocrlf false
  git -C "$work" config user.name 'ELEVANT CI test'
  git -C "$work" config user.email 'ci-test@invalid.example'
  printf 'initial\n' > "$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit --quiet -m initial
  git -C "$work" remote add origin "$root/origin.git"
  git -C "$work" push --quiet --set-upstream origin Development
  printf '%s\n' "$work"
}

run_guard() {
  local work="$1" source="$2" stdout_file="$3" stderr_file="$4"
  (
    cd "$work"
    REPOSITORY_TOKEN='PLACEHOLDER_LOCAL_TEST_TOKEN' bash "$GUARD" "$source"
  ) >"$stdout_file" 2>"$stderr_file"
}

assert_accepted_advance() {
  local name="$1" path="$2"
  local work source tip output error
  work="$(new_repository "$name")"
  source="$(git -C "$work" rev-parse HEAD)"
  mkdir -p "$(dirname -- "$work/$path")"
  printf 'change\n' > "$work/$path"
  git -C "$work" add "$path"
  git -C "$work" commit --quiet -m 'test: unrelated advance'
  git -C "$work" push --quiet origin Development
  tip="$(git -C "$work" rev-parse HEAD)"
  output="$TEST_ROOT/$name.stdout"
  error="$TEST_ROOT/$name.stderr"
  run_guard "$work" "$source" "$output" "$error" ||
    fail "newer unrelated commit should be accepted: $path"
  [[ "$(<"$output")" == "$tip" ]] || fail "guard should print current tip: $path"
  [[ ! -s "$error" ]] || fail "accepted path should not emit an error: $path"
  pass "newer unrelated commit is accepted: $path"
}

assert_rejected_advance() {
  local name="$1" path="$2"
  local work source output error
  work="$(new_repository "$name")"
  source="$(git -C "$work" rev-parse HEAD)"
  mkdir -p "$(dirname -- "$work/$path")"
  printf 'change\n' > "$work/$path"
  git -C "$work" add "$path"
  git -C "$work" commit --quiet -m 'test: API-owned advance'
  git -C "$work" push --quiet origin Development
  output="$TEST_ROOT/$name.stdout"
  error="$TEST_ROOT/$name.stderr"
  if run_guard "$work" "$source" "$output" "$error"; then
    fail "newer API-owned commit should be rejected: $path"
  fi
  grep -Fq "A newer Development commit changes API release input path: $path" "$error" ||
    fail "guard should identify API-owned path: $path"
  pass "newer API-owned commit is rejected: $path"
}

test_tip_equals_source() {
  local work source output error
  work="$(new_repository tip-equals-source)"
  source="$(git -C "$work" rev-parse HEAD)"
  output="$TEST_ROOT/tip.stdout"
  error="$TEST_ROOT/tip.stderr"
  run_guard "$work" "$source" "$output" "$error" || fail 'tip should be accepted'
  [[ "$(<"$output")" == "$source" ]] || fail 'tip should be printed'
  pass 'tip equal to source is accepted'
}

test_source_not_ancestor() {
  local work base source output error
  work="$(new_repository source-not-ancestor)"
  base="$(git -C "$work" rev-parse HEAD)"
  git -C "$work" switch --quiet --create stale
  printf 'stale\n' > "$work/stale.txt"
  git -C "$work" add stale.txt
  git -C "$work" commit --quiet -m stale
  source="$(git -C "$work" rev-parse HEAD)"
  git -C "$work" switch --quiet Development
  printf 'current\n' > "$work/current.txt"
  git -C "$work" add current.txt
  git -C "$work" commit --quiet -m current
  git -C "$work" push --quiet origin Development
  git -C "$work" merge-base --is-ancestor "$base" HEAD || fail 'invalid fixture'
  output="$TEST_ROOT/not-ancestor.stdout"
  error="$TEST_ROOT/not-ancestor.stderr"
  if run_guard "$work" "$source" "$output" "$error"; then
    fail 'non-ancestor should be rejected'
  fi
  grep -Fq 'Development no longer contains this workflow revision.' "$error" ||
    fail 'non-ancestor error should be explicit'
  pass 'source outside Development ancestry is rejected'
}

test_tip_equals_source
assert_accepted_advance docs-advance docs/note.md
assert_accepted_advance frontend-advance frontend/private-web/change.ts
assert_accepted_advance production-database-advance database/ProductionDB/.gitkeep
assert_rejected_advance api-source-advance backend/Elevant.Api/Program.cs
assert_rejected_advance domain-source-advance backend/Elevant.Domain/Entity.cs
assert_rejected_advance contracts-source-advance backend/Elevant.Contracts/Contract.cs
assert_rejected_advance persistence-source-advance database/DevelopmentDB/Elevant.Persistence/Db.cs
assert_rejected_advance database-bundle-advance database/DevelopmentDB/Elevant.DatabaseTool/change.cs
assert_rejected_advance compose-advance backend/compose.development.api.yml
assert_rejected_advance manifest-tool-advance backend/scripts/deployment/api_release_manifest.py
assert_rejected_advance workflow-advance .github/workflows/backend-ci.yml
assert_rejected_advance dockerfile-advance backend/Dockerfile
test_source_not_ancestor

printf 'All %d API publication guard tests passed.\n' "$pass_count"
