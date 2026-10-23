<script setup>
import { ref, computed, onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import NodeManager from './views/NodeManager.vue';
import MirrorManager from './views/MirrorManager.vue';
import PackageManager from './views/PackageManager.vue';
import ConfigFiles from './views/ConfigFiles.vue';
import EnvManager from './views/EnvManager.vue';
import ProcessManager from './views/ProcessManager.vue';
import FolderUnlock from './views/FolderUnlock.vue';
import DiskUsage from './views/DiskUsage.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { isNvmInstalled, useVersion } from './utils/nvm.js';
import { openPath, showSuccess, showError } from './utils/utools.js';
import { confirmAction } from './utils/confirm.js';
import { getConfigFileById, initNpmPrefix } from './constants/files.js';
import { removeLegacyRegistryCache } from './utils/store.js';

const activeTab = ref('node');
const hasNvm = ref(false);
let npmPrefixReady = Promise.resolve();
let nvmReady = Promise.resolve();
const views = {
  node: NodeManager,
  mirror: MirrorManager,
  packages: PackageManager,
  config: ConfigFiles,
  env: EnvManager,
  process: ProcessManager,
  unlock: FolderUnlock,
  disk: DiskUsage,
};
const activeView = computed(() => views[activeTab.value] || NodeManager);
const activeViewProps = computed(() => (
  ['node', 'config'].includes(activeTab.value) ? { hasNvm: hasNvm.value } : {}
));

async function checkNvm() {
  try { hasNvm.value = await isNvmInstalled(); } catch { /* */ }
}

/**
 * Detect .nvmrc or .node-version in project directory
 * @param {string} dirPath
 */
async function detectProjectVersion(dirPath) {
  if (!hasNvm.value || !dirPath) return;
  const fs = window.nodeAPI.fs;
  const path = window.nodeAPI.path;
  let version = null;
  let source = null;

  // Check .nvmrc
  const nvmrcPath = path.join(dirPath, '.nvmrc');
  if (fs.existsSync(nvmrcPath)) {
    try {
      version = fs.readFileSync(nvmrcPath, 'utf-8').trim();
      source = '.nvmrc';
    } catch { /* */ }
  }

  // Check .node-version if no .nvmrc
  if (!version) {
    const nodeVersionPath = path.join(dirPath, '.node-version');
    if (fs.existsSync(nodeVersionPath)) {
      try {
        version = fs.readFileSync(nodeVersionPath, 'utf-8').trim();
        source = '.node-version';
      } catch { /* */ }
    }
  }

  if (version && source) {
    const shouldSwitch = await confirmAction({
      title: '切换 Node.js 版本',
      message: `检测到 ${source} 文件要求使用 Node.js v${version}，是否切换？`,
      confirmText: '切换版本',
    });
    if (shouldSwitch) {
      try {
        await useVersion(version);
        showSuccess(`已切换到 Node.js v${version}`);
      } catch (err) {
        showError(`切换失败: ${err.message}`);
      }
    }
  }
}

async function handlePluginEnter(action) {
  if (!action?.code) return;

  // Direct open: config file shortcuts
  const directOpenMap = {
    'open-npmrc': 'npmrc-user',
    'open-nvmrc': 'nvmrc',
    'open-node-version': 'node-version',
    'open-hosts': 'hosts',
    'open-npm-config': 'npm-global-dir',
    'open-nvm-dir': 'nvm-dir',
  };
  const fileId = directOpenMap[action.code];
  if (fileId) {
    if (fileId === 'npm-global-dir') await npmPrefixReady;
    const file = getConfigFileById(fileId);
    if (file) { openPath(file.path); return; }
  }

  // Tab navigation
  if (action.code === 'mirror-manager') activeTab.value = 'mirror';
  else if (action.code === 'node-manager') activeTab.value = 'node';
  else if (action.code === 'package-manager') activeTab.value = 'packages';
  else if (action.code === 'env-manager') activeTab.value = 'env';
  else if (action.code === 'process-manager') activeTab.value = 'process';
  else if (action.code === 'folder-unlock') activeTab.value = 'unlock';
  else if (action.code === 'disk-usage') activeTab.value = 'disk';

  // Detect project version when entering with a path
  if (action.type === 'files' && action.payload?.length > 0) {
    const filePath = action.payload[0]?.path;
    if (filePath) {
      await nvmReady;
      try {
        const dirPath = window.nodeAPI.fs.statSync(filePath).isDirectory()
          ? filePath
          : window.nodeAPI.path.dirname(filePath);
        detectProjectVersion(dirPath);
      } catch {
        showError('无法读取项目路径');
      }
    }
  }
}

onMounted(async () => {
  removeLegacyRegistryCache();
  npmPrefixReady = initNpmPrefix();
  nvmReady = checkNvm();
  if (window.utools?.onPluginEnter) {
    window.utools.onPluginEnter(handlePluginEnter);
  }
  await Promise.all([npmPrefixReady, nvmReady]);
});
</script>

<template>
  <div class="app-layout">
    <Sidebar :active-tab="activeTab" :has-nvm="hasNvm" @change="(t) => activeTab = t" />
    <main class="app-main">
      <KeepAlive>
        <component :is="activeView" v-bind="activeViewProps" />
      </KeepAlive>
    </main>
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.app-layout { display: flex; height: 100vh; overflow: hidden; }
.app-main { flex: 1; min-width: 0; overflow: hidden; }
</style>
