const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFilesystem } = require('../public/preload/filesystem.js');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-manager-fs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeFilesystem(options = {}) {
  return createFilesystem({
    fs,
    path,
    homeDirectory: os.homedir(),
    getWindowsDirectory: () => process.env.WINDIR || 'C:\\Windows',
    detectNvmContext: () => null,
    ...options,
  });
}

test('project version reads allow only the two declarations and cap file bytes', (t) => {
  const directory = temporaryDirectory(t);
  const declaration = path.join(directory, '.nvmrc');
  const alternate = path.join(directory, '.node-version');
  const { readSmallTextFileSync: read } = makeFilesystem();

  assert.throws(() => read(directory, '.nvmrc'), { code: 'ENOENT' });
  fs.writeFileSync(declaration, '22.14.0\n');
  fs.writeFileSync(alternate, 'lts\n');
  assert.equal(read(directory, '.nvmrc'), '22.14.0\n');
  assert.equal(read(directory, '.node-version'), 'lts\n');
  assert.throws(() => read(directory, 'settings.txt'), { code: 'EINVAL' });
  assert.throws(() => read(directory, path.join('nested', '.nvmrc')), { code: 'EINVAL' });
  assert.throws(() => read('relative', '.nvmrc'), { code: 'EINVAL' });

  fs.writeFileSync(declaration, 'x'.repeat(4096));
  assert.equal(read(directory, '.nvmrc').length, 4096);
  fs.appendFileSync(declaration, 'x');
  assert.throws(() => read(directory, '.nvmrc'), { code: 'EFBIG' });
  fs.writeFileSync(declaration, Buffer.from([0xff]));
  assert.throws(() => read(directory, '.nvmrc'), { code: 'EILSEQ' });
});

test('project version reads reject hard links and directory junctions', (t) => {
  const directory = temporaryDirectory(t);
  const original = path.join(directory, 'original.txt');
  fs.writeFileSync(original, 'lts');
  fs.linkSync(original, path.join(directory, '.nvmrc'));
  fs.symlinkSync(directory, path.join(directory, '.node-version'), 'junction');
  const { readSmallTextFileSync: read } = makeFilesystem();

  assert.throws(() => read(directory, '.nvmrc'), { code: 'EINVAL' });
  assert.throws(() => read(directory, '.node-version'), { code: 'EINVAL' });
});

test('configuration probes only accept fixed IDs and use the effective npm paths', async (t) => {
  const directory = temporaryDirectory(t);
  const npmrc = path.join(directory, 'custom.npmrc');
  const npmCache = path.join(directory, 'custom-cache');
  const globalDir = path.join(directory, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules');
  const calls = [];
  fs.writeFileSync(npmrc, 'registry=https://registry.npmjs.org');
  fs.mkdirSync(npmCache);
  fs.mkdirSync(globalDir, { recursive: true });
  const outputs = new Map([
    ['config get globalconfig', npmrc],
    ['config get cache', npmCache],
    ['prefix -g', directory],
  ]);
  const { getConfigFileInfo } = makeFilesystem({
    homeDirectory: directory,
    getNpmCommandOutput(args) {
      calls.push(args.join(' '));
      return `${outputs.get(args.join(' '))}\n`;
    },
  });

  await assert.rejects(getConfigFileInfo(npmrc), { code: 'EINVAL' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await getConfigFileInfo('npmrc-user'), { path: path.join(directory, '.npmrc'), exists: false });
  assert.deepEqual(await getConfigFileInfo('npmrc-global'), { path: npmrc, exists: true });
  assert.deepEqual(await getConfigFileInfo('npm-global-dir'), { path: globalDir, exists: true });
  assert.deepEqual(await getConfigFileInfo('npm-cache-dir'), { path: npmCache, exists: true });
  assert.deepEqual(calls, ['config get globalconfig', 'prefix -g', 'config get cache']);
});

test('NVM version probes use the configured root and do not follow linked version directories', (t) => {
  const directory = temporaryDirectory(t);
  const root = path.join(directory, 'versions');
  const installed = path.join(root, 'v22.14.0');
  const linked = path.join(root, 'v22.15.0');
  const absent = path.join(root, 'v22.16.0');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'node64.exe'), '');
  fs.symlinkSync(installed, linked, 'junction');
  const { inspectNvmVersion } = makeFilesystem({ detectNvmContext: () => ({ root }) });

  assert.deepEqual(inspectNvmVersion('22.14.0', installed), { exists: true, hasExecutable: true });
  assert.deepEqual(inspectNvmVersion('22.15.0', linked), { exists: true, hasExecutable: false });
  assert.deepEqual(inspectNvmVersion('22.16.0', absent), { exists: false, hasExecutable: false });
  assert.throws(() => inspectNvmVersion('22.14.0', directory), { code: 'ESTALE' });
  assert.throws(() => inspectNvmVersion('../22.14.0', installed), { code: 'EINVAL' });
});

