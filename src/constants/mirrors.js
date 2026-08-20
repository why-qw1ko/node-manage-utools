// Built-in mirror sources
export const BUILTIN_MIRRORS = [
  {
    name: 'npm 官方',
    registry: 'https://registry.npmjs.org/',
    icon: 'npm',
    iconSet: 'logos',
  },
  {
    name: '淘宝 npmmirror',
    registry: 'https://registry.npmmirror.com/',
    icon: 'shopping',
    iconSet: 'mdi',
  },
  {
    name: '华为云',
    registry: 'https://repo.huaweicloud.com/repository/npm/',
    icon: 'cloud',
    iconSet: 'mdi',
  },
  {
    name: '腾讯云',
    registry: 'https://mirrors.cloud.tencent.com/npm/',
    icon: 'domain',
    iconSet: 'mdi',
  },
];

// Default mirror
export const DEFAULT_MIRROR = BUILTIN_MIRRORS[0].registry;
