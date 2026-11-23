import test from 'node:test';
import assert from 'node:assert/strict';
import { installVersionWithProgress, isNvmInstalled, listAvailableVersions, listInstalledVersions, normalizeNodeVersion, parseAvailableVersions, uninstallVersion, useVersion } from '../src/utils/nvm.js';

test('normalizeNodeVersion accepts supported forms', () => {
  assert.equal(normalizeNodeVersion('v22.14.0'), '22.14.0');
  assert.equal(normalizeNodeVersion('lts'), 'lts');
  assert.equal(normalizeNodeVersion('latest'), 'latest');
  assert.equal(normalizeNodeVersion(' LTS '), 'lts');
});

test('normalizeNodeVersion rejects shell fragments and invalid versions', () => {
  assert.throws(() => normalizeNodeVersion('22.14.0 & whoami'), /版本号格式无效/);
  assert.throws(() => normalizeNodeVersion('../22.14.0'), /版本号格式无效/);
});

test('NVM detection distinguishes a missing executable from a failed command', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const nodeAPI = {
    os: { platform: () => 'win32' },
    execFile: async () => { throw Object.assign(new Error('nvm not found'), { code: 'ENOENT' }); },
  };
  globalThis.window = { nodeAPI };

  assert.equal(await isNvmInstalled(), false);
  nodeAPI.execFile = async () => { throw new Error('Access denied'); };
  await assert.rejects(isNvmInstalled(), /Access denied/);
  nodeAPI.execFile = async () => '1.1.11\r\n';
  assert.equal(await isNvmInstalled(), true);
});

test('installed versions use the NVM active marker and configured root', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = {
    nodeAPI: {
      env: { NVM_HOME: 'C:\\nvm' },
      nvm: { getRoot: () => 'D:\\versions' },
      path: { join: (...parts) => parts.join('\\') },
      execFile: async (file, args) => file === 'nvm'
        ? '  2.11.0\n* 22.11.0\n'
        : 'v2.11.0',
    },
  };
  const versions = await listInstalledVersions();
  assert.equal(versions.find((item) => item.version === '2.11.0')?.active, false);
  assert.equal(versions.find((item) => item.version === '22.11.0')?.active, true);
  assert.equal(versions[0].path, 'D:\\versions\\v2.11.0');
});

test('parseAvailableVersions parses nvm-windows table and marks LTS column', () => {
  const output = [
    '| CURRENT | LTS | OLD STABLE | OLD UNSTABLE |',
    '| 23.1.0 | 22.2.0 | 0.12.1 | 0.11.1 |',
    '| 22.2.0 |        |        |        |',
  ].join('\n');

  const versions = parseAvailableVersions(output);
  assert.equal(versions.length, 4);
  assert.equal(versions.find((item) => item.version === '22.2.0')?.lts, 'LTS');
  assert.equal(versions.find((item) => item.version === '23.1.0')?.lts, false);
});

test('unexpected NVM list output is visible as an error', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { nodeAPI: { execFile: async () => 'Could not read settings.txt' } };
  await assert.rejects(listInstalledVersions(), /Could not read settings.txt/);
  await assert.rejects(listAvailableVersions(), /未返回可用版本/);
});

function mockNvmOperations(t) {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const state = {
    current: 'v22.14.0',
    installed: '* 22.14.0\n20.10.0',
    hasNodeFile: false,
    hasUninstallDirectory: true,
    output: '',
  };
  const commands = [];
  globalThis.window = {
    nodeAPI: {
      nvm: { getRoot: () => 'D:\\versions' },
      path: { join: (...parts) => parts.join('\\') },
      fs: {
        existsSync: () => state.hasUninstallDirectory,
        statSync: () => ({ isFile: () => state.hasNodeFile }),
      },
      execFile: async (file, [action, version]) => {
        commands.push([file, action, version]);
        if (action === '-v') return state.current;
        if (action === 'list') return state.installed;
        return state.output;
      },
      execFileWithProgress: (file, [action, version]) => {
        commands.push([file, action, version]);
        return { kill() {}, promise: Promise.resolve(state.output) };
      },
    },
  };
  return { state, commands };
}

test('install checks a reported concrete version and a runtime executable before success', async (t) => {
  const { state } = mockNvmOperations(t);
  state.output = 'Installation complete.\r\n\r\nnvm use 22.14.0\r\n';
  const pending = installVersionWithProgress('lts').promise;
  await assert.rejects(useVersion('22.14.0'), /另一个/);
  await assert.rejects(pending, { code: 'NVM_RESULT_UNVERIFIED' });
  state.hasNodeFile = true;
  assert.equal(await installVersionWithProgress('lts').promise, state.output);
  state.output = 'Could not read available versions';
  await assert.rejects(installVersionWithProgress('22').promise, { code: 'NVM_RESULT_UNVERIFIED' });
});

test('use verifies the active NVM version and the Node.js version on PATH', async (t) => {
  const { state } = mockNvmOperations(t);
  state.output = 'Now using node v20.10.0 (64-bit)';
  await assert.rejects(useVersion('20.10.0'), { code: 'NVM_RESULT_UNVERIFIED' });
  state.installed = '22.14.0\n* 20.10.0';
  await assert.rejects(useVersion('20.10.0'), /检查 PATH/);
  state.current = 'v20.10.0';
  assert.equal(await useVersion('lts'), state.output);
});

test('uninstall protects the active and changed targets and checks a remaining directory', async (t) => {
  const { state, commands } = mockNvmOperations(t);
  await assert.rejects(uninstallVersion('22.14.0'), /先切换/);
  await assert.rejects(uninstallVersion('20.10.0', 'C:\\elsewhere\\v20.10.0'), /目录已变更/);
  assert.equal(commands.some(([, action]) => action === 'uninstall'), false);
  await assert.rejects(uninstallVersion('20.10.0', 'D:\\versions\\v20.10.0'), { code: 'NVM_RESULT_UNVERIFIED' });
});
