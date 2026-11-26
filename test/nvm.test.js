import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIncompleteVersion, installVersionWithProgress, isNvmInstalled, listAvailableVersions, listInstalledVersions, normalizeNodeVersion, parseAvailableVersions, uninstallVersion, useVersion } from '../src/utils/nvm.js';

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

test('available versions exclude prereleases and order stable versions ahead of legacy ones', () => {
  const output = [
    '| CURRENT | LTS | OLD STABLE | OLD UNSTABLE |',
    '| 27.0.0-alpha.0.1.1 | 26.13.1 | 0.12.18 | 0.11.16 |',
    '| 26.9.0 | 24.22.3 | 0.12.17 | 0.11.15 |',
    '| 26.10.0 | | | |',
  ].join('\r\n');

  const versions = parseAvailableVersions(output);
  assert.deepEqual(versions.map((entry) => entry.version), [
    '26.13.1', '26.10.0', '26.9.0', '24.22.3', '0.12.18', '0.12.17', '0.11.16', '0.11.15',
  ]);
  assert.equal(versions[0].lts, 'LTS');
});

test('unexpected NVM list output is visible as an error', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { nodeAPI: { execFile: async () => 'Could not read settings.txt' } };
  await assert.rejects(listInstalledVersions(), /Could not read settings.txt/);
  window.nodeAPI.execFile = async () => 'Error retrieving https://mirror.example/node/v20.11.0/index.json';
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
        inspectNvmVersion: () => ({ exists: state.hasUninstallDirectory, hasExecutable: state.hasNodeFile }),
      },
      execFile: async (file, [action, version]) => {
        commands.push([file, action, version]);
        if (action === '-v') return state.current;
        if (action === 'list') return state.installed;
        return state.output;
      },
      execFileWithProgress: (file, [action, version]) => {
        commands.push([file, action, version]);
        if (state.installedAfterCommand !== undefined) state.installed = state.installedAfterCommand;
        return { kill() {}, promise: Promise.resolve(state.output) };
      },
    },
  };
  return { state, commands };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

test('install preserves NVM diagnostics when a command reports errors with exit zero', async (t) => {
  const { state } = mockNvmOperations(t);
  state.hasNodeFile = true;
  state.output = 'Downloading node.js version 22.14.0\r\nCould not download node.js v22.14.0\r\nDownload failed. Rolling Back.';
  await assert.rejects(installVersionWithProgress('22.14.0').promise, {
    code: 'NVM_RESULT_UNVERIFIED',
    message: /Could not download node\.js v22\.14\.0/,
  });
});

test('install distinguishes the source version check from an unverified installation result', async (t) => {
  const { state, commands } = mockNvmOperations(t);
  state.output = 'Node.js v26.13.0 is not yet released or is not available.\r\n';
  await assert.rejects(installVersionWithProgress('26.13.0').promise, {
    code: 'NVM_VERSION_UNAVAILABLE',
    message: 'Node.js v26.13.0 is not yet released or is not available.',
  });
  assert.deepEqual(commands, [['nvm', 'install', '26.13.0']]);
});

test('shorthand install can verify one new matching version after NVM reports completion', async (t) => {
  const { state } = mockNvmOperations(t);
  state.hasNodeFile = true;
  state.output = 'Installation complete.\r\n';
  await assert.rejects(installVersionWithProgress('22').promise, { code: 'NVM_RESULT_UNVERIFIED' });
  state.installedAfterCommand = `${state.installed}\n22.15.0`;
  assert.equal(await installVersionWithProgress('22').promise, state.output);

  state.installedAfterCommand = `${state.installed}\n23.0.0`;
  await assert.rejects(installVersionWithProgress('22').promise, { code: 'NVM_RESULT_UNVERIFIED' });
  state.installedAfterCommand = `${state.installed}\n24.0.0\n24.0.1`;
  await assert.rejects(installVersionWithProgress('latest').promise, { code: 'NVM_RESULT_UNVERIFIED' });
});

test('cancel during shorthand preflight releases the operation without starting NVM install', async (t) => {
  const { state, commands } = mockNvmOperations(t);
  const preflight = deferred();
  const execFile = window.nodeAPI.execFile;
  window.nodeAPI.execFile = () => preflight.promise;

  const pending = installVersionWithProgress('lts');
  assert.equal(pending.kill(), true);
  assert.equal(pending.kill(), false);
  await assert.rejects(pending.promise, { code: 'ECANCELED' });

  window.nodeAPI.execFile = execFile;
  state.hasNodeFile = true;
  await installVersionWithProgress('22.14.0').promise;
  preflight.resolve(state.installed);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands.filter(([, action]) => action === 'install'), [['nvm', 'install', '22.14.0']]);
});

test('cancel during an active install waits for NVM to confirm termination', async (t) => {
  const { state, commands } = mockNvmOperations(t);
  const exited = deferred();
  const execFileWithProgress = window.nodeAPI.execFileWithProgress;
  let attempts = 0;
  window.nodeAPI.execFileWithProgress = () => ({
    kill() {
      attempts += 1;
      return attempts === 2;
    },
    promise: exited.promise,
  });

  const pending = installVersionWithProgress('22.14.0');
  assert.equal(pending.kill(), false);
  assert.throws(() => installVersionWithProgress('22.14.0'), /另一个/);
  assert.equal(pending.kill(), true);
  assert.equal(pending.kill(), false);
  assert.throws(() => installVersionWithProgress('22.14.0'), /另一个/);
  exited.reject(Object.assign(new Error('已取消安装'), { code: 'ECANCELED' }));
  await assert.rejects(pending.promise, { code: 'ECANCELED' });
  assert.equal(pending.kill(), false);
  assert.equal(commands.length, 0);

  window.nodeAPI.execFileWithProgress = execFileWithProgress;
  state.hasNodeFile = true;
  await installVersionWithProgress('22.14.0').promise;
});

test('install can no longer be cancelled after NVM exits and verification starts', async (t) => {
  const { state } = mockNvmOperations(t);
  const installed = deferred();
  let killCalls = 0;
  window.nodeAPI.execFile = () => installed.promise;
  window.nodeAPI.execFileWithProgress = () => ({ kill() { killCalls += 1; return true; }, promise: Promise.resolve('') });
  state.hasNodeFile = true;

  const pending = installVersionWithProgress('22.14.0');
  await Promise.resolve();
  assert.equal(pending.kill(), false);
  assert.equal(killCalls, 0);
  installed.resolve(state.installed);
  await pending.promise;
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

test('cleanup sends only the complete version and confirmed path to the dedicated bridge', async (t) => {
  const { commands } = mockNvmOperations(t);
  const cleanup = [];
  window.nodeAPI.nvm.cleanIncompleteVersion = async (...args) => cleanup.push(args);
  await assert.rejects(cleanIncompleteVersion('26', 'D:\\versions\\v26.13.0'), /完整版本号/);
  await cleanIncompleteVersion('v26.13.0', 'D:\\versions\\v26.13.0');
  assert.deepEqual(cleanup, [['26.13.0', 'D:\\versions\\v26.13.0']]);
  assert.deepEqual(commands, []);
});
