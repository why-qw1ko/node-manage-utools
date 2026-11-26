import { execFileCommand, getNpmExecutable, withLocalMutation } from './command.js';
import { redactCredentials } from './credentials.js';

const PACKAGE_SPEC_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9._-]+)?$/i;
const NPM_READ_TIMEOUT = 20000;
const NPM_WRITE_TIMEOUT = 2 * 60 * 1000;

async function runNpmOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      throw new Error('npm 操作超时。请先刷新确认实际状态，再检查网络、软件源或 npm 环境后重试');
    }
    throw error;
  }
}

function npm(args, timeout = NPM_READ_TIMEOUT) {
  return runNpmOperation(() => execFileCommand(getNpmExecutable(), args, { timeout }));
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
  return npm(args);
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
  return withLocalMutation(() => runNpmOperation(
    () => window.nodeAPI.npm.installGlobalPackage(normalizePackageSpec(name), expectedPrefix),
  ));
}

/**
 * Uninstall a global package
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function uninstallGlobalPackage(name, expectedPrefix) {
  return withLocalMutation(() => runNpmOperation(
    () => window.nodeAPI.npm.uninstallGlobalPackage(normalizePackageSpec(name), expectedPrefix),
  ));
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

export async function cleanNpmCache(expectedDirectory) {
  return withLocalMutation(() => runNpmOperation(() => window.nodeAPI.npm.cleanCache(expectedDirectory)));
}
