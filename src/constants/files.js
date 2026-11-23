import { getNpmPrefix as readNpmPrefix } from '../utils/npm.js';

// Get home directory
function getHome() {
  return window.nodeAPI.os.homedir();
}

// Cache for npm prefix
let npmPrefixCache = null;

function getDefaultNpmPrefix() {
  return window.nodeAPI.os.platform() === 'win32'
    ? window.nodeAPI.path.join(getHome(), 'AppData', 'Roaming', 'npm')
    : '/usr/local';
}

export async function initNpmPrefix() {
  try {
    npmPrefixCache = await readNpmPrefix();
  } catch {
    npmPrefixCache = null;
  }
}

// Configuration file paths
export function getConfigFiles({ globalConfig, cacheDir } = {}) {
  const home = getHome();
  const platform = window.nodeAPI.os.platform();
  const nvmHome = window.nodeAPI.nvm?.getInstallDir?.() ?? window.nodeAPI.env.NVM_HOME;
  const windir = window.nodeAPI.env.WINDIR;
  const npmPrefix = npmPrefixCache || getDefaultNpmPrefix();

  return [
    {
      id: 'npmrc-user',
      name: '.npmrc (用户级)',
      description: '用户级 npm 配置文件',
      icon: 'mdi:file-cog-outline',
      path: window.nodeAPI.path.join(home, '.npmrc'),
      type: 'file',
    },
    {
      id: 'npmrc-global',
      name: '.npmrc (全局)',
      description: '全局 npm 配置文件',
      icon: 'mdi:file-cog-outline',
      path: globalConfig || window.nodeAPI.path.join(npmPrefix, 'etc', 'npmrc'),
      type: 'file',
    },
    {
      id: 'nvmrc',
      name: '.nvmrc',
      description: 'Node 版本声明文件（nvm）',
      icon: 'mdi:nodejs',
      path: window.nodeAPI.path.join(home, '.nvmrc'),
      type: 'file',
    },
    {
      id: 'node-version',
      name: '.node-version',
      description: 'Node 版本声明文件',
      icon: 'mdi:nodejs',
      path: window.nodeAPI.path.join(home, '.node-version'),
      type: 'file',
    },
    {
      id: 'hosts',
      name: 'hosts',
      description: '系统 hosts 文件',
      icon: 'mdi:server-network',
      path: platform === 'win32'
        ? window.nodeAPI.path.join(windir, 'System32', 'drivers', 'etc', 'hosts')
        : '/etc/hosts',
      type: 'file',
      needAdmin: true,
    },
    {
      id: 'npm-global-dir',
      name: 'npm 全局目录',
      description: 'npm 全局包安装目录',
      icon: 'mdi:folder-open-outline',
      path: platform === 'win32'
        ? window.nodeAPI.path.join(npmPrefix, 'node_modules')
        : window.nodeAPI.path.join(npmPrefix, 'lib', 'node_modules'),
      type: 'directory',
    },
    {
      id: 'npm-cache-dir',
      name: 'npm 缓存目录',
      description: 'npm 缓存目录',
      icon: 'mdi:cached',
      path: cacheDir || (platform === 'win32'
        ? window.nodeAPI.path.join(home, 'AppData', 'Local', 'npm-cache')
        : window.nodeAPI.path.join(home, '.npm')),
      type: 'directory',
    },
    {
      id: 'nvm-dir',
      name: 'nvm 安装目录',
      description: 'nvm-windows 安装目录',
      icon: 'mdi:folder-cog-outline',
      path: nvmHome || '',
      type: 'directory',
      requireNvm: true,
    },
  ];
}

// Get file by id
export function getConfigFileById(id) {
  return getConfigFiles().find((f) => f.id === id);
}