function makeIncompleteNvmFixture(t) {
  const directory = temporaryDirectory(t);
  const root = path.join(directory, 'nvm');
  const version = '26.13.0';
  const target = path.join(root, `v${version}`);
  const archive = path.join(target, 'node.zip');
  const modules = path.join(target, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  fs.writeFileSync(archive, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]));
  return { directory, root, version, target, archive, modules };
}

test('incomplete NVM cleanup removes only recognized artifacts, empty downloads and empty folders', (t) => {
  const { root, version, target } = makeIncompleteNvmFixture(t);
  const { cleanIncompleteNvmVersion: clean } = makeFilesystem({ detectNvmContext: () => ({ root }) });
  const art = path.join(root, 'v26.14.0');
  fs.mkdirSync(art);
  fs.writeFileSync(path.join(art, 'node.zip'), '');
  const empty = path.join(root, 'v26.15.0');
  fs.mkdirSync(empty);

  assert.equal(clean(version, target), true);
  assert.equal(fs.existsSync(target), false);
  assert.equal(clean(version, target), false);
  assert.equal(clean('26.14.0', art), true);
  assert.equal(clean('26.15.0', empty), true);
});

test('incomplete NVM cleanup preflights the whole version before deleting anything', (t) => {
  const { root, version, target, archive, modules } = makeIncompleteNvmFixture(t);
  const { cleanIncompleteNvmVersion: clean } = makeFilesystem({ detectNvmContext: () => ({ root }) });
  const executable = path.join(target, 'node.exe');
  const moduleFile = path.join(modules, 'kept.txt');
  fs.writeFileSync(executable, 'runtime');
  assert.throws(() => clean(version, target), /可执行文件或其他内容/);
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(modules), true);
  fs.unlinkSync(executable);

  fs.writeFileSync(moduleFile, 'keep this file');
  assert.throws(() => clean(version, target), /普通空目录/);
  assert.equal(fs.readFileSync(moduleFile, 'utf8'), 'keep this file');
  assert.equal(fs.existsSync(archive), true);
  fs.unlinkSync(moduleFile);

  fs.writeFileSync(archive, 'unknown download');
  assert.throws(() => clean(version, target), /不是可确认的 NVM 下载/);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'unknown download');
  assert.equal(fs.existsSync(modules), true);
});

test('incomplete NVM cleanup rejects stale targets, active versions, junctions and hard links', (t) => {
  const { directory, root, version, target, archive, modules } = makeIncompleteNvmFixture(t);
  const activeLink = path.join(directory, 'active');
  fs.symlinkSync(target, activeLink, 'junction');
  const aliases = path.join(root, 'v26.14.0');
  fs.symlinkSync(target, aliases, 'junction');
  const { cleanIncompleteNvmVersion: clean } = makeFilesystem({
    detectNvmContext: () => ({ root }),
    nvmSymlink: activeLink,
  });

  assert.throws(() => clean(version, directory), { code: 'ESTALE' });
  assert.throws(() => clean('../26.13.0', target), { code: 'EINVAL' });
  assert.throws(() => clean(version, target), { code: 'EBUSY' });
  assert.throws(() => clean('26.14.0', aliases), /普通版本子目录/);
  assert.equal(fs.existsSync(archive), true);
  fs.unlinkSync(activeLink);

  fs.rmdirSync(modules);
  fs.symlinkSync(directory, modules, 'junction');
  assert.throws(() => clean(version, target), /普通空目录/);
  assert.equal(fs.existsSync(archive), true);
  fs.unlinkSync(modules);
  fs.mkdirSync(modules);

  const secondLink = path.join(directory, 'linked.zip');
  fs.linkSync(archive, secondLink);
  assert.throws(() => clean(version, target), /不是可确认的 NVM 下载/);
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(secondLink), true);
  assert.equal(fs.existsSync(modules), true);
});

