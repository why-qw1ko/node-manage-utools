import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNodeVersion, parseAvailableVersions } from '../src/utils/nvm.js';

test('normalizeNodeVersion accepts supported forms', () => {
  assert.equal(normalizeNodeVersion('v22.14.0'), '22.14.0');
  assert.equal(normalizeNodeVersion('lts'), 'lts');
  assert.equal(normalizeNodeVersion('latest'), 'latest');
});

test('normalizeNodeVersion rejects shell fragments and invalid versions', () => {
  assert.throws(() => normalizeNodeVersion('22.14.0 & whoami'), /版本号格式无效/);
  assert.throws(() => normalizeNodeVersion('../22.14.0'), /版本号格式无效/);
});

test('parseAvailableVersions parses nvm-windows table and marks LTS column', () => {
  const output = [
    '| CURRENT | LTS | OLD STABLE | OLD UNSTABLE |',
    '| 23.1.0 | 22.2.0 | 0.12.1 | 0.11.1 |',
  ].join('\n');

  const versions = parseAvailableVersions(output);
  assert.equal(versions.length, 4);
  assert.equal(versions.find((item) => item.version === '22.2.0')?.lts, 'LTS');
  assert.equal(versions.find((item) => item.version === '23.1.0')?.lts, false);
});
