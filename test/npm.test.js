import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePackageSpec, parseGlobalPackagesOutput } from '../src/utils/npm.js';

test('normalizePackageSpec accepts common package specifications', () => {
  assert.equal(normalizePackageSpec('typescript@latest'), 'typescript@latest');
  assert.equal(normalizePackageSpec('@vue/cli@5.0.0'), '@vue/cli@5.0.0');
});

test('normalizePackageSpec rejects shell fragments and unsupported sources', () => {
  assert.throws(() => normalizePackageSpec('typescript & whoami'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('https://example.com/pkg.tgz'), /包名格式无效/);
});

test('parseGlobalPackagesOutput validates and parses npm output', () => {
  assert.deepEqual(
    parseGlobalPackagesOutput('{"dependencies":{"typescript":{"version":"5.9.2"}}}'),
    [{ name: 'typescript', version: '5.9.2' }],
  );
  assert.throws(
    () => parseGlobalPackagesOutput('npm warning before json'),
    /无法解析/,
  );
  assert.throws(
    () => parseGlobalPackagesOutput('{"dependencies":[]}'),
    /dependencies 格式无效/,
  );
});
