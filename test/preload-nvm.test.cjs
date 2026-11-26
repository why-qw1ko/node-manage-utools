const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const preloadSource = fs.readFileSync(path.join(__dirname, '../public/preload/services.js'), 'utf8');

function createPreload(env, fsOverrides = {}, timers = { setTimeout, clearTimeout }) {
  const files = new Set();
  const directories = new Set();
  const links = new Map();
  const settingsByPath = new Map();
  const statErrors = new Map();
  const commands = [];
  const approval = { approved: true, requests: [] };
  const progressJobs = [];
  const commandResult = { error: null, stdout: '1.2.2', stderr: '' };
  const window = {};
  const modules = {
    child_process: {
      execFile(file, args, options, callback) {
        commands.push({ file, args: Array.from(args), options });
        const output = typeof commandResult.stdout === 'function' ? commandResult.stdout(args) : commandResult.stdout;
        callback(commandResult.error, output, commandResult.stderr);
      },
      spawn(file, args, options) {
        const child = new EventEmitter();
        child.pid = 1000 + progressJobs.length;
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.exitCode = null;
        child.signalCode = null;
        child.kill = (signal) => {
          child.killed = true;
          queueMicrotask(() => {
            child.signalCode = signal;
            child.emit('close', null, signal);
          });
          return true;
        };
        progressJobs.push({ file, args: Array.from(args), options, child });
        return child;
      },
    },
    fs: {
      ...fs,
      existsSync: (file) => files.has(file),
      statSync(file) {
        if (statErrors.has(file)) throw statErrors.get(file);
        if (files.has(file)) return { isFile: () => true, isSymbolicLink: () => false };
        if (directories.has(file)) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
      },
      lstatSync(file) {
        return links.has(file) ? { isDirectory: () => false, isSymbolicLink: () => true } : this.statSync(file);
      },
      realpathSync: (file) => links.get(file) || file,
      ...fsOverrides,
    },
    path: path.win32,
    os: { homedir: () => 'C:\\Users\\Tester' },
    './nvm-settings.js': {
      normalizeMirrorUrl: require('../public/preload/nvm-settings.js').normalizeMirrorUrl,
      readSettingsFile: (file) => settingsByPath.get(file) || {},
    },
    './process-service.js': require('../public/preload/process-service.js'),
    './filesystem.js': require('../public/preload/filesystem.js'),
    './credentials.js': require('../public/preload/credentials.js'),
    './npm-confirm.js': {
      async confirmNpmInstall(details) {
        approval.requests.push({ ...details });
        return approval.approved;
      },
    },
  };
  vm.runInNewContext(preloadSource, {
    window,
    process: { platform: 'win32', env },
    require: (name) => modules[name],
    Buffer,
    ...timers,
  });
  return { api: window.nodeAPI, files, directories, links, settingsByPath, statErrors, commands, commandResult, progressJobs, approval };
}

