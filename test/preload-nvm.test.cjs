const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const preloadSource = fs.readFileSync(path.join(__dirname, '../public/preload/services.js'), 'utf8');

function createPreload(env, fsOverrides = {}) {
  const files = new Set();
  const directories = new Set();
  const links = new Map();
  const settingsByPath = new Map();
  const statErrors = new Map();
  const commands = [];
  const progressJobs = [];
  const commandResult = { error: null, stdout: '1.2.2', stderr: '' };
  const window = {};
  const modules = {
    child_process: {
      execFile(file, args, options, callback) {
        commands.push({ file, args: Array.from(args), options });
        callback(commandResult.error, commandResult.stdout, commandResult.stderr);
      },
      spawn(file, args, options) {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {
          child.killed = true;
          child.emit('close', null);
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
  };
  vm.runInNewContext(preloadSource, {
    window,
    process: { platform: 'win32', env },
    require: (name) => modules[name],
    Buffer,
    setTimeout,
    clearTimeout,
  });
  return { api: window.nodeAPI, files, directories, links, settingsByPath, statErrors, commands, commandResult, progressJobs };
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
  const settings = { root: versionDir, path: symlink };
  settingsByPath.set(path.win32.join(installDir, 'settings.txt'), settings);
  assert.equal(await api.execFile('nvm', ['version'], { cwd: 'D:\\Project' }), '1.2.2');
  assert.equal(api.nvm.getInstallDir(), installDir);
  assert.equal(api.nvm.getRoot(), versionDir);
  assert.equal(api.nvm.getSettings(), settings);
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
  await assert.rejects(api.execFile('nvm', ['install', '22.14.0']), /NVM root 安全检查失败/);
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

test('preload keeps existing npm and PowerShell calls and rejects unsupported arguments', async () => {
  const runtime = 'C:\\Program Files\\nodejs';
  const windowsDir = 'C:\\Windows';
  const { api, files, commands } = createPreload({ PATH: runtime, SystemRoot: windowsDir });
  files.add(path.win32.join(runtime, 'node.exe'));
  files.add(path.win32.join(runtime, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  await assert.rejects(api.execFile('unused-tool', []), /插件不支持运行此程序/);
  await assert.rejects(api.execFile('npm.cmd', ['install', '-g', '.']), /不支持此 npm 命令/);
  await assert.rejects(api.execFile('npm.cmd', ['install', '-g', '..']), /不支持此 npm 命令/);
  await api.execFile('npm.cmd', ['config', 'list', '--long']);
  await api.execFile('npm.cmd', ['install', '-g', '@types/node@latest']);
  await api.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$null']);
  assert.equal(commands.length, 3);
  assert.equal(commands[2].file, path.win32.join(windowsDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
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

  const stalled = api.execFileWithProgress('nvm', ['install', '22.14.0'], { timeout: 10 });
  await assert.rejects(stalled.promise, { code: 'ETIMEDOUT' });
  assert.equal(progressJobs[1].child.killed, true);
});

test('project version file reads preserve missing and invalid input errors', (t) => {
  const { api } = createPreload({});
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-manager-version-'));
  const versionPath = path.join(tempDir, '.nvmrc');
  t.after(() => {
    fs.unlinkSync(versionPath);
    fs.rmdirSync(tempDir);
  });
  assert.throws(() => api.fs.readSmallTextFileSync(versionPath, 8), { code: 'ENOENT' });
  fs.writeFileSync(versionPath, '22.14.0\n');
  assert.equal(api.fs.readSmallTextFileSync(versionPath, 8), '22.14.0\n');
  assert.throws(() => api.fs.readSmallTextFileSync(versionPath, 7), { code: 'EFBIG' });
  fs.writeFileSync(versionPath, Buffer.from([0xff]));
  assert.throws(() => api.fs.readSmallTextFileSync(versionPath, 8), { code: 'EILSEQ' });
});

test('disk scanning keeps readable bytes and distinguishes missing from inaccessible directories', async () => {
  const root = 'C:\\scan';
  const missing = 'C:\\missing';
  const files = [{ name: 'file', isDirectory: () => false, isFile: () => true }];
  const locked = { name: 'locked', isDirectory: () => true };
  const { api } = createPreload({}, {
    promises: {
      async readdir(dir) {
        if (dir === root) return [...files, locked];
        throw Object.assign(new Error('Cannot read directory'), { code: dir === missing ? 'ENOENT' : 'EACCES' });
      },
      async lstat() { return { size: 12 }; },
    },
  });
  assert.deepEqual({ ...await api.fs.getDirectorySize(root) }, { bytes: 12, incomplete: true });
  assert.deepEqual({ ...await api.fs.getDirectorySize(missing) }, { bytes: 0, incomplete: false });
});
