import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNpmCache, installGlobalPackage, normalizePackageSpec, normalizeRegistry, parseGlobalPackagesOutput, setRegistry, uninstallGlobalPackage } from '../src/utils/npm.js';

test('normalizePackageSpec accepts common package specifications', () => {
  assert.equal(normalizePackageSpec('typescript@latest'), 'typescript@latest');
  assert.equal(normalizePackageSpec('@vue/cli@5.0.0'), '@vue/cli@5.0.0');
});

test('normalizePackageSpec rejects shell fragments and unsupported sources', () => {
  assert.throws(() => normalizePackageSpec('typescript & whoami'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('https://example.com/pkg.tgz'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('--force'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('@-scope/package'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('@scope/-package'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('.'), /包名格式无效/);
  assert.throws(() => normalizePackageSpec('..'), /包名格式无效/);
});

test('registry input rejects credentials', () => {
  assert.throws(() => normalizeRegistry('https://example.com/?token=example'), /令牌/);
});

test('registry reports the effective value instead of assuming an npm config write took effect', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  let effectiveRegistry = 'https://example.com/existing/';
  globalThis.window = {
    nodeAPI: {
      os: { platform: () => 'win32' },
      execFile: async (file, args) => args[1] === 'get' ? effectiveRegistry : '',
    },
  };
  const requested = 'https://example.com/wanted/';
  await assert.rejects(setRegistry(requested), /实际生效/);
  effectiveRegistry = requested;
  assert.equal(await setRegistry(requested), requested);
});

test('package and cache operations pass the confirmed targets to their dedicated preload methods', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const commands = [];
  globalThis.window = {
    nodeAPI: {
      npm: {
        installGlobalPackage: async (...args) => commands.push(['install', ...args]),
        uninstallGlobalPackage: async (...args) => commands.push(['uninstall', ...args]),
        cleanCache: async (...args) => commands.push(['clean', ...args]),
      },
    },
  };
  await installGlobalPackage(' typescript ', 'D:\\packages');
  await uninstallGlobalPackage('typescript', 'D:\\packages');
  await cleanNpmCache('D:\\cache');
  assert.deepEqual(commands, [
    ['install', 'typescript', 'D:\\packages'],
    ['uninstall', 'typescript', 'D:\\packages'],
    ['clean', 'D:\\cache'],
  ]);
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