test('preload redetects a default NVM install and resolves its split version and runtime paths', async () => {
  const appData = 'C:\\Users\\Tester\\AppData\\Roaming';
  const { api, files, settingsByPath, commands } = createPreload({ APPDATA: appData });
  const installDir = path.win32.join(appData, 'nvm');
  const nvmExe = path.win32.join(installDir, 'nvm.exe');
  const versionDir = 'D:\\Node Versions';
  const symlink = 'C:\\Program Files\\nodejs';

  await assert.rejects(api.execFile('nvm', ['version']), { code: 'ENOENT' });
  await assert.rejects(api.execFile('npm.cmd', ['prefix', '-g']), { code: 'ENOENT' });
  assert.equal(api.nvm.getRoot(), '');
  assert.equal(commands.length, 0);

  files.add(nvmExe);
  const settings = {
    root: versionDir,
    path: symlink,
    proxy: 'https://account:private@example.com/',
    node_mirror: 'https://nodejs.org/dist/',
    npm_mirror: 'https://example.com/?token=private',
  };
  settingsByPath.set(path.win32.join(installDir, 'settings.txt'), settings);
  assert.equal(await api.execFile('nvm', ['version'], { cwd: 'D:\\Project' }), '1.2.2');
  assert.equal(api.nvm.getInstallDir(), installDir);
  assert.equal(api.nvm.getRoot(), versionDir);
  assert.deepEqual({ ...api.nvm.getSettings() }, {
    node_mirror: 'https://nodejs.org/dist/',
    npm_mirror: 'https://example.com/?token=[已隐藏]',
  });
  assert.equal(api.env.NVM_HOME, installDir);
  assert.equal(commands[0].file, nvmExe);
  assert.equal(commands[0].options.cwd, installDir);
  assert.equal(commands[0].options.env.NVM_HOME, installDir);
  assert.equal(commands[0].options.env.NVM_SYMLINK, symlink);

  const nodeExe = path.win32.join(symlink, 'node.exe');
  const npmCli = path.win32.join(symlink, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  files.add(nodeExe);
  files.add(npmCli);
  await api.execFile('node', ['-v']);
  await api.execFile('npm.cmd', ['prefix', '-g']);
  assert.equal(commands[1].file, nodeExe);
  assert.equal(commands[2].file, nodeExe);
  assert.deepEqual(commands[2].args, [npmCli, 'prefix', '-g']);
});

test('preload distinguishes permission errors and keeps NVM root checks current', async () => {
  const nvmHome = 'C:\\Custom NVM';
  const { api, files, directories, links, settingsByPath, statErrors, commands } = createPreload({ NVM_HOME: nvmHome });
  const nvmExe = path.win32.join(nvmHome, 'nvm.exe');
  statErrors.set(nvmExe, Object.assign(new Error('Access denied'), { code: 'EACCES' }));
  await assert.rejects(api.execFile('nvm', ['version']), { code: 'EACCES' });

  statErrors.delete(nvmExe);
  files.add(nvmExe);
  const settingsPath = path.win32.join(nvmHome, 'settings.txt');
  const root = 'D:\\Node Versions';
  const symlink = 'C:\\nodejs';
  directories.add(root);
  settingsByPath.set(settingsPath, { root, path: symlink });
  await api.execFile('nvm', ['use', '22.14.0']);
  await assert.rejects(api.execFile('nvm', ['uninstall', '22']), /卸载需要完整 Node.js 版本号/);
  links.set(path.win32.join(root, 'v22.14.0'), 'D:\\another-dir');
  await assert.rejects(api.execFile('nvm', ['uninstall', '22.14.0']), /普通子目录/);
  await assert.rejects(api.execFile('nvm', ['use', 'not-a-version']), /NVM 版本参数无效/);
  await assert.rejects(api.execFile('nvm', ['list', 'available', 'extra']), /NVM 查询参数无效/);
  directories.add(symlink);
  await assert.rejects(api.execFile('nvm', ['use', '22.14.0']), /已有普通文件或目录/);
  directories.delete(symlink);
  links.set(root, 'D:\\');
  await assert.rejects(api.execFile('nvm', ['use', '22.14.0']), /NVM root 安全检查失败/);
  settingsByPath.set(settingsPath, { root: 'D:\\' });
  await assert.rejects(api.execFile('nvm', ['use', '22.14.0']), /NVM root 安全检查失败/);
  settingsByPath.set(settingsPath, { root: 'C:\\Windows\\Temp' });
  await assert.rejects(api.execFile('nvm', ['use', '22.14.0']), /NVM root 安全检查失败/);
  settingsByPath.delete(settingsPath);
  assert.throws(() => api.execFileWithProgress('nvm', ['install', '22.14.0']), /NVM root 安全检查失败/);
  await assert.rejects(api.execFile('nvm', ['root']), /不允许执行 NVM 配置命令/);
  assert.equal(commands.length, 1);
});

test('preload keeps a launched NVM command error code and its output', async () => {
  const nvmHome = 'C:\\NVM';
  const { api, files, commandResult } = createPreload({ NVM_HOME: nvmHome });
  files.add(path.win32.join(nvmHome, 'nvm.exe'));
  commandResult.error = Object.assign(new Error('Command failed'), { code: 1 });
  commandResult.stdout = 'NVM could not load settings.txt\r\n';

  await assert.rejects(api.execFile('nvm', ['version']), {
    code: 1,
    message: 'NVM could not load settings.txt',
  });
  commandResult.error = Object.assign(new Error('Command failed'), { code: null, killed: true, signal: 'SIGTERM' });
  await assert.rejects(api.execFile('nvm', ['version'], { timeout: 5000 }), { code: 'ETIMEDOUT' });
});

test('Node and npm follow PATH even when NVM is missing or another runtime is configured', async () => {
  const standalone = 'C:\\Program Files\\nodejs';
  const symlink = 'D:\\nvm-runtime';
  const { api, files, commands } = createPreload({
    PATH: `"${standalone}"`,
    NVM_SYMLINK: symlink,
  });

  for (const directory of [standalone, symlink]) {
    files.add(path.win32.join(directory, 'node.exe'));
    files.add(path.win32.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }

  await assert.rejects(api.execFile('nvm', ['version']), { code: 'ENOENT' });
  await api.execFile('node', ['-v']);
  await api.execFile('npm.cmd', ['-v']);
  const nodeExe = path.win32.join(standalone, 'node.exe');
  assert.deepEqual(commands.map(({ file }) => file), [nodeExe, nodeExe]);
  assert.deepEqual(commands[1].args, [path.win32.join(standalone, 'node_modules', 'npm', 'bin', 'npm-cli.js'), '-v']);
});

test('preload permits supported npm commands and keeps PowerShell behind the process API', async () => {
  const runtime = 'C:\\Program Files\\nodejs';
  const windowsDir = 'C:\\Windows';
  const { api, files, commands, commandResult } = createPreload({ PATH: runtime, SystemRoot: windowsDir });
  files.add(path.win32.join(runtime, 'node.exe'));
  files.add(path.win32.join(runtime, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  await assert.rejects(api.execFile('unused-tool', []), /插件不支持运行此程序/);
  await assert.rejects(api.execFile('npm.cmd', ['install', '-g', '.']), /不支持此 npm 命令/);
  await assert.rejects(api.execFile('npm.cmd', ['install', '-g', '..']), /不支持此 npm 命令/);
  const unsupportedArgs = Object.assign(['help'], { join: () => '-v' });
  await assert.rejects(api.execFile('npm.cmd', unsupportedArgs), /不支持此 npm 命令/);
  commandResult.stdout = 'proxy = "https://user:private@example.com/"\n//example.com/:_authToken = private';
  const config = await api.execFile('npm.cmd', ['config', 'list', '--long']);
  assert.match(config, /已隐藏/);
  assert.doesNotMatch(config, /private/);
  await assert.rejects(api.execFile('npm.cmd', ['install', '-g', '@types/node@latest']), /不支持此 npm 命令/);
  await assert.rejects(api.execFile('npm.cmd', ['uninstall', '-g', '@types/node']), /不支持此 npm 命令/);
  await assert.rejects(api.execFile('npm.cmd', ['cache', 'clean', '--force']), /不支持此 npm 命令/);
  const powerShellArgs = ['-NoProfile', '-NonInteractive', '-Command', '$null'];
  await assert.rejects(api.execFile('powershell.exe', powerShellArgs), /插件不支持运行此程序/);
  assert.throws(() => api.execFileWithProgress('powershell.exe', powerShellArgs), /仅支持查看 NVM 安装进度/);
  assert.throws(() => api.execFileWithProgress('npm.cmd', ['install', '-g', '@types/node']), /仅支持查看 NVM 安装进度/);
  assert.equal(commands.length, 1);
  commandResult.stdout = '[]';
  await api.process.listNodeProcesses();
  assert.equal(commands.length, 2);
  assert.equal(commands[1].file, path.win32.join(windowsDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.equal(commands[1].options.timeout, 25000);

  commandResult.stdout = '{"dependencies":{"fixture":{"version":"1.0.0","resolved":"https://example.com/file?token=private"}}}';
  const packages = JSON.parse(await api.execFile('npm.cmd', ['list', '-g', '--depth=0', '--json']));
  assert.equal(packages.dependencies.fixture.resolved, 'https://example.com/file?token=[已隐藏]');
});

test('npm global install requires native approval and pins the confirmed registry and prefix', async () => {
  const runtime = 'C:\\Program Files\\nodejs';
  const prefix = 'D:\\npm Global';
  const registry = 'https://registry.example.com/';
  const { api, files, commands, commandResult, approval } = createPreload({ PATH: runtime });
  files.add(path.win32.join(runtime, 'node.exe'));
  files.add(path.win32.join(runtime, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  commandResult.stdout = (args) => args[1] === 'prefix' ? prefix : args[1] === 'config' ? registry : '';

  await assert.rejects(api.npm.installGlobalPackage('typescript', 'D:\\other'), /目录已变更/);
  await assert.rejects(api.npm.installGlobalPackage('typescript\n', prefix), /包名格式无效/);
  assert.deepEqual(commands.map(({ args }) => args.slice(1)), [['prefix', '-g']]);

  approval.approved = false;
  await assert.rejects(api.npm.installGlobalPackage('typescript', prefix), { code: 'ECANCELED' });
  assert.deepEqual(commands.map(({ args }) => args.slice(1)), [
    ['prefix', '-g'], ['prefix', '-g'], ['config', 'get', 'registry'],
  ]);

  approval.approved = true;
  await api.npm.installGlobalPackage('typescript', prefix);
  await api.npm.uninstallGlobalPackage('typescript', prefix);
  assert.deepEqual(approval.requests, Array.from({ length: 2 }, () => ({ name: 'typescript', prefix, registry })));
  assert.deepEqual(commands.slice(3).map(({ args }) => args.slice(1)), [
    ['prefix', '-g'],
    ['config', 'get', 'registry'],
    ['install', '-g', '--ignore-scripts', `--prefix=${prefix}`, 'typescript', `--registry=${registry}`],
    ['prefix', '-g'],
    ['uninstall', '-g', '--ignore-scripts', `--prefix=${prefix}`, 'typescript'],
  ]);
});

test('npm cache cleanup uses its current configuration and rejects unsafe filesystem targets', async () => {
  const runtime = 'C:\\Program Files\\nodejs';
  const configured = 'D:\\npm cache';
  const canonical = 'D:\\actual cache';
  let configuredPath = configured;
  let realCache = canonical;
  let linked = false;
  const { api, files, commands, commandResult } = createPreload({ PATH: runtime }, {
    promises: {
      async realpath(directory) {
        assert.equal(directory, configuredPath);
        return realCache;
      },
      async lstat(directory) {
        if (directory === canonical) return { isDirectory: () => true };
        assert.equal(directory, path.win32.join(canonical, '_cacache'));
        return { isDirectory: () => !linked, isSymbolicLink: () => linked };
      },
    },
  });
  files.add(path.win32.join(runtime, 'node.exe'));
  files.add(path.win32.join(runtime, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  commandResult.stdout = (args) => args[1] === 'config' ? configuredPath : '';

  await assert.rejects(api.npm.cleanCache('D:\\old'), /目录已变更/);
  realCache = 'C:\\Windows\\Temp';
  await assert.rejects(api.npm.cleanCache(configured), /Windows 系统目录/);
  realCache = canonical;
  linked = true;
  await assert.rejects(api.npm.cleanCache(configured), /普通目录/);
  assert.equal(commands.filter(({ args }) => args[1] === 'cache').length, 0);

  linked = false;
  await api.npm.cleanCache(configured);
  assert.deepEqual(commands.at(-1).args.slice(1), ['cache', 'clean', '--force', `--cache=${canonical}`]);
});

test('preload exposes only the environment keys used by the plugin', () => {
  const { api } = createPreload({
    NVM_HOME: 'C:\\NVM',
    NVM_SYMLINK: 'C:\\nodejs',
    WINDIR: 'D:\\Windows',
    PATH: 'C:\\other',
    NODE_OPTIONS: '--no-warnings',
    HTTPS_PROXY: 'http://proxy.example',
  });
  assert.deepEqual({ ...api.env }, { NVM_HOME: 'C:\\NVM', NVM_SYMLINK: 'C:\\nodejs', WINDIR: 'D:\\Windows' });
});

test('NVM progress keeps a bounded output tail and times out a stalled child', async () => {
  const root = 'C:\\NVM';
  const { api, files, directories, settingsByPath, progressJobs } = createPreload({ NVM_HOME: root });
  files.add(path.win32.join(root, 'nvm.exe'));
  directories.add(root);
  settingsByPath.set(path.win32.join(root, 'settings.txt'), { root });

  const running = api.execFileWithProgress('nvm', ['install', '22.14.0']);
  progressJobs[0].child.stdout.write('x'.repeat(100000));
  progressJobs[0].child.stdout.write('complete');
  progressJobs[0].child.emit('close', 0);
  const output = await running.promise;
  assert.equal(output.length, 64 * 1024);
  assert.ok(output.endsWith('complete'));

  const failedDownload = api.execFileWithProgress('nvm', ['install', '22.14.0']);
  progressJobs[1].child.stdout.write('Downloading Node.js\r\n');
  progressJobs[1].child.stderr.write('Could not download https://mirror.example/?token=private');
  progressJobs[1].child.emit('close', 0);
  assert.match(await failedDownload.promise, /Downloading Node\.js\s+Could not download https:\/\/mirror\.example\/\?token=\[已隐藏\]/);

  const stalled = api.execFileWithProgress('nvm', ['install', '22.14.0'], { timeout: 10 });
  await assert.rejects(stalled.promise, { code: 'ETIMEDOUT' });
  assert.equal(progressJobs[2].child.killed, true);
  assert.equal(stalled.kill(), false);
});

test('NVM cancellation waits for the original child to close with the requested signal', async () => {
  const root = 'C:\\NVM';
  const { api, files, directories, settingsByPath, progressJobs } = createPreload({ NVM_HOME: root });
  files.add(path.win32.join(root, 'nvm.exe'));
  directories.add(root);
  settingsByPath.set(path.win32.join(root, 'settings.txt'), { root });

  const cancelled = api.execFileWithProgress('nvm', ['install', '22.14.0'], { timeout: 10 });
  const cancelledChild = progressJobs[0].child;
  let signal;
  cancelledChild.kill = (value) => { signal = value; return true; };
  let rejected = false;
  const closed = assert.rejects(cancelled.promise, { code: 'ECANCELED' }).then(() => { rejected = true; });
  assert.equal(cancelled.kill(), true);
  assert.equal(cancelled.kill(), false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rejected, false);
  assert.throws(() => api.execFileWithProgress('nvm', ['install', '22.15.0']), { code: 'EBUSY' });
  await assert.rejects(api.execFile('nvm', ['install', '22.15.0']), /安装进度接口/);
  await assert.rejects(api.execFile('nvm', ['use', '22.15.0']), { code: 'EBUSY' });
  await assert.rejects(api.nvm.cleanIncompleteVersion('22.14.0', path.win32.join(root, 'v22.14.0')), { code: 'EBUSY' });
  assert.throws(() => api.nvm.setMirror('node_mirror', 'https://nodejs.org/dist/'), { code: 'EBUSY' });
  cancelledChild.emit('close', null, signal);
  await closed;
  const independent = api.execFileWithProgress('nvm', ['install', '22.15.0']);
  const independentChild = progressJobs[1].child;
  assert.equal(cancelled.kill(), false);
  assert.equal(independentChild.killed, undefined);
  independentChild.emit('close', 0);
  await independent.promise;
});

test('NVM cancellation preserves completed and failed child outcomes', async () => {
  const root = 'C:\\NVM';
  const { api, files, directories, settingsByPath, progressJobs } = createPreload({ NVM_HOME: root });
  files.add(path.win32.join(root, 'nvm.exe'));
  directories.add(root);
  settingsByPath.set(path.win32.join(root, 'settings.txt'), { root });

  const finished = api.execFileWithProgress('nvm', ['install', '22.14.0']);
  const finishedChild = progressJobs[0].child;
  finishedChild.exitCode = 0;
  assert.equal(finished.kill(), false);
  assert.equal(finishedChild.killed, undefined);
  finishedChild.emit('close', 0);
  await finished.promise;
  assert.equal(finished.kill(), false);

  const failed = api.execFileWithProgress('nvm', ['install', '22.14.0']);
  const failedChild = progressJobs[1].child;
  failedChild.kill = () => true;
  assert.equal(failed.kill(), true);
  failedChild.stderr.write('NVM reported an ordinary failure');
  failedChild.emit('close', 1, null);
  await assert.rejects(failed.promise, (error) => error.message === 'NVM reported an ordinary failure' && error.code === undefined);
});

test('NVM timeout holds the mutation until the original child exits', async () => {
  const root = 'C:\\NVM';
  const { api, files, directories, settingsByPath, progressJobs } = createPreload({ NVM_HOME: root });
  files.add(path.win32.join(root, 'nvm.exe'));
  directories.add(root);
  settingsByPath.set(path.win32.join(root, 'settings.txt'), { root, path: 'C:\\NodeLink' });

  const timed = api.execFileWithProgress('nvm', ['install', '22.14.0'], { timeout: 10 });
  const { child } = progressJobs[0];
  const signalled = new Promise((resolve) => { child.kill = (signal) => { resolve(signal); return true; }; });
  let settled = false;
  const terminal = assert.rejects(timed.promise, { code: 'ETIMEDOUT' }).then(() => { settled = true; });
  const signal = await signalled;
  assert.equal(settled, false);
  assert.equal(timed.kill(), false);
  assert.throws(() => api.execFileWithProgress('nvm', ['install', '22.15.0']), { code: 'EBUSY' });
  child.emit('close', null, signal);
  await terminal;
  await api.execFile('nvm', ['use', '22.15.0']);
});

test('a failed stop keeps the mutation active and pipe draining preserves natural completion', async () => {
  const root = 'C:\\NVM';
  const { api, files, directories, settingsByPath, progressJobs } = createPreload({ NVM_HOME: root }, {}, {
    setTimeout: (callback, delay) => setTimeout(callback, delay === 1000 ? 5 : delay),
    clearTimeout,
  });
  files.add(path.win32.join(root, 'nvm.exe'));
  directories.add(root);
  settingsByPath.set(path.win32.join(root, 'settings.txt'), { root });

  let showProgress;
  const progressNotice = new Promise((resolve) => { showProgress = resolve; });
  const running = api.execFileWithProgress('nvm', ['install', '22.14.0'], { timeout: 10, onData: showProgress });
  const { child } = progressJobs[0];
  child.kill = () => { child.emit('error', new Error('could not signal process')); return false; };
  assert.equal(running.kill(), false);
  assert.match(await progressNotice, /超过时限，正在等待当前 NVM 进程结束/);
  assert.throws(() => api.execFileWithProgress('nvm', ['install', '22.15.0']), { code: 'EBUSY' });

  child.emit('exit', 0, null);
  child.stdout.write('Finished and drained after exit');
  assert.equal(running.kill(), false);
  assert.equal(await running.promise, 'Finished and drained after exit');
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);

  const neverStarted = api.execFileWithProgress('nvm', ['install', '22.15.0']);
  const unstarted = progressJobs[1].child;
  delete unstarted.pid;
  unstarted.emit('error', Object.assign(new Error('could not launch nvm'), { code: 'ENOENT' }));
  await assert.rejects(neverStarted.promise, { code: 'ENOENT' });
});

test('preload exposes scoped file accessors', () => {
  const { api } = createPreload({});
  assert.equal(api.fs.readFileSync, undefined);
  assert.equal(api.fs.readdirSync, undefined);
  assert.equal(api.fs.existsSync, undefined);
  assert.equal(api.fs.statSync, undefined);
  assert.equal(api.fs.resolveNpmCacheDirectory, undefined);
  assert.equal(api.fs.cleanIncompleteNvmVersion, undefined);
  assert.equal(typeof api.nvm.cleanIncompleteVersion, 'function');
  assert.equal(typeof api.fs.getConfigFileInfo, 'function');
  assert.equal(typeof api.fs.inspectNvmVersion, 'function');
  assert.equal(typeof api.fs.readSmallTextFileSync, 'function');
  assert.equal(typeof api.fs.getDirectorySize, 'function');
  assert.equal(typeof api.fs.getNpmDirectorySize, 'function');
});
