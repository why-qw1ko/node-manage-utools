const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseSettingsText,
  updateMirrorSetting,
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
