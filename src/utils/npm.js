import { execFileCommand, getNpmExecutable, withLocalMutation } from './command.js';
import { redactCredentials } from './credentials.js';

const PACKAGE_SPEC_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9._-]+)?$/i;
const NPM_READ_TIMEOUT = 20000;
const NPM_INSTALL_TIMEOUT = 10 * 60 * 1000;
const NPM_WRITE_TIMEOUT = 2 * 60 * 1000;

function redactConfigSecrets(output) {
  return redactCredentials(output).replace(
    /(^[^\r\n=]*\b(?:_auth(?:Token)?|auth[-_]?token|token|password|secret|api[-_]?key)\s*=)[^\r\n]*/gim,
    '$1 [已隐藏]',
  );
}

async function npm(args, timeout = NPM_READ_TIMEOUT) {
  try {
    return await execFileCommand(getNpmExecutable(), args, { timeout });
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      throw new Error('npm 操作超时。请先刷新确认实际状态，再检查网络、软件源或 npm 环境后重试');
    }
    throw Object.assign(new Error(redactConfigSecrets(error.message)), { code: error.code });
  }
}

export function normalizePackageSpec(value) {
  const spec = String(value || '').trim();
  if (!spec || spec.length > 214 || !PACKAGE_SPEC_PATTERN.test(spec)) {
    throw new Error('包名格式无效，仅支持包名及版本标签');
  }
  return spec;
}

export function normalizeRegistry(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('镜像源地址无效');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('仅支持 HTTP/HTTPS 镜像源');
  }
  if (redactCredentials(parsed.href) !== parsed.href) throw new Error('镜像源地址不能包含账号、密码或令牌');
  return parsed.href;
}

/**
 * Get current npm registry
 * @returns {Promise<string>}
 */
export async function getCurrentRegistry() {
  const registry = await npm(['config', 'get', 'registry']);
  return redactCredentials(registry.trim());
}

/**
 * Set npm registry
 * @param {string} registry
 * @returns {Promise<string>}
 */
export async function setRegistry(registry) {
  const target = normalizeRegistry(registry);
  return withLocalMutation(async () => {
    await npm(['config', 'set', 'registry', target], NPM_WRITE_TIMEOUT);
    const active = await getCurrentRegistry().catch(() => '');
    if (!active) throw new Error('已请求写入 npm 配置，但无法读取生效的镜像源。请刷新确认');
    if (active !== target) {
      throw new Error('写入后实际生效的镜像源仍不同。请检查当前目录的 .npmrc 或 NPM_CONFIG_REGISTRY');
    }
    return active;
  });
}

/**
 * Get npm version
 * @returns {Promise<string|null>}
 */
export async function getNpmVersion() {
  try {
    const version = await npm(['-v']);
    return version.trim();
  } catch {
    return null;
  }
}

/**
 * Get npm config list
 * @returns {Promise<string>}
 */
export async function getNpmConfig({ includeDefaults = false } = {}) {
  const args = includeDefaults ? ['config', 'list', '--long'] : ['config', 'list'];
  return redactConfigSecrets(await npm(args));
}

/**
 * Get npm global packages
 * @returns {Promise<Array<{name: string, version: string}>>}
 */
export function parseGlobalPackagesOutput(output) {
  let data;
  try {
    data = JSON.parse(String(output || ''));
  } catch {
    throw new Error('npm 返回了无法解析的全局包数据');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('npm 返回的全局包数据格式无效');
  }

  const dependencies = data.dependencies ?? {};
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new Error('npm 返回的 dependencies 格式无效');
  }

  return Object.entries(dependencies).map(([name, info]) => ({
    name,
    version: info?.version || '未知',
  }));
}

export async function getGlobalPackages() {
  const output = await npm(['list', '-g', '--depth=0', '--json']);
  return parseGlobalPackagesOutput(output);
}

/**
 * Install a global package
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function installGlobalPackage(name, expectedPrefix) {
  return withLocalMutation(async () => {
    await verifyNpmPrefix(expectedPrefix);
    return npm(['install', '-g', normalizePackageSpec(name)], NPM_INSTALL_TIMEOUT);
  });
}

/**
 * Uninstall a global package
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function uninstallGlobalPackage(name, expectedPrefix) {
  return withLocalMutation(async () => {
    await verifyNpmPrefix(expectedPrefix);
    return npm(['uninstall', '-g', normalizePackageSpec(name)], NPM_WRITE_TIMEOUT);
  });
}

async function verifyNpmPrefix(expectedPrefix) {
  if (expectedPrefix && await getNpmPrefix() !== expectedPrefix) {
    throw new Error('npm 全局安装目录已变更，请刷新全局包列表后重新确认');
  }
}

/**
 * Check if npm is installed
 * @returns {Promise<boolean>}
 */
export async function isNpmInstalled() {
  try {
    await npm(['-v']);
    return true;
  } catch {
    return false;
  }
}

export async function getNpmPrefix() {
  return (await npm(['prefix', '-g'])).trim();
}

export async function getNpmCacheDir() {
  return (await npm(['config', 'get', 'cache'])).trim();
}

export async function getNpmGlobalConfigPath() {
  return (await npm(['config', 'get', 'globalconfig'])).trim();
}

export function isSafeCacheDirectory(value) {
  if (!value) return false;
  const { path, os, env } = window.nodeAPI;
  const isWindows = os.platform() === 'win32';
  const absolute = isWindows ? /^(?:[a-z]:[\\/]|\\\\[^?\.\\/][^\\/]*[\\/])/i : /^\//;
  if (!absolute.test(value)) return false;
  const resolved = path.resolve(value);
  if (path.dirname(resolved) === resolved) return false;
  if (isWindows && env?.WINDIR) {
    const systemPath = path.resolve(env.WINDIR).toLowerCase();
    const targetPath = resolved.toLowerCase();
    if (targetPath === systemPath || targetPath.startsWith(`${systemPath}\\`)) return false;
  }
  return true;
}

export async function cleanNpmCache(expectedDirectory) {
  return withLocalMutation(async () => {
    const actualDirectory = await getNpmCacheDir();
    if (!isSafeCacheDirectory(actualDirectory)) {
      throw new Error('npm 缓存路径为空、不是绝对路径或指向磁盘根目录或系统目录，请检查 npm 的 cache 配置');
    }
    if (actualDirectory !== expectedDirectory) {
      throw new Error('npm 缓存目录已变更，请刷新后确认新的清理路径');
    }
    return npm(['cache', 'clean', '--force'], NPM_WRITE_TIMEOUT);
  });
}
