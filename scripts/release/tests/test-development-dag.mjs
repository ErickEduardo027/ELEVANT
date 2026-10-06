import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflow = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8');

test('Development has one coordinator; backend and web are reusable for PR and retain main validation', () => {
  const coordinator = workflow('development-delivery.yml');
  const backend = workflow('backend-ci.yml');
  const web = workflow('web-ci.yml');
  assert.match(coordinator, /name: Development delivery[\s\S]*?push:\s*\n\s+branches:\s*\n\s+- Development/);
  for (const called of [backend, web]) {
    assert.match(called, /workflow_call:/);
    assert.match(called, /push:\s*\n\s+branches:\s*\n\s+- main/);
    assert.doesNotMatch(called, /^  pull_request:/m);
    assert.doesNotMatch(called, /push:\s*\n\s+branches:\s*\n\s+- main\s*\n\s+- Development/);
  }
});

test('web waits on backend as a job dependency, not a billed polling runner', () => {
  const coordinator = workflow('development-delivery.yml');
  const web = workflow('web-ci.yml');
  assert.match(coordinator, /\n  web:\s*\n[\s\S]*?needs:[\s\S]*?- backend/);
  assert.match(coordinator, /same_run_api_manifest: \$\{\{ needs\.backend\.outputs\.api_manifest_ref \}\}/);
  assert.match(coordinator, /api_release_expected: \$\{\{ needs\.classify\.outputs\.api_release == 'true' \}\}/);
  assert.doesNotMatch(web, /ELEVANT_API_WAIT_SECONDS: "1800"/);
  assert.match(web, /ELEVANT_API_WAIT_SECONDS: "0"/);
  assert.doesNotMatch(workflow('backend-ci.yml'), /ELEVANT_DATABASE_WAIT_SECONDS: "1800"/);
  assert.match(workflow('backend-ci.yml'), /ELEVANT_DATABASE_WAIT_SECONDS: "0"/);
  assert.match(web, /if \[\[ "\$API_RELEASE_EXPECTED" == true && -z "\$SAME_RUN_API_MANIFEST" \]\]/);
});

test('publishers keep immutable identity, shared publication lock and alias-last order', () => {
  const backend = workflow('backend-ci.yml');
  const web = workflow('web-ci.yml');
  assert.match(backend, /api_manifest_ref:\s*\n\s+description:[^\n]+\n\s+value: \$\{\{ jobs\.publish-api-image\.outputs\.manifest_ref \}\}/);
  assert.match(backend, /manifest_ref: \$\{\{ steps\.publish_bundle\.outputs\.manifest_ref \}\}/);
  assert.match(backend, /group: development-api-web-release-publication/);
  assert.match(web, /group: development-api-web-release-publication/);
  assert.match(web, /matrix: \$\{\{ fromJSON\(needs\.classify\.outputs\.validation_matrix\) \}\}/);
  assert.match(web, /build_and_certify:[\s\S]*?if: needs\.classify\.outputs\.any_validate == 'true'[\s\S]*?matrix: \$\{\{ fromJSON\(needs\.classify\.outputs\.validation_matrix\) \}\}/);
  assert.match(web, /matrix: \$\{\{ fromJSON\(needs\.classify\.outputs\.release_matrix\) \}\}/);
  assert.match(backend, /name: Publish and verify the certified API manifest alias last/);
  assert.match(web, /name: Move and verify the Development discovery alias last/);
});
