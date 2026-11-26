import { beginLocalMutation, execFileCommand, execFileCommandWithProgress, withLocalMutation } from './command.js';

const NODE_VERSION_PATTERN = /^(?:latest|lts|v?\d+(?:\.\d+){0,2})$/i;
const COMPLETE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const INSTALL_TIMEOUT = 15 * 60 * 1000;
const OPERATION_TIMEOUT = 2 * 60 * 1000;
const NVM_INSTALL_ERROR = /^(?:error\b|could not\b|unable to\b|download failed\b|failed to\b|access (?:is )?denied\b)/i;
const NVM_VERSION_UNAVAILABLE = /^Node\.js v?\d+\.\d+\.\d+ is not yet released or is not available\.?$/i;

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
  const tableRows = lines.map((line) => {
    const row = line.trim();
    if (!row.startsWith('|') || !row.endsWith('|')) return [];
    return row.slice(1, -1).split('|').map((cell) => cell.trim());
  });
  const headerIndex = tableRows.findIndex((row) => row.some((cell) => /^current$/i.test(cell))
    && row.some((cell) => /^lts$/i.test(cell)));
  const versions = new Map();

  function addVersion(value, lts) {
    const version = value.replace(/^v/i, '');
    if (!COMPLETE_VERSION_PATTERN.test(version)) return;
    if (lts || !versions.has(version)) versions.set(version, { version, lts: lts ? 'LTS' : false });
  }

  if (headerIndex >= 0) {
    const ltsColumn = tableRows[headerIndex].findIndex((cell) => /^lts$/i.test(cell));
    for (const row of tableRows.slice(headerIndex + 1)) {
      row.forEach((cell, index) => addVersion(cell, index === ltsColumn));
    }
  } else {
    for (const line of lines) {
      const match = line.trim().match(/^(v?\d+\.\d+\.\d+)(?:\s+(LTS|\(LTS\)))?$/i);
      if (match) addVersion(match[1], Boolean(match[2]));
    }
  }

  return [...versions.values()].sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
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

async function verifyInstallResult(requested, output, previousVersions) {
  const log = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = log.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
  const unavailable = lines.find((line) => NVM_VERSION_UNAVAILABLE.test(line));
  if (unavailable) {
    throw Object.assign(new Error(unavailable), { code: 'NVM_VERSION_UNAVAILABLE' });
  }
  const errors = lines.filter((line) => NVM_INSTALL_ERROR.test(line));
  if (errors.length) {
    throw unverifiedResult(`nvm-windows 报告安装错误。${lines.slice(-4).join(' ').slice(-600)}`);
  }

  const reportedVersion = log.match(/^[ \t]*nvm use[ \t]+v?(\d+\.\d+\.\d+)[ \t]*\r?$/im)?.[1]
    || log.match(/^[ \t]*(?:(?:node(?:\.js)?(?: version)?|version)[ \t]+)?v?(\d+\.\d+\.\d+)(?:[ \t]+\((?:32|64)-bit\))?[ \t]+is already installed\b/im)?.[1];
  const versions = await readInstalledAfterMutation();
  const hasConcreteTarget = reportedVersion || COMPLETE_VERSION_PATTERN.test(requested);
  const reportedCompletion = lines.some((line) => /^Installation complete\b/i.test(line));
  const candidates = hasConcreteTarget
    ? versions.filter((entry) => targetMatches(entry.version, requested, reportedVersion))
    : versions.filter((entry) => reportedCompletion && previousVersions && !previousVersions.has(entry.version)
      && (requested === 'lts' || requested === 'latest' || targetMatches(entry.version, requested)));

  if (candidates.length !== 1) {
    const detail = lines.at(-1)?.slice(0, 400);
    const message = hasConcreteTarget && !candidates.length
      ? `NVM 安装列表中没有 v${reportedVersion || requested}。`
      : 'NVM 未能确认唯一的已安装目标版本。';
    throw unverifiedResult(detail ? `${message}命令最后一条输出为 ${detail}` : message);
  }

  const [installed] = candidates;
  let hasExecutable;
  try {
    hasExecutable = installed.path && window.nodeAPI.fs.inspectNvmVersion(installed.version, installed.path).hasExecutable;
  } catch {
    throw unverifiedResult(`NVM 列出了 v${installed.version}，但无法检查其版本目录。请刷新后检查 NVM root 和目录权限。`);
  }
  if (!hasExecutable) throw unverifiedResult(`NVM 列出了 v${installed.version}，但版本目录中没有可验证的 Node.js 可执行文件。`);
  return output;
}

/**
 * Install a Node.js version with progress callback
 * @param {string} version
 * @param {function} onProgress - callback with progress text
 * @returns {{ kill: () => boolean, promise: Promise<string> }}
 */
export function installVersionWithProgress(version, onProgress) {
  const requested = normalizeNodeVersion(version);
  const finish = beginLocalMutation();
  let task;
  let cancelPreflight;

  async function install() {
    let previousVersions = null;
    if (!COMPLETE_VERSION_PATTERN.test(requested)) {
      const cancellation = new Promise((resolve) => {
        cancelPreflight = () => resolve(null);
      });
      previousVersions = await Promise.race([
        listInstalledVersions().then((versions) => new Set(versions.map((entry) => entry.version)), () => null),
        cancellation,
      ]);
      if (!cancelPreflight) throw Object.assign(new Error('已取消安装'), { code: 'ECANCELED' });
      cancelPreflight = undefined;
    }

    task = execFileCommandWithProgress('nvm', ['install', requested], {
      onData: onProgress,
      timeout: INSTALL_TIMEOUT,
    });
    let output;
    try {
      output = await task.promise;
    } finally {
      task = undefined;
    }
    return verifyInstallResult(requested, output, previousVersions);
  }

  return {
    kill() {
      if (!cancelPreflight) return task?.kill() ?? false;
      const cancel = cancelPreflight;
      cancelPreflight = undefined;
      cancel();
      return true;
    },
    promise: install().finally(finish),
  };
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
    let directoryExists = false;
    if (!stillInstalled && before.path) {
      try {
        directoryExists = window.nodeAPI.fs.inspectNvmVersion(requested, before.path).exists;
      } catch {
        throw unverifiedResult('卸载命令已结束，但无法检查原版本目录。请刷新列表确认实际状态');
      }
    }
    if (stillInstalled || directoryExists) {
      throw unverifiedResult('卸载后版本目录仍然存在。请确认没有进程占用此版本，再刷新列表');
    }
    return output;
  });
}

export async function cleanIncompleteVersion(version, expectedDirectory) {
  const requested = normalizeNodeVersion(version);
  if (!COMPLETE_VERSION_PATTERN.test(requested)) throw new Error('清理残留需要完整版本号');
  return withLocalMutation(() => window.nodeAPI.nvm.cleanIncompleteVersion(requested, expectedDirectory));
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
