import { beginLocalMutation, execFileCommand, execFileCommandWithProgress, withLocalMutation } from './command.js';

const NODE_VERSION_PATTERN = /^(?:latest|lts|v?\d+(?:\.\d+){0,2})$/i;
const COMPLETE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const INSTALL_TIMEOUT = 15 * 60 * 1000;
const OPERATION_TIMEOUT = 2 * 60 * 1000;

export function normalizeNodeVersion(version) {
  const normalized = String(version || '').trim();
  if (!NODE_VERSION_PATTERN.test(normalized)) {
    throw new Error('版本号格式无效');
  }
  return normalized.toLowerCase().replace(/^v(?=\d)/, '');
}

/**
 * Check if nvm-windows is installed
 * @returns {Promise<boolean>}
 */
export async function isNvmInstalled() {
  if (typeof window.nodeAPI?.execFile !== 'function') {
    throw new Error('无法连接 uTools 的 Node.js 服务');
  }
  if (window.nodeAPI.os?.platform() !== 'win32') return false;

  try {
    const output = await execFileCommand('nvm', ['version'], { timeout: 5000 });
    if (!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(output.trim())) {
      throw new Error('nvm-windows 返回了无效的版本号');
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
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
    const version = await execFileCommand('node', ['-v'], { timeout: 5000 });
    return version.trim();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * List installed Node.js versions via nvm
 * @returns {Promise<Array<{version: string, active: boolean, path: string}>>}
 */
export async function listInstalledVersions() {
  const output = await execFileCommand('nvm', ['list'], { timeout: 10000 });
  const matches = Array.from(output.matchAll(/^[ \t]*(\*[ \t]*)?v?(\d+\.\d+\.\d+)(?=\s|$)/gmi));
  if (!matches.length && output.trim() && !/^No installations recognized\.?$/i.test(output.trim())) {
    throw new Error(output.trim());
  }
  const nvmDir = getNvmDir();

  return matches.map(([, marker, version]) => ({
    version,
    active: Boolean(marker),
    path: nvmDir ? window.nodeAPI.path.join(nvmDir, `v${version}`) : '',
  }));
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

  const uniqueVersions = new Map();
  for (const item of versions) {
    if (item.lts || !uniqueVersions.has(item.version)) uniqueVersions.set(item.version, item);
  }
  return [...uniqueVersions.values()];
}

export async function listAvailableVersions() {
  const output = await execFileCommand('nvm', ['list', 'available'], { timeout: 30000 });
  const versions = parseAvailableVersions(output);
  if (!versions.length) throw new Error('nvm-windows 未返回可用版本');
  return versions;
}

/**
 * Install a Node.js version
 * @param {string} version
 * @returns {Promise<string>}
 */
export async function installVersion(version) {
  return installVersionWithProgress(version).promise;
}

function targetMatches(version, requested, reported) {
  if (reported && version !== reported) return false;
  if (requested === 'lts' || requested === 'latest') return Boolean(reported);
  return version === requested || version.startsWith(`${requested}.`);
}

function unverifiedResult(message) {
  return Object.assign(new Error(message), { code: 'NVM_RESULT_UNVERIFIED' });
}

function readInstalledAfterMutation() {
  return listInstalledVersions().catch(() => {
    throw unverifiedResult('操作命令已结束，但无法读取版本列表。请先刷新确认实际状态');
  });
}

function verifyInstalledExecutable(entry) {
  if (!entry.path) return false;
  const { fs, path } = window.nodeAPI;
  return ['node.exe', 'node32.exe', 'node64.exe'].some((file) => {
    try { return fs.statSync(path.join(entry.path, file)).isFile(); } catch { return false; }
  });
}

async function verifyInstallResult(requested, output) {
  const reportedVersion = output.match(/^[ \t]*nvm use[ \t]+v?(\d+\.\d+\.\d+)[ \t]*\r?$/im)?.[1]
    || output.match(/^[ \t]*(?:(?:node(?:\.js)?(?: version)?|version)[ \t]+)?v?(\d+\.\d+\.\d+)[ \t]+is already installed\b/im)?.[1];
  const versions = await readInstalledAfterMutation();
  const installed = (reportedVersion || COMPLETE_VERSION_PATTERN.test(requested))
    && versions.some((entry) =>
      targetMatches(entry.version, requested, reportedVersion) && verifyInstalledExecutable(entry),
    );
  if (!installed) {
    throw unverifiedResult('无法确认安装完成。请先刷新已安装版本，再检查网络或安装源后重试');
  }
  return output;
}

/**
 * Install a Node.js version with progress callback
 * @param {string} version
 * @param {function} onProgress - callback with progress text
 * @returns {{ kill: Function, promise: Promise<string> }}
 */
export function installVersionWithProgress(version, onProgress) {
  const requested = normalizeNodeVersion(version);
  const finish = beginLocalMutation();
  try {
    const task = execFileCommandWithProgress('nvm', ['install', requested], {
      onData: onProgress,
      timeout: INSTALL_TIMEOUT,
    });
    return {
      kill: task.kill,
      promise: task.promise.then((output) => verifyInstallResult(requested, output)).finally(finish),
    };
  } catch (error) {
    finish();
    throw error;
  }
}

/**
 * Uninstall a Node.js version
 * @param {string} version
 * @returns {Promise<string>}
 */
export async function uninstallVersion(version, expectedDirectory) {
  const requested = normalizeNodeVersion(version);
  if (!COMPLETE_VERSION_PATTERN.test(requested)) throw new Error('卸载需要完整版本号');

  return withLocalMutation(async () => {
    const before = (await listInstalledVersions()).find((entry) => entry.version === requested);
    if (!before) throw new Error('该版本已不在安装列表中，请刷新后确认');
    if (before.active) throw new Error('请先切换到其他 Node.js 版本，再卸载此版本');
    if (expectedDirectory && before.path !== expectedDirectory) {
      throw new Error('Node.js 版本目录已变更，请刷新列表后重新确认卸载');
    }

    const output = await execFileCommand('nvm', ['uninstall', requested], { timeout: OPERATION_TIMEOUT });
    const stillInstalled = (await readInstalledAfterMutation()).some((entry) => entry.version === requested);
    if (stillInstalled || (before.path && window.nodeAPI.fs.existsSync(before.path))) {
      throw unverifiedResult('卸载后版本目录仍然存在。请确认没有进程占用此版本，再刷新列表');
    }
    return output;
  });
}

/**
 * Use a specific Node.js version
 * @param {string} version
 * @returns {Promise<string>}
 */
export async function useVersion(version) {
  const requested = normalizeNodeVersion(version);
  return withLocalMutation(async () => {
    const output = await execFileCommand('nvm', ['use', requested], { timeout: OPERATION_TIMEOUT });
    const reported = output.match(/\bnow using node(?:\.js)?\s+v?(\d+\.\d+\.\d+)\b/i)?.[1];
    const [versions, current] = await Promise.all([
      readInstalledAfterMutation(),
      getCurrentNodeVersion().catch(() => {
        throw unverifiedResult('切换命令已结束，但无法验证当前 Node.js。请刷新并检查 PATH 和权限');
      }),
    ]);
    const active = versions.find((entry) => entry.active && targetMatches(entry.version, requested, reported));
    if (!active) {
      const reportedError = output.trim();
      throw unverifiedResult(reportedError || '无法确认切换。请检查目标版本是否已安装、是否批准了 Windows 权限提示');
    }
    if (current?.replace(/^v/i, '') !== active.version) {
      throw unverifiedResult(`NVM 已选择 v${active.version}，但当前终端命令解析到的是 ${current || '无可用 Node.js'}。请检查 PATH 和 NVM_SYMLINK 后刷新`);
    }
    return output;
  });
}

/**
 * Get nvm install directory
 * @returns {string}
 */
export function getNvmDir() {
  const { nvm, env } = window.nodeAPI;
  return nvm?.getRoot?.() ?? env?.NVM_HOME ?? '';
}
