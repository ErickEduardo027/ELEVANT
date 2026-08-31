#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly BACKEND_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly GUARD="$BACKEND_ROOT/scripts/deployment/guard-database-publication.sh"
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
  local work="$1"
  local source_commit="$2"
  local stdout_file="$3"
  local stderr_file="$4"

  (
    cd "$work"
    REPOSITORY_TOKEN='PLACEHOLDER_LOCAL_TEST_TOKEN' \
      bash "$GUARD" "$source_commit"
  ) >"$stdout_file" 2>"$stderr_file"
}

test_tip_equals_source() {
  local work source output error
  work="$(new_repository tip-equals-source)"
  source="$(git -C "$work" rev-parse HEAD)"
  output="$TEST_ROOT/tip-equals-source.stdout"
  error="$TEST_ROOT/tip-equals-source.stderr"

  run_guard "$work" "$source" "$output" "$error" ||
    fail 'tip equal to source should be accepted'
  [[ "$(<"$output")" == "$source" ]] ||
    fail 'tip equal to source should print the source commit'
  [[ ! -s "$error" ]] ||
    fail 'tip equal to source should not emit an error'
  pass 'tip equal to source is accepted'
}

test_non_database_advance() {
  local work source tip output error
  work="$(new_repository non-database-advance)"
  source="$(git -C "$work" rev-parse HEAD)"
  mkdir -p "$work/docs"
  printf 'documentation only\n' > "$work/docs/note.md"
  git -C "$work" add docs/note.md
  git -C "$work" commit --quiet -m 'docs: advance Development'
  git -C "$work" push --quiet origin Development
  tip="$(git -C "$work" rev-parse HEAD)"
  output="$TEST_ROOT/non-database-advance.stdout"
  error="$TEST_ROOT/non-database-advance.stderr"

  run_guard "$work" "$source" "$output" "$error" ||
    fail 'a newer non-database Development commit should be accepted'
  [[ "$(<"$output")" == "$tip" ]] ||
    fail 'non-database advance should print the current Development tip'
  [[ ! -s "$error" ]] ||
    fail 'non-database advance should not emit an error'
  pass 'newer non-database Development commit is accepted'
}

test_database_owned_advance() {
  local work source output error
  work="$(new_repository database-owned-advance)"
  source="$(git -C "$work" rev-parse HEAD)"
  mkdir -p "$work/backend/database"
  printf 'database input\n' > "$work/backend/database/change.sql"
  git -C "$work" add backend/database/change.sql
  git -C "$work" commit --quiet -m 'test: change database-owned input'
  git -C "$work" push --quiet origin Development
  output="$TEST_ROOT/database-owned-advance.stdout"
  error="$TEST_ROOT/database-owned-advance.stderr"

  if run_guard "$work" "$source" "$output" "$error"; then
    fail 'a newer database-owned Development commit should be rejected'
  fi
  grep -Fq \
    'A newer Development commit changes database-owned path: backend/database/change.sql' \
    "$error" || fail 'database-owned rejection should name the changed path'
  pass 'newer database-owned Development commit is rejected'
}

test_source_is_not_ancestor() {
  local work base source output error
  work="$(new_repository source-not-ancestor)"
  base="$(git -C "$work" rev-parse HEAD)"

  git -C "$work" switch --quiet --create superseded-source
  printf 'superseded\n' > "$work/source.txt"
  git -C "$work" add source.txt
  git -C "$work" commit --quiet -m 'test: divergent source'
  source="$(git -C "$work" rev-parse HEAD)"

  git -C "$work" switch --quiet Development
  printf 'current tip\n' > "$work/current.txt"
  git -C "$work" add current.txt
  git -C "$work" commit --quiet -m 'test: current Development tip'
  git -C "$work" push --quiet origin Development
  git -C "$work" merge-base --is-ancestor "$base" HEAD ||
    fail 'test fixture should retain the shared base'
  output="$TEST_ROOT/source-not-ancestor.stdout"
  error="$TEST_ROOT/source-not-ancestor.stderr"

  if run_guard "$work" "$source" "$output" "$error"; then
    fail 'a source outside current Development ancestry should be rejected'
  fi
  grep -Fq 'Development no longer contains this workflow revision.' "$error" ||
    fail 'non-ancestor rejection should explain the ancestry failure'
  pass 'source outside current Development ancestry is rejected'
}

test_tip_equals_source
test_non_database_advance
test_database_owned_advance
test_source_is_not_ancestor

printf 'All %d database publication guard tests passed.\n' "$pass_count"
