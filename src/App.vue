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
import { isNvmInstalled, normalizeNodeVersion, useVersion } from './utils/nvm.js';
import { openPath, showSuccess, showError, showWarning } from './utils/utools.js';
import { confirmAction, settleConfirm } from './utils/confirm.js';
import { getConfigFileById } from './constants/files.js';
import { removeLegacyRegistryCache } from './utils/store.js';

const activeTab = ref('node');
const nvmStatus = ref('checking');
const nvmError = ref('');
const hasNvm = computed(() => nvmStatus.value === 'installed');
const versionRefreshId = ref(0);
const projectVersionFiles = ['.nvmrc', '.node-version'];
let nvmReady = null;
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
const activeViewProps = computed(() => {
  if (activeTab.value === 'node') {
    return {
      hasNvm: hasNvm.value,
      nvmStatus: nvmStatus.value,
      nvmError: nvmError.value,
      versionRefreshId: versionRefreshId.value,
      onRecheckNvm: refreshNvm,
    };
  }
  return activeTab.value === 'config' ? { hasNvm: hasNvm.value } : {};
});

async function checkNvm() {
  if (nvmStatus.value !== 'installed') nvmStatus.value = 'checking';
  nvmError.value = '';
  try {
    const platform = window.nodeAPI?.os?.platform();
    if (platform && platform !== 'win32') {
      nvmStatus.value = 'unsupported';
      return;
    }
    nvmStatus.value = await isNvmInstalled() ? 'installed' : 'missing';
  } catch (error) {
    nvmError.value = error.message || '检测失败，请重试。';
    nvmStatus.value = 'error';
  }
}

function refreshNvm() {
  nvmReady ??= checkNvm().finally(() => { nvmReady = null; });
  return nvmReady;
}

function readProjectVersion(dirPath) {
  const { fs } = window.nodeAPI;
  if (typeof fs.readSmallTextFileSync !== 'function') {
    throw new Error('无法读取项目版本声明。请重新加载插件后重试。');
  }
  for (const source of projectVersionFiles) {
    let content;
    try {
      content = fs.readSmallTextFileSync(dirPath, source);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (error.code === 'EFBIG') throw new Error(`${source} 超过 4 KB，请检查版本文件。`);
      if (error.code === 'EINVAL' || error.code === 'EILSEQ') {
        throw new Error(`${source} 必须是普通的 UTF-8 文本文件。`);
      }
      throw new Error(`无法读取 ${source}，请检查文件权限后重试。`);
    }
    try {
      return { version: normalizeNodeVersion(content), source };
    } catch {
      throw new Error(`${source} 中的 Node.js 版本格式无效，例如可填写 22.14.0 或 lts。`);
    }
  }
  return null;
}

async function detectProjectVersion(dirPath) {
  let declaration;
  try {
    declaration = readProjectVersion(dirPath);
  } catch (error) {
    showError(error.message);
    return;
  }
  if (!declaration) {
    showWarning('项目中未找到 .nvmrc 或 .node-version');
    return;
  }

  const { source, version } = declaration;
  const versionLabel = /^\d/.test(version) ? `v${version}` : version;
  const shouldSwitch = await confirmAction({
    title: '切换 Node.js 版本',
    message: `项目中的 ${source} 请求使用 Node.js ${versionLabel}。切换会更改 NVM 当前版本。`,
    confirmText: '切换版本',
  });
  if (!shouldSwitch) return;

  try {
    await useVersion(version);
    showSuccess(`已切换到 Node.js ${versionLabel}`);
  } catch (error) {
    showError(`切换失败。${error.message}`);
  } finally {
    versionRefreshId.value += 1;
  }
}

async function handlePluginEnter(action) {
  if (!action?.code) return;
  const nvmCheck = refreshNvm();

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
    if (fileId === 'nvm-dir') {
      await nvmCheck;
      if (!hasNvm.value) {
        activeTab.value = 'node';
        return;
      }
    }
    try {
      const file = await getConfigFileById(fileId);
      if (!file?.exists) {
        activeTab.value = 'config';
        showError(`找不到${file?.name || '目标路径'}`);
      } else if (!openPath(file.path)) {
        activeTab.value = 'config';
        showError(`无法打开${file.name}，可在配置文件页核对并复制路径`);
      }
    } catch {
      activeTab.value = 'config';
      showError('无法打开目标路径');
    }
    return;
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
    const { path: filePath, isFile } = action.payload[0] || {};
    if (filePath) {
      await nvmCheck;
      if (!hasNvm.value) return;
      try {
        const dirPath = isFile === true ? window.nodeAPI.path.dirname(filePath) : filePath;
        await detectProjectVersion(dirPath);
      } catch {
        showError('无法读取项目路径');
      }
    }
  }
}

onMounted(() => {
  removeLegacyRegistryCache();
  refreshNvm();
  window.utools?.onPluginEnter?.(handlePluginEnter);
  window.utools?.onPluginOut?.(() => settleConfirm(false));
});
</script>

<template>
  <div class="app-layout">
    <Sidebar :active-tab="activeTab" @change="(t) => activeTab = t" />
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
