#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
FRONTEND_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly FRONTEND_ROOT
readonly GUARD="$FRONTEND_ROOT/scripts/deployment/guard-web-publication.sh"
TEST_ROOT="$(mktemp -d)"
readonly TEST_ROOT
trap 'rm -rf -- "$TEST_ROOT"' EXIT

pass_count=0
pass() { printf 'PASS: %s\n' "$1"; pass_count=$((pass_count + 1)); }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

new_repository() {
  local name="$1" root="$TEST_ROOT/$1" work="$TEST_ROOT/$1/work"
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
  local work="$1" app="$2" source="$3" out="$4" err="$5"
  (cd "$work" && REPOSITORY_TOKEN=PLACEHOLDER_LOCAL_TEST_TOKEN bash "$GUARD" "$app" "$source") >"$out" 2>"$err"
}

advance() {
  local work="$1" path="$2"
  mkdir -p "$(dirname -- "$work/$path")"
  printf 'change\n' > "$work/$path"
  git -C "$work" add "$path"
  git -C "$work" commit --quiet -m "change $path"
  git -C "$work" push --quiet origin Development
}

assert_result() {
  local name="$1" app="$2" path="$3" expected="$4"
  local work source out err
  work="$(new_repository "$name")"
  source="$(git -C "$work" rev-parse HEAD)"
  advance "$work" "$path"
  out="$TEST_ROOT/$name.out"; err="$TEST_ROOT/$name.err"
  if run_guard "$work" "$app" "$source" "$out" "$err"; then
    [[ "$expected" == accept ]] || fail "$app should reject $path"
  else
    [[ "$expected" == reject ]] || fail "$app should accept $path"
    grep -Fq "A newer Development commit changes $app release input path: $path" "$err" ||
      fail "$app rejection should identify $path"
  fi
  pass "$app $expected: $path"
}

work="$(new_repository exact-tip)"
source="$(git -C "$work" rev-parse HEAD)"
run_guard "$work" aviam-web "$source" "$TEST_ROOT/tip.out" "$TEST_ROOT/tip.err" || fail "exact tip"
[[ "$(<"$TEST_ROOT/tip.out")" == "$source" ]] || fail "guard should print exact tip"
pass "exact tip accepted"

assert_result aviam-owned aviam-web frontend/private-web/src/App.jsx reject
assert_result aviam-other-web aviam-web frontend/public-web/src/app/page.tsx accept
assert_result public-owned public-web frontend/public-web/src/app/page.tsx reject
assert_result public-other-web public-web frontend/private-web/src/App.jsx accept
assert_result shared-client aviam-web packages/api-client/src/index.ts reject
assert_result shared-workflow public-web .github/workflows/web-ci.yml reject
assert_result shared-application public-web backend/Elevant.Application/Feature.cs reject
assert_result shared-dockerfile aviam-web backend/Dockerfile reject
assert_result shared-openapi-tool public-web ops/dokploy/web-cd/openapi-tool.mjs reject
assert_result shared-persistence aviam-web database/DevelopmentDB/Elevant.Persistence/Model.cs reject
assert_result shared-path-policy public-web scripts/release/path-ownership.sh reject
assert_result unrelated-mobile aviam-web frontend/mobile-agent/app.ts accept
assert_result unrelated-production public-web database/ProductionDB/.gitkeep accept
assert_result unrelated-doc public-web docs/note.md accept

printf 'All %d web publication guard tests passed.\n' "$pass_count"
