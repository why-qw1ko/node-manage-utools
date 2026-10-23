import { execFileCommand, getNpmExecutable } from './command.js';

const PACKAGE_SPEC_PATTERN = /^(?:@[a-z0-9._][a-z0-9._-]*\/)?[a-z0-9._][a-z0-9._-]*(?:@[a-z0-9._-]+)?$/i;

function npm(args, options) {
  return execFileCommand(getNpmExecutable(), args, options);
}

export function normalizePackageSpec(value) {
  const spec = String(value || '').trim();
  if (!spec || spec.length > 214 || !PACKAGE_SPEC_PATTERN.test(spec)) {
    throw new Error('包名格式无效，仅支持包名及版本标签');
  }
  return spec;
}

function normalizeRegistry(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('镜像源地址无效');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('仅支持 HTTP/HTTPS 镜像源');
  }
  if (parsed.username || parsed.password) throw new Error('镜像源地址不能包含账号或密码');
  return parsed.href;
}

/**
 * Get current npm registry
 * @returns {Promise<string>}
 */
export async function getCurrentRegistry() {
  const registry = await npm(['config', 'get', 'registry']);
  return registry.trim();
}

/**
 * Set npm registry
 * @param {string} registry
 * @returns {Promise<void>}
 */
export async function setRegistry(registry) {
  await npm(['config', 'set', 'registry', normalizeRegistry(registry)]);
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
export async function getNpmConfig() {
  return npm(['config', 'list']);
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
export async function installGlobalPackage(name) {
  return npm(['install', '-g', normalizePackageSpec(name)]);
}

/**
 * Uninstall a global package
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function uninstallGlobalPackage(name) {
  return npm(['uninstall', '-g', normalizePackageSpec(name)]);
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

export async function cleanNpmCache() {
  return npm(['cache', 'clean', '--force']);
}
