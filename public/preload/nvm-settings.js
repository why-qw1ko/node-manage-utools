const fs = require('fs');
const path = require('path');
const { redactCredentials } = require('./credentials.js');

const MIRROR_KEYS = new Set(['node_mirror', 'npm_mirror']);
const MAX_SETTINGS_BYTES = 64 * 1024;

function parseSettingsText(text) {
  return Object.fromEntries(
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^:#]+?)\s*:\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1].toLowerCase(), match[2]]),
  );
}

function readSettingsFile(settingsPath) {
  try {
    return parseSettingsText(decodeSettingsText(readSettingsSnapshot(settingsPath).bytes));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function readSettingsSnapshot(settingsPath) {
  const info = fs.lstatSync(settingsPath);
  if (!info.isFile()) throw new Error('NVM settings.txt 必须是普通文件，不能是链接。');
  const fd = fs.openSync(settingsPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stats = fs.fstatSync(fd);
    if (!stats.isFile() || stats.ino !== info.ino || stats.dev !== info.dev) {
      throw new Error('NVM settings.txt 已被其他程序替换，请刷新后重试。');
    }
    if (stats.size > MAX_SETTINGS_BYTES) throw new Error('NVM settings.txt 超过 64 KiB。');

    const buffer = Buffer.alloc(stats.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = fs.readSync(fd, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used !== stats.size) throw new Error('NVM settings.txt 已被其他程序更新，请刷新后重试。');
    return { bytes: buffer.subarray(0, used), mode: stats.mode };
  } finally {
    fs.closeSync(fd);
  }
}

function decodeSettingsText(bytes) {
  const text = bytes.toString('utf8');
  if (text.includes('\0') || !Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error('NVM settings.txt 不是有效的 UTF-8 文本。请先备份并转换文件编码。');
  }
  return text;
}

function normalizeMirrorUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || raw.length > 2048) throw new Error('安装源地址无效');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('仅支持 HTTP/HTTPS 安装源');
  }
  if (redactCredentials(parsed.href) !== parsed.href) throw new Error('安装源地址不能包含账号、密码或令牌');
  return parsed.href;
}

function updateSettingsText(text, key, value) {
  if (!MIRROR_KEYS.has(key)) throw new Error('不允许修改该 NVM 配置项');

  const source = String(text || '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingEol = /\r?\n$/.test(source);
  const keyPattern = new RegExp(`^\\s*${key}\\s*:`, 'i');
  let replaced = false;

  const lines = source.split(/\r?\n/).filter((line, index, all) => {
    if (index === all.length - 1 && line === '' && hasTrailingEol) return false;
    if (!keyPattern.test(line)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  }).map((line) => (keyPattern.test(line) ? `${key}: ${value}` : line));

  if (!replaced) lines.push(`${key}: ${value}`);
  return lines.join(eol) + (hasTrailingEol ? eol : '');
}

function updateMirrorSetting(settingsPath, key, url) {
  return updateMirrorSettings(settingsPath, { [key]: url });
}

function updateMirrorSettings(settingsPath, mirrors) {
  if (!mirrors || typeof mirrors !== 'object' || Array.isArray(mirrors)) {
    throw new Error('安装源配置无效');
  }

  const updates = Object.entries(mirrors).map(([key, url]) => {
    if (!MIRROR_KEYS.has(key)) throw new Error('不允许修改该 NVM 配置项');
    return [key, normalizeMirrorUrl(url)];
  });
  if (updates.length === 0) throw new Error('安装源配置无效');

  let snapshot;
  try {
    snapshot = readSettingsSnapshot(settingsPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('未找到 NVM settings.txt');
    throw error;
  }
  const { bytes: original, mode } = snapshot;
  const originalText = decodeSettingsText(original);
  const originalSettings = parseSettingsText(originalText);
  const updatedText = updates.reduce(
    (text, [key, url]) => updateSettingsText(text, key, url),
    originalText,
  );
  const updatedSettings = parseSettingsText(updatedText);

  if (originalSettings.root !== updatedSettings.root) {
    throw new Error('安全检查失败：NVM root 将发生变化');
  }
  if (originalText === updatedText) return updatedSettings;

  const backupPath = `${settingsPath}.mirror-backup`;
  const tempDir = fs.mkdtempSync(path.join(path.dirname(settingsPath), '.settings-'));
  const tempSettingsPath = path.join(tempDir, 'settings.txt');
  const tempBackupPath = path.join(tempDir, 'settings.txt.mirror-backup');

  try {
    fs.writeFileSync(tempSettingsPath, updatedText, { encoding: 'utf-8', flag: 'wx', mode });
    fs.writeFileSync(tempBackupPath, original, { flag: 'wx', mode });
    if (!readSettingsSnapshot(settingsPath).bytes.equals(original)) {
      throw new Error('NVM settings.txt 已被其他程序更新，请刷新后重试。');
    }
    fs.renameSync(tempBackupPath, backupPath);
    fs.renameSync(tempSettingsPath, settingsPath);
  } finally {
    try {
      for (const tempFile of [tempSettingsPath, tempBackupPath]) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }
      fs.rmdirSync(tempDir);
    } catch {
      // Staged files are isolated and do not affect the active settings.
    }
  }

  return updatedSettings;
}

module.exports = {
  normalizeMirrorUrl,
  parseSettingsText,
  readSettingsFile,
  updateMirrorSetting,
  updateMirrorSettings,
  updateSettingsText,
};
