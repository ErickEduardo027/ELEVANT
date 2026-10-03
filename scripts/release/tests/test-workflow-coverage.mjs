import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflow = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8');

test('committed secret scan stays universal when heavy ops tests are path-scoped', () => {
  const scan = workflow('secret-scan.yml');
  const ops = workflow('ops-config-ci.yml');
  assert.match(scan, /pull_request:\s*\n\s+branches:[\s\S]*?- Development/);
  assert.match(scan, /push:\s*\n\s+branches:[\s\S]*?- Development/);
  assert.doesNotMatch(scan, /\n\s+paths:/);
  assert.match(scan, /scripts\/repository\/check-secrets\.ps1/);
  assert.match(ops, /push:[\s\S]*?paths:[\s\S]*?ops\/dokploy\/\*\*/);
  assert.match(ops, /pull_request:[\s\S]*?paths:[\s\S]*?ops\/dokploy\/\*\*/);
  assert.doesNotMatch(ops, /name: Scan repository for committed secrets/);
});

test('shared-client consumer validation remains in web and mobile workflows once duplicates are removed', () => {
  const client = workflow('api-client-ci.yml');
  const web = workflow('web-ci.yml');
  const mobile = workflow('mobile-ci.yml');
  assert.match(client, /name: Validate source contract and generated client/);
  for (const name of ['private_web', 'public_web', 'mobile_agent']) {
    assert.doesNotMatch(client, new RegExp(`\\n  ${name}:`));
  }
  assert.match(web, /"packages\/api-client\/\*\*"/);
  assert.match(web, /name: Build and certify \$\{\{ matrix\.application \}\}/);
  assert.match(mobile, /"packages\/api-client\/\*\*"/);
  assert.match(mobile, /name: Bundle shared API client with Metro/);
  assert.match(workflow('vault-ci.yml'), /name: Validate ELEVANT knowledge Vault/);
});
