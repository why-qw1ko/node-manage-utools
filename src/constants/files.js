const configFiles = [
  {
    id: 'npmrc-user',
    name: '.npmrc (用户级)',
    description: '用户级 npm 配置文件',
    icon: 'mdi:file-cog-outline',
    type: 'file',
  },
  {
    id: 'npmrc-global',
    name: '.npmrc (全局)',
    description: '全局 npm 配置文件',
    icon: 'mdi:file-cog-outline',
    type: 'file',
  },
  {
    id: 'nvmrc',
    name: '.nvmrc',
    description: 'Node 版本声明文件（nvm）',
    icon: 'mdi:nodejs',
    type: 'file',
  },
  {
    id: 'node-version',
    name: '.node-version',
    description: 'Node 版本声明文件',
    icon: 'mdi:nodejs',
    type: 'file',
  },
  {
    id: 'hosts',
    name: 'hosts',
    description: '系统 hosts 文件',
    icon: 'mdi:server-network',
    type: 'file',
    needAdmin: true,
  },
  {
    id: 'npm-global-dir',
    name: 'npm 全局目录',
    description: 'npm 全局包安装目录',
    icon: 'mdi:folder-open-outline',
    type: 'directory',
  },
  {
    id: 'npm-cache-dir',
    name: 'npm 缓存目录',
    description: 'npm 缓存目录',
    icon: 'mdi:cached',
    type: 'directory',
  },
  {
    id: 'nvm-dir',
    name: 'nvm 安装目录',
    description: 'nvm-windows 安装目录',
    icon: 'mdi:folder-cog-outline',
    type: 'directory',
    requireNvm: true,
  },
];

async function getFileWithStatus(file) {
  return { ...file, ...await window.nodeAPI.fs.getConfigFileInfo(file.id) };
}

export function getConfigFiles() {
  return Promise.all(configFiles.map(getFileWithStatus));
}

export async function getConfigFileById(id) {
  const file = configFiles.find((entry) => entry.id === id);
  return file && getFileWithStatus(file);
}
