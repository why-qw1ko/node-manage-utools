import { execFileCommand, execFileCommandWithProgress } from './command.js';

const NODE_VERSION_PATTERN = /^(?:latest|lts|v?\d+(?:\.\d+){0,2})$/i;

export function normalizeNodeVersion(version) {
  const normalized = String(version || '').trim();
  if (!NODE_VERSION_PATTERN.test(normalized)) {
    throw new Error('版本号格式无效');
  }
  return normalized.replace(/^v(?=\d)/i, '');
}

/**
 * Check if nvm-windows is installed
 * @returns {Promise<boolean>}
 */
export async function isNvmInstalled() {
  try {
    await execFileCommand('nvm', ['version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current nvm-windows version
 * @returns {Promise<string|null>}
 */
export async function getNvmVersion() {
  try {
    const version = await execFileCommand('nvm', ['version']);
    return version.trim();
  } catch {
    return null;
  }
}

/**
 * Get current active Node.js version
 * @returns {Promise<string|null>}
 */
export async function getCurrentNodeVersion() {
  try {
    const version = await execFileCommand('node', ['-v']);
    return version.trim();
  } catch {
    return null;
  }
}

/**
 * List installed Node.js versions via nvm
 * @returns {Promise<Array<{version: string, active: boolean, path: string}>>}
 */
export async function listInstalledVersions() {
  const output = await execFileCommand('nvm', ['list']);
  const lines = output.split('\n').filter((line) => line.trim());
  const current = await getCurrentNodeVersion();
  const nvmHome = window.nodeAPI.env.NVM_HOME;

  return lines.map((line) => {
    const match = line.match(/\bv?(\d+\.\d+\.\d+)\b/i);
    if (!match) return null;
    const version = match[1];
    const active = line.includes('*') || Boolean(current && current.includes(version));
    return {
      version,
      active,
      path: nvmHome ? window.nodeAPI.path.join(nvmHome, `v${version}`) : '',
    };
  }).filter(Boolean);
}

/**
 * List available Node.js versions from remote
 * @returns {Promise<Array<{version: string, lts: string|false}>>}
 */
export function parseAvailableVersions(output) {
  const lines = String(output || '').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /\bCURRENT\b/i.test(line) && /\bLTS\b/i.test(line));
  const versions = [];

  if (headerIndex >= 0) {
    for (const line of lines.slice(headerIndex + 1)) {
      if (!line.includes('|')) continue;
      const columns = line.split('|').slice(1, -1);
      columns.forEach((column, index) => {
        const match = column.match(/\bv?(\d+\.\d+\.\d+)\b/i);
        if (match) versions.push({ version: match[1], lts: index === 1 ? 'LTS' : false });
      });
    }
  }

  if (versions.length === 0) {
    for (const line of lines) {
      const match = line.match(/\bv?(\d+\.\d+\.\d+)\b/i);
      if (match) versions.push({
        version: match[1],
        lts: /\bLTS\b/i.test(line) ? 'LTS' : false,
      });
    }
  }

  return [...new Map(versions.map((item) => [item.version, item])).values()];
}

export async function listAvailableVersions() {
  const output = await execFileCommand('nvm', ['list', 'available'], { timeout: 30000 });
  return parseAvailableVersions(output);
}

/**
 * Install a Node.js version
 * @param {string} version
 * @returns {Promise<string>}
 */
export async function installVersion(version) {
  return execFileCommand('nvm', ['install', normalizeNodeVersion(version)]);
}

/**
 * Install a Node.js version with progress callback
 * @param {string} version
 * @param {function} onProgress - callback with progress text
 * @returns {{ process: ChildProcess, promise: Promise<string> }}
 */
export function installVersionWithProgress(version, onProgress) {
  return execFileCommandWithProgress('nvm', ['install', normalizeNodeVersion(version)], { onData: onProgress });
}

/**
 * Uninstall a Node.js version
 * @param {string} version
 * @returns {Promise<string>}
 */
export async function uninstallVersion(version) {
  return execFileCommand('nvm', ['uninstall', normalizeNodeVersion(version)]);
}

/**
 * Use a specific Node.js version
 * @param {string} version
 * @returns {Promise<string>}
 */
export async function useVersion(version) {
  return execFileCommand('nvm', ['use', normalizeNodeVersion(version)]);
}

/**
 * Get nvm install directory
 * @returns {string}
 */
export function getNvmDir() {
  return window.nodeAPI.env.NVM_HOME || '';
}
