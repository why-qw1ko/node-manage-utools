import { withLocalMutation } from './command.js';
import { redactCredentials } from './credentials.js';

export const OFFICIAL_NODE_MIRROR = 'https://nodejs.org/dist/';

function normalizeMirrorUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || raw.length > 2048) throw new Error('安装源地址无效');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('仅支持 HTTP/HTTPS 安装源');
  }
  if (parsed.username || parsed.password) throw new Error('安装源地址不能包含账号或密码');
  return parsed.href;
}

/**
 * Get current nvm node mirror
 * @returns {Promise<string>}
 */
export async function getNodeMirror() {
  const settings = window.nodeAPI.nvm?.getSettings?.() || {};
  return redactCredentials(settings.node_mirror) || OFFICIAL_NODE_MIRROR;
}

/**
 * Get current nvm npm mirror
 * @returns {Promise<string>}
 */
export async function getNpmMirror() {
  const settings = window.nodeAPI.nvm?.getSettings?.() || {};
  return redactCredentials(settings.npm_mirror) || 'https://github.com/npm/cli/archive/';
}

/**
 * Set nvm node mirror
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function setNodeMirror(url) {
  return withLocalMutation(() => window.nodeAPI.nvm.setMirror('node_mirror', normalizeMirrorUrl(url)));
}

/**
 * Set nvm npm mirror
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function setNpmMirror(url) {
  return withLocalMutation(() => window.nodeAPI.nvm.setMirror('npm_mirror', normalizeMirrorUrl(url)));
}

export async function applyMirrorPreset({ node, npm }) {
  return withLocalMutation(() => window.nodeAPI.nvm.setMirrors({
    node_mirror: normalizeMirrorUrl(node),
    npm_mirror: normalizeMirrorUrl(npm),
  }));
}

// Preset mirror configurations
export const PRESET_MIRRORS = [
  {
    name: '官方源',
    node: OFFICIAL_NODE_MIRROR,
    npm: 'https://github.com/npm/cli/archive/',
  },
  {
    name: '淘宝镜像',
    node: 'https://npmmirror.com/mirrors/node/',
    npm: 'https://npmmirror.com/mirrors/npm/',
  },
  {
    name: '华为云镜像',
    node: 'https://repo.huaweicloud.com/nodejs/',
    npm: 'https://repo.huaweicloud.com/npm/',
  },
];
