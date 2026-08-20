const fs = require('fs');
const path = require('path');

const MIRROR_KEYS = new Set(['node_mirror', 'npm_mirror']);

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
    return parseSettingsText(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

function normalizeMirrorUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || raw.length > 2048) throw new Error('安装源地址无效');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('仅支持 HTTP/HTTPS 安装源');
  }
  if (parsed.username || parsed.password) throw new Error('安装源地址不能包含账号或密码');
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
  if (!MIRROR_KEYS.has(key)) throw new Error('不允许修改该 NVM 配置项');
  if (!fs.existsSync(settingsPath)) throw new Error('未找到 NVM settings.txt');

  const normalizedUrl = normalizeMirrorUrl(url);
  const originalText = fs.readFileSync(settingsPath, 'utf-8');
  const originalSettings = parseSettingsText(originalText);
  const updatedText = updateSettingsText(originalText, key, normalizedUrl);
  const updatedSettings = parseSettingsText(updatedText);

  if (originalSettings.root !== updatedSettings.root) {
    throw new Error('安全检查失败：NVM root 将发生变化');
  }

  const backupPath = `${settingsPath}.mirror-backup`;
  const tempPath = path.join(
    path.dirname(settingsPath),
    `.settings-${process.pid}-${Date.now()}.tmp`,
  );

  fs.copyFileSync(settingsPath, backupPath);
  try {
    fs.writeFileSync(tempPath, updatedText, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: fs.statSync(settingsPath).mode,
    });
    fs.renameSync(tempPath, settingsPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // The original file and backup are still intact.
    }
  }

  return updatedSettings;
}

module.exports = {
  normalizeMirrorUrl,
  parseSettingsText,
  readSettingsFile,
  updateMirrorSetting,
  updateSettingsText,
};
