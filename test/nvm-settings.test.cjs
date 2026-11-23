const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseSettingsText,
  updateMirrorSetting,
  updateMirrorSettings,
  updateSettingsText,
} = require('../public/preload/nvm-settings.js');

const SETTINGS = [
  'root: D:\\tools\\nvm',
  'path: D:\\tools\\nodejs',
  'arch: 64',
  'node_mirror: https://nodejs.org/dist/',
  'npm_mirror: https://github.com/npm/cli/archive/',
  '',
].join('\r\n');

test('updating a mirror preserves NVM root and unrelated settings', () => {
  const updated = updateSettingsText(
    SETTINGS,
    'node_mirror',
    'https://registry.example.com/node/',
  );
  const parsed = parseSettingsText(updated);

  assert.equal(parsed.root, 'D:\\tools\\nvm');
  assert.equal(parsed.path, 'D:\\tools\\nodejs');
  assert.equal(parsed.arch, '64');
  assert.equal(parsed.node_mirror, 'https://registry.example.com/node/');
});

test('settings updater rejects keys that could alter NVM root', () => {
  assert.throws(
    () => updateSettingsText(SETTINGS, 'root', 'C:\\other'),
    /不允许修改该 NVM 配置项/,
  );
});

test('mirror update writes atomically and creates a recoverable backup', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-manager-settings-'));
  const settingsPath = path.join(tempDir, 'settings.txt');
  const backupPath = `${settingsPath}.mirror-backup`;
  fs.writeFileSync(settingsPath, SETTINGS, 'utf-8');

  t.after(() => {
    for (const file of fs.readdirSync(tempDir)) {
      fs.unlinkSync(path.join(tempDir, file));
    }
    fs.rmdirSync(tempDir);
  });

  updateMirrorSetting(
    settingsPath,
    'npm_mirror',
    'https://registry.example.com/npm/',
  );

  const updated = parseSettingsText(fs.readFileSync(settingsPath, 'utf-8'));
  const backup = parseSettingsText(fs.readFileSync(backupPath, 'utf-8'));
  assert.equal(updated.root, 'D:\\tools\\nvm');
  assert.equal(updated.npm_mirror, 'https://registry.example.com/npm/');
  assert.equal(backup.npm_mirror, 'https://github.com/npm/cli/archive/');
});

test('updating both mirrors validates the whole preset and backs up the original settings', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-manager-settings-'));
  const settingsPath = path.join(tempDir, 'settings.txt');
  const backupPath = `${settingsPath}.mirror-backup`;
  const nodeMirror = 'https://registry.example.com/node/';
  const npmMirror = 'https://registry.example.com/npm/';
  fs.writeFileSync(settingsPath, SETTINGS, 'utf-8');

  t.after(() => {
    fs.unlinkSync(settingsPath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    fs.rmdirSync(tempDir);
  });

  assert.throws(() => updateMirrorSettings(settingsPath, {
    node_mirror: nodeMirror,
    npm_mirror: 'file:///local/npm/',
  }), /仅支持 HTTP\/HTTPS 安装源/);
  assert.throws(() => updateMirrorSettings(settingsPath, {
    node_mirror: nodeMirror,
    root: 'C:\\other',
  }), /不允许修改该 NVM 配置项/);
  assert.equal(fs.readFileSync(settingsPath, 'utf-8'), SETTINGS);
  assert.equal(fs.existsSync(backupPath), false);

  const updated = updateMirrorSettings(settingsPath, {
    node_mirror: nodeMirror,
    npm_mirror: npmMirror,
  });

  assert.equal(updated.root, 'D:\\tools\\nvm');
  assert.equal(updated.node_mirror, nodeMirror);
  assert.equal(updated.npm_mirror, npmMirror);
  assert.equal(fs.readFileSync(settingsPath, 'utf-8'), SETTINGS
    .replace('https://nodejs.org/dist/', nodeMirror)
    .replace('https://github.com/npm/cli/archive/', npmMirror));
  assert.equal(fs.readFileSync(backupPath, 'utf-8'), SETTINGS);
});

test('mirror update refuses non-UTF-8 settings without touching the source or backup', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-manager-settings-'));
  const settingsPath = path.join(tempDir, 'settings.txt');
  const original = Buffer.concat([Buffer.from(SETTINGS), Buffer.from([0xe9])]);
  fs.writeFileSync(settingsPath, original);
  t.after(() => {
    fs.unlinkSync(settingsPath);
    fs.rmdirSync(tempDir);
  });

  assert.throws(() => updateMirrorSetting(settingsPath, 'node_mirror', 'https://node.example.com/'), /有效的 UTF-8/);
  assert.deepEqual(fs.readFileSync(settingsPath), original);
  assert.equal(fs.existsSync(`${settingsPath}.mirror-backup`), false);
});

test('mirror update preserves a newer configuration written while staging', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-manager-settings-'));
  const settingsPath = path.join(tempDir, 'settings.txt');
  const updatedByAnotherProgram = SETTINGS.replace('arch: 64', 'arch: 32');
  const originalWrite = fs.writeFileSync;
  originalWrite(settingsPath, SETTINGS);
  t.after(() => {
    fs.unlinkSync(settingsPath);
    fs.rmdirSync(tempDir);
  });
  t.mock.method(fs, 'writeFileSync', (file, data, options) => {
    originalWrite(file, data, options);
    if (path.basename(file) === 'settings.txt.mirror-backup') originalWrite(settingsPath, updatedByAnotherProgram);
  });

  assert.throws(() => updateMirrorSetting(settingsPath, 'node_mirror', 'https://node.example.com/'), /已被其他程序更新/);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), updatedByAnotherProgram);
  assert.deepEqual(fs.readdirSync(tempDir), ['settings.txt']);
});
