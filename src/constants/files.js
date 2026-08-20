import { execFileCommand, getNpmExecutable } from '../utils/command.js';

// Get home directory
function getHome() {
  return window.nodeAPI.os.homedir();
}

// Cache for npm prefix
let npmPrefixCache = null;

// Get npm global prefix (cached)
function getNpmPrefix() {
  if (npmPrefixCache) return npmPrefixCache;
  try {
    // This will be populated on first access
    npmPrefixCache = window.nodeAPI.path.join(getHome(), 'AppData', 'Roaming', 'npm');
    return npmPrefixCache;
  } catch {
    return getHome();
  }
}

// Initialize npm prefix (call once)
export async function initNpmPrefix() {
  try {
    const prefix = await execFileCommand(getNpmExecutable(), ['prefix', '-g']);
    npmPrefixCache = prefix.trim();
  } catch {
    npmPrefixCache = window.nodeAPI.path.join(getHome(), 'AppData', 'Roaming', 'npm');
  }
}

// Configuration file paths
export function getConfigFiles() {
  const home = getHome();
  const platform = window.nodeAPI.os.platform();
  const nvmHome = window.nodeAPI.env.NVM_HOME;
  const windir = window.nodeAPI.env.WINDIR;

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
      path: window.nodeAPI.path.join(getNpmPrefix(), 'etc', '.npmrc'),
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
      path: window.nodeAPI.path.join(getNpmPrefix(), 'node_modules'),
      type: 'directory',
    },
    {
      id: 'npm-cache-dir',
      name: 'npm 缓存目录',
      description: 'npm 缓存目录',
      icon: 'mdi:cached',
      path: window.nodeAPI.path.join(home, 'AppData', 'Local', 'npm-cache'),
      type: 'directory',
    },
    {
      id: 'nvm-dir',
      name: 'nvm 安装目录',
      description: 'nvm-windows 安装目录',
      icon: 'mdi:folder-cog-outline',
      path: nvmHome || window.nodeAPI.path.join(home, 'AppData', 'Roaming', 'nvm'),
      type: 'directory',
      requireNvm: true,
    },
  ];
}

// Get file by id
export function getConfigFileById(id) {
  return getConfigFiles().find((f) => f.id === id);
}
