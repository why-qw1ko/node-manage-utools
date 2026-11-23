import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { cleanNpmCache, getNpmConfig, installGlobalPackage, normalizePackageSpec, normalizeRegistry, parseGlobalPackagesOutput, setRegistry } from '../src/utils/npm.js';

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

test('npm output hides credentials and registry input rejects them', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = {
    nodeAPI: {
      os: { platform: () => 'win32' },
      execFile: async () => 'proxy = "https://placeholder:secret@example.com/"\n//example.com/:_authToken = known-value\ncache = "C:\\safe-cache"',
    },
  };
  const config = await getNpmConfig();
  assert.match(config, /cache/);
  assert.match(config, /已隐藏/);
  assert.doesNotMatch(config, /secret|known-value/);
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

test('package and cache operations reject a changed confirmed target without writing', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const commands = [];
  let currentCache = 'C:\\cache';
  globalThis.window = {
    nodeAPI: {
      path: win32,
      os: { platform: () => 'win32' },
      execFile: async (file, args) => {
        commands.push(args);
        if (args[0] === 'prefix') return 'D:\\current';
        return currentCache;
      },
    },
  };
  await assert.rejects(installGlobalPackage('typescript', 'D:\\previous'), /已变更/);
  await assert.rejects(cleanNpmCache('D:\\cache'), /目录已变更/);
  currentCache = 'C:\\';
  await assert.rejects(cleanNpmCache(currentCache), /磁盘根目录/);
  assert.deepEqual(commands, [['prefix', '-g'], ['config', 'get', 'cache'], ['config', 'get', 'cache']]);
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
