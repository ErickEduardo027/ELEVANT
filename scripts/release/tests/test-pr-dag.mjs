import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflow = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8');

test('one PR coordinator calls all applicable quality gates', () => {
  const pr = workflow('pull-request-ci.yml');
  assert.match(pr, /pull_request:\s*\n\s+branches:[\s\S]*?- Development/);
  for (const [job, file] of [
    ['backend', 'backend-ci.yml'],
    ['web', 'web-ci.yml'],
    ['api_client', 'api-client-ci.yml'],
    ['mobile', 'mobile-ci.yml'],
    ['ops', 'ops-config-ci.yml'],
    ['vault', 'vault-ci.yml'],
    ['secrets', 'secret-scan.yml'],
  ]) {
    assert.match(pr, new RegExp(`\\n  ${job}:[\\s\\S]*?uses: \\./\\.github/workflows/${file.replaceAll('.', '\\.')}\\n`));
    const called = workflow(file);
    assert.match(called, /workflow_call:/);
    assert.doesNotMatch(called, /^  pull_request:/m);
  }
  assert.match(pr, /\n  final_gate:\s*\n[\s\S]*?needs:[\s\S]*?- secrets/);
  assert.match(pr, /if: always\(\)/);
});

test('final PR gate rejects any failed or cancelled selected job', () => {
  const pr = workflow('pull-request-ci.yml');
  assert.match(pr, /name: Final PR quality gate/);
  assert.match(pr, /"\$status" == failure \|\| "\$status" == cancelled/);
  assert.match(pr, /"\$required" == true && "\$status" != success/);
  assert.match(pr, /needs\.classify\.outputs\.backend_validate/);
  assert.match(pr, /needs\.classify\.outputs\.web_validate/);
  assert.match(pr, /needs\.classify\.outputs\.api_client_validate/);
  assert.match(pr, /needs\.classify\.outputs\.mobile_validate/);
  assert.match(pr, /needs\.classify\.outputs\.ops_validate/);
});