test('incomplete NVM cleanup stops if another process changes the directory during cleanup', (t) => {
  const { root, version, target, archive, modules } = makeIncompleteNvmFixture(t);
  const newFile = path.join(target, 'new.txt');
  const { cleanIncompleteNvmVersion: clean } = makeFilesystem({
    detectNvmContext: () => ({ root }),
    fs: {
      ...fs,
      rmdirSync(directory) {
        fs.rmdirSync(directory);
        if (directory === modules) fs.writeFileSync(newFile, 'new content');
      },
    },
  });

  assert.throws(() => clean(version, target), { code: 'ESTALE' });
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.readFileSync(newFile, 'utf8'), 'new content');
});

test('directory scans preserve readable bytes and reject paths outside the detected NVM roots', async (t) => {
  const temporary = temporaryDirectory(t);
  const root = path.join(temporary, 'Node Versions');
  const version = path.join(root, 'v22.14.0');
  const locked = path.join(version, 'locked');
  const outside = path.join(temporary, 'Node Versions Backup');
  const nvmSymlink = path.join(temporary, 'nodejs');
  const linked = path.join(version, 'outside');
  fs.mkdirSync(locked, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(version, 'node.exe'), 'twelve-bytes');
  fs.writeFileSync(path.join(outside, 'other.txt'), '1234567890');
  fs.symlinkSync(outside, linked, 'junction');
  fs.symlinkSync(version, nvmSymlink, 'junction');
  const scopedFs = makeFilesystem({
    detectNvmContext: () => ({ root, symlink: nvmSymlink }),
    fs: {
      promises: {
        realpath: fs.promises.realpath,
        lstat: fs.promises.lstat,
        readdir(directory) {
          if (directory === locked) throw Object.assign(new Error('Cannot read directory'), { code: 'EACCES' });
          return fs.promises.readdir(directory);
        },
      },
    },
  });

  assert.deepEqual(await scopedFs.getDirectorySize(version), { bytes: 12, incomplete: true });
  assert.deepEqual(await scopedFs.getDirectorySize(nvmSymlink), { bytes: 12, incomplete: true });
  assert.deepEqual(await scopedFs.getDirectorySize(path.join(root, 'missing')), { bytes: 0, incomplete: false });
  await assert.rejects(scopedFs.getDirectorySize(outside), { code: 'EACCES' });
  await assert.rejects(scopedFs.getDirectorySize(linked), { code: 'EACCES' });
});

test('npm scans derive only configured cache and global package paths', async (t) => {
  const temporary = temporaryDirectory(t);
  const cache = path.join(temporary, 'npm-cache');
  const home = path.join(temporary, 'home');
  const prefix = path.join(temporary, 'npm-prefix');
  const packages = path.join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules');
  fs.mkdirSync(cache);
  fs.mkdirSync(home);
  fs.mkdirSync(packages, { recursive: true });
  fs.writeFileSync(path.join(cache, 'entry'), 'cached');
  fs.writeFileSync(path.join(packages, 'entry'), 'package');
  const outputs = [`${cache}${path.sep}\n`, prefix];
  const calls = [];
  const scopedFs = makeFilesystem({
    homeDirectory: home,
    getNpmCommandOutput(args) {
      calls.push(args);
      return outputs.shift();
    },
  });

  await assert.rejects(scopedFs.getNpmDirectorySize(cache), { code: 'EINVAL' });
  assert.deepEqual(await scopedFs.getNpmDirectorySize('cache'), { directory: `${cache}${path.sep}`, bytes: 6, incomplete: false });
  assert.deepEqual(await scopedFs.getNpmDirectorySize('global'), { directory: packages, bytes: 7, incomplete: false });
  assert.deepEqual(calls, [['config', 'get', 'cache'], ['prefix', '-g']]);

  const homeLink = path.join(temporary, 'home-link');
  fs.symlinkSync(home, homeLink, 'junction');
  outputs.push(home, homeLink);
  await assert.rejects(scopedFs.getNpmDirectorySize('cache'), { code: 'EACCES' });
  await assert.rejects(scopedFs.getNpmDirectorySize('cache'), { code: 'EACCES' });

  const otherPrefix = path.join(temporary, 'other-prefix');
  const linkedPackages = path.join(otherPrefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules');
  fs.mkdirSync(path.dirname(linkedPackages), { recursive: true });
  fs.symlinkSync(cache, linkedPackages, 'junction');
  outputs.push(otherPrefix);
  await assert.rejects(scopedFs.getNpmDirectorySize('global'), { code: 'EACCES' });
});
