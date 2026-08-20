<script setup>
import { ref, computed, watch } from 'vue';
import IconNodejs from '~icons/mdi/nodejs';
import IconRefresh from '~icons/mdi/refresh';
import IconPlus from '~icons/mdi/plus';
import IconClose from '~icons/mdi/close';
import IconDownload from '~icons/mdi/download';
import IconFormatListBulleted from '~icons/mdi/format-list-bulleted';
import IconPackageVariant from '~icons/mdi/package-variant';
import IconMagnify from '~icons/mdi/magnify';
import IconLoading from '~icons/mdi/loading';
import IconLinkVariant from '~icons/mdi/link-variant';
import IconCheckCircle from '~icons/mdi/check-circle-outline';
import IconAlertCircle from '~icons/mdi/alert-circle-outline';
import VersionCard from '../components/VersionCard.vue';
import { getCurrentNodeVersion, listInstalledVersions, listAvailableVersions, installVersionWithProgress, uninstallVersion, useVersion } from '../utils/nvm.js';
import { getNodeMirror, getNpmMirror, setNodeMirror, setNpmMirror, PRESET_MIRRORS } from '../utils/nvm-mirror.js';
import { showSuccess, showError } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const props = defineProps({ hasNvm: Boolean });

const currentVersion = ref(null);
const currentLoading = ref(false);
const currentLoaded = ref(false);
const installedVersions = ref([]);
const availableVersions = ref([]);
const availableLoading = ref(false);
const availableError = ref('');
const loading = ref(false);
const versionsError = ref('');
const installingVersion = ref(null);
const uninstallingVersion = ref(null);
const showInstallDialog = ref(false);
const installInput = ref('');
const installStatus = ref('idle');
const installError = ref('');

// Search and filter state
const searchQuery = ref('');
const activeFilter = ref('all');

// Install progress state
const installProgress = ref('');
const installLogs = ref([]);

// Mirror config state
const nodeMirror = ref('');
const npmMirror = ref('');
const mirrorLoading = ref(false);
const mirrorError = ref('');

const filters = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '当前使用' },
  { id: 'lts', label: 'LTS' },
];

function formatNodeVersion(value) {
  const version = String(value || '').trim();
  if (!version) return '';
  return /^\d/.test(version) ? `v${version}` : version;
}

const filteredInstalledVersions = computed(() => {
  let list = installedVersions.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter((v) => v.version.includes(q));
  }
  if (activeFilter.value === 'active') {
    list = list.filter((v) => v.active);
  }
  return list;
});

const filteredAvailableVersions = computed(() => {
  let list = availableVersions.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter((v) => v.version.includes(q));
  }
  if (activeFilter.value === 'lts') {
    list = list.filter((v) => v.lts);
  }
  return list;
});

watch(() => props.hasNvm, (val) => { if (val) loadAll(); }, { immediate: true });

async function loadMirrors(silent = false) {
  mirrorLoading.value = true;
  mirrorError.value = '';
  try {
    const [node, npm] = await Promise.all([getNodeMirror(), getNpmMirror()]);
    nodeMirror.value = node;
    npmMirror.value = npm;
    if (!silent) showSuccess('安装源配置已刷新');
  } catch (err) {
    mirrorError.value = err.message || '安装源配置读取失败';
    if (!silent) showError(`刷新失败: ${mirrorError.value}`);
  }
  finally { mirrorLoading.value = false; }
}

async function handleSetNodeMirror(url) {
  mirrorLoading.value = true;
  try {
    await setNodeMirror(url);
    nodeMirror.value = url;
    showSuccess('Node 安装源已切换');
  } catch (err) { showError(`切换失败: ${err.message}`); }
  finally { mirrorLoading.value = false; }
}

async function handleSetNpmMirror(url) {
  mirrorLoading.value = true;
  try {
    await setNpmMirror(url);
    npmMirror.value = url;
    showSuccess('npm 安装源已切换');
  } catch (err) { showError(`切换失败: ${err.message}`); }
  finally { mirrorLoading.value = false; }
}

async function applyPreset(preset) {
  mirrorLoading.value = true;
  try {
    await Promise.all([
      setNodeMirror(preset.node),
      setNpmMirror(preset.npm),
    ]);
    nodeMirror.value = preset.node;
    npmMirror.value = preset.npm;
    showSuccess(`已应用${preset.name}`);
  } catch (err) {
    await loadMirrors(true);
    showError(`应用失败: ${err.message}`);
  } finally {
    mirrorLoading.value = false;
  }
}

async function loadAll() {
  availableLoading.value = true;
  availableError.value = '';
  const availableTask = listAvailableVersions()
    .then((versions) => { availableVersions.value = versions; })
    .catch((err) => {
      availableVersions.value = [];
      availableError.value = err.message || '可用版本读取失败';
    })
    .finally(() => { availableLoading.value = false; });

  await Promise.allSettled([
    refreshCurrent(true),
    refreshList(true),
    loadMirrors(true),
    availableTask,
  ]);
}

async function refreshCurrent(silent = false) {
  currentLoading.value = true;
  try {
    currentVersion.value = await getCurrentNodeVersion();
    currentLoaded.value = true;
    if (!silent) showSuccess('当前版本已刷新');
  } catch (err) {
    currentLoaded.value = true;
    if (!silent) showError(`刷新失败: ${err.message}`);
  } finally {
    currentLoading.value = false;
  }
}

async function refreshList(silent = false) {
  loading.value = true;
  versionsError.value = '';
  try {
    installedVersions.value = await listInstalledVersions();
    if (!silent) showSuccess('版本列表已刷新');
  } catch (err) {
    versionsError.value = err.message || '版本列表读取失败';
    if (!silent) showError(`刷新失败: ${versionsError.value}`);
  }
  finally { loading.value = false; }
}

async function handleUse(version) {
  installingVersion.value = version;
  try {
    await useVersion(version);
    showSuccess(`已切换到 Node.js v${version}`);
    await refreshCurrent(true);
    await refreshList(true);
  } catch (err) { showError(`切换失败: ${err.message}`); }
  finally { installingVersion.value = null; }
}

async function handleUninstall(version) {
  const confirmed = await confirmAction({
    title: '卸载 Node.js',
    message: `确定要卸载 Node.js v${version} 吗？该版本目录将被删除。`,
    confirmText: '卸载版本',
    danger: true,
  });
  if (!confirmed) return;
  uninstallingVersion.value = version;
  try {
    await uninstallVersion(version);
    showSuccess(`已卸载 Node.js v${version}`);
    await refreshList(true);
    await refreshCurrent(true);
  } catch (err) { showError(`卸载失败: ${err.message}`); }
  finally { uninstallingVersion.value = null; }
}

function openInstallDialog() {
  installStatus.value = 'idle';
  installError.value = '';
  installProgress.value = '';
  installLogs.value = [];
  installInput.value = '';
  showInstallDialog.value = true;
}

function closeInstallDialog() {
  if (installStatus.value === 'installing') return;
  showInstallDialog.value = false;
  installStatus.value = 'idle';
  installError.value = '';
  installProgress.value = '';
  installLogs.value = [];
  installInput.value = '';
}

async function handleInstall() {
  const v = installInput.value.trim();
  if (!v || installStatus.value === 'installing') return;
  installingVersion.value = v;
  installStatus.value = 'installing';
  installError.value = '';
  installProgress.value = '准备安装...';
  installLogs.value = [];
  try {
    const { promise } = installVersionWithProgress(v, (text) => {
      installLogs.value.push(text);
      // Extract progress info from nvm output
      const lines = text.split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1]?.trim();
      if (lastLine) installProgress.value = lastLine;
    });
    await promise;
    installStatus.value = 'success';
    showSuccess(`已安装 Node.js ${formatNodeVersion(v)}`);
    await refreshList(true);
    await refreshCurrent(true);
  } catch (err) {
    installStatus.value = 'error';
    installError.value = err.message;
    showError(`安装失败: ${err.message}`);
  } finally {
    installingVersion.value = null;
  }
}
</script>

<template>
  <div class="view">
    <div v-if="!hasNvm" class="no-nvm">
      <div class="empty-state">
        <IconNodejs class="empty-state-icon" />
        <h3 class="empty-state-title">未检测到 nvm-windows</h3>
        <p class="empty-state-desc">安装 nvm-windows 后即可管理多版本 Node.js。<br>如只需切换镜像源，请使用「镜像源」功能。</p>
        <a href="https://github.com/coreybutler/nvm-windows/releases" target="_blank" class="btn btn-primary" style="margin-top:16px">
          <IconDownload /> 下载 nvm-windows
        </a>
      </div>
    </div>

    <template v-else>
      <div class="section">
        <div class="section-header">
          <h2 class="section-title"><IconNodejs class="icon" /> 当前版本</h2>
          <button class="btn btn-sm btn-secondary" :disabled="currentLoading" @click="refreshCurrent()">
            <IconRefresh :class="{ spin: currentLoading }" /> {{ currentLoading ? '检测中' : '刷新' }}
          </button>
        </div>
        <div class="current-card">
          <div class="current-info">
            <IconNodejs class="current-icon" />
            <div>
              <span class="c-label">Node.js</span>
              <span class="c-num">
                {{ currentLoading ? '正在检测...' : !currentLoaded ? '等待检测' : currentVersion || '未检测到 Node.js' }}
              </span>
            </div>
          </div>
          <button class="btn btn-primary" :disabled="!!installingVersion" @click="openInstallDialog"><IconPlus /> 安装新版本</button>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title"><IconLinkVariant class="icon" /> 安装源配置</h2>
          <button class="btn btn-sm btn-secondary" :disabled="mirrorLoading" @click="loadMirrors()">
            <IconRefresh :class="{ spin: mirrorLoading }" /> {{ mirrorLoading ? '刷新中' : '刷新' }}
          </button>
        </div>
        <div v-if="mirrorError" class="inline-error">
          <IconAlertCircle /> <span>{{ mirrorError }}</span>
          <button class="btn btn-sm btn-ghost" @click="loadMirrors()">重试</button>
        </div>
        <div class="mirror-config-card">
          <div class="mirror-row">
            <span class="mirror-label">Node 安装源</span>
            <span class="mirror-value">{{ nodeMirror || '加载中...' }}</span>
            <div class="mirror-actions">
              <button v-for="p in PRESET_MIRRORS" :key="p.name" class="btn btn-sm btn-ghost" :disabled="mirrorLoading" @click="handleSetNodeMirror(p.node)">{{ p.name }}</button>
            </div>
          </div>
          <div class="mirror-row">
            <span class="mirror-label">npm 安装源</span>
            <span class="mirror-value">{{ npmMirror || '加载中...' }}</span>
            <div class="mirror-actions">
              <button v-for="p in PRESET_MIRRORS" :key="p.name" class="btn btn-sm btn-ghost" :disabled="mirrorLoading" @click="handleSetNpmMirror(p.npm)">{{ p.name }}</button>
            </div>
          </div>
          <div class="mirror-presets">
            <span class="mirror-preset-label">一键切换：</span>
            <button v-for="p in PRESET_MIRRORS" :key="p.name" class="btn btn-sm btn-secondary" :disabled="mirrorLoading" @click="applyPreset(p)">{{ p.name }}</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title"><IconFormatListBulleted class="icon" /> 已安装版本</h2>
          <button class="btn btn-sm btn-secondary" :disabled="loading" @click="refreshList()">
            <IconRefresh :class="{ spin: loading }" /> {{ loading ? '刷新中' : '刷新' }}
          </button>
        </div>
        <div class="filter-bar">
          <div class="search-wrap">
            <IconMagnify class="search-icon" />
            <input v-model="searchQuery" class="input search-input" placeholder="搜索版本..." />
          </div>
          <div class="filter-tags">
            <button v-for="f in filters" :key="f.id" class="btn btn-sm" :class="activeFilter === f.id ? 'btn-primary' : 'btn-ghost'" @click="activeFilter = f.id">{{ f.label }}</button>
          </div>
        </div>
        <div v-if="loading" class="skeleton-list">
          <div v-for="i in 3" :key="i" class="skeleton" style="height:52px;margin-bottom:8px" />
        </div>
        <div v-else-if="versionsError" class="empty-state" style="padding:32px">
          <IconAlertCircle class="empty-state-icon" style="width:36px;height:36px" />
          <p class="empty-state-desc">{{ versionsError }}</p>
          <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="refreshList()">重试</button>
        </div>
        <div v-else-if="filteredInstalledVersions.length === 0" class="empty-state" style="padding:32px">
          <IconPackageVariant class="empty-state-icon" style="width:36px;height:36px" />
          <p class="empty-state-desc">{{ searchQuery ? '未找到匹配的版本' : '暂无已安装的版本' }}</p>
        </div>
        <div v-else class="v-list">
          <VersionCard
            v-for="v in filteredInstalledVersions" :key="v.version"
            :version="v.version" :active="v.active"
            :installing="installingVersion === v.version" :uninstalling="uninstallingVersion === v.version"
            :disabled="!!installingVersion || !!uninstallingVersion"
            @use="handleUse" @uninstall="handleUninstall"
          />
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showInstallDialog" class="overlay" @click.self="closeInstallDialog" @keydown.esc="closeInstallDialog">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="node-install-title">
          <div class="d-head">
            <h3 id="node-install-title" class="d-title">安装 Node.js</h3>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="关闭" :disabled="installStatus === 'installing'" @click="closeInstallDialog"><IconClose /></button>
          </div>
          <div class="d-body">
            <template v-if="installStatus === 'idle'">
              <p class="d-hint">输入版本号，例如 20.11.0、20、lts、latest</p>
              <input v-model="installInput" class="input" placeholder="版本号" autofocus @keyup.enter="handleInstall" />
            </template>
            <div v-else-if="installStatus === 'installing'" class="dialog-status">
              <IconLoading class="dialog-status-icon spin" />
              <strong>正在安装 Node.js {{ formatNodeVersion(installInput) }}</strong>
              <p>{{ installProgress || '正在准备安装...' }}</p>
            </div>
            <div v-else-if="installStatus === 'success'" class="dialog-status success">
              <IconCheckCircle class="dialog-status-icon" />
              <strong>Node.js {{ formatNodeVersion(installInput) }} 安装成功</strong>
              <p>已刷新本地版本列表。</p>
            </div>
            <div v-else class="dialog-status error">
              <IconAlertCircle class="dialog-status-icon" />
              <strong>安装失败</strong>
              <p>{{ installError }}</p>
            </div>
            <div v-if="installStatus === 'idle' && availableLoading" class="d-hint" style="margin-top:16px">
              正在获取可用版本...
            </div>
            <div v-else-if="installStatus === 'idle' && availableError" class="d-hint" style="margin-top:16px;color:var(--warning)">
              可用版本获取失败，可直接输入版本号安装
            </div>
            <div v-else-if="installStatus === 'idle' && availableVersions.length" class="d-suggestions">
              <span class="d-sug-title">可用版本：</span>
              <div class="d-sug-list">
                <button v-for="v in filteredAvailableVersions.slice(0,12)" :key="v.version"
                  class="btn btn-sm btn-ghost" @click="installInput = v.version">
                  {{ v.version }}<span v-if="v.lts" class="tag" style="margin-left:4px">{{ v.lts }}</span>
                </button>
              </div>
            </div>
          </div>
          <div class="d-foot">
            <template v-if="installStatus === 'idle'">
              <button class="btn btn-secondary" @click="closeInstallDialog">取消</button>
              <button class="btn btn-primary" :disabled="!installInput.trim()" @click="handleInstall"><IconDownload /> 安装</button>
            </template>
            <span v-else-if="installStatus === 'installing'" class="d-hint">安装过程中请勿关闭插件</span>
            <template v-else-if="installStatus === 'error'">
              <button class="btn btn-secondary" @click="closeInstallDialog">关闭</button>
              <button class="btn btn-primary" @click="handleInstall"><IconRefresh /> 重试</button>
            </template>
            <button v-else class="btn btn-primary" @click="closeInstallDialog">完成</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.view { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 24px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.icon { width: 20px; height: 20px; color: var(--primary); }
.current-card { display: flex; align-items: center; justify-content: space-between; padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.current-info { display: flex; align-items: center; gap: 16px; }
.current-icon { width: 40px; height: 40px; color: var(--success); }
.c-label { display: block; font-size: 12px; color: var(--text-tertiary); }
.c-num { display: block; font-size: 20px; font-weight: 700; font-family: var(--font-mono); color: var(--text); }
.v-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-list { display: flex; flex-direction: column; }
.no-nvm { height: 100%; display: flex; align-items: center; justify-content: center; }
.filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.search-wrap { position: relative; flex: 1; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: 32px; }
.filter-tags { display: flex; gap: 4px; }
.mirror-config-card { padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.mirror-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.mirror-row:last-of-type { border-bottom: none; }
.mirror-label { font-size: 13px; font-weight: 600; color: var(--text); min-width: 100px; }
.mirror-value { flex: 1; font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mirror-actions { display: flex; gap: 4px; }
.mirror-presets { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.mirror-preset-label { font-size: 12px; color: var(--text-tertiary); }
.inline-error { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding: 9px 12px; color: var(--danger); background: var(--danger-dim); border-radius: var(--radius-md); font-size: 12px; }
.inline-error svg { width: 16px; height: 16px; flex-shrink: 0; }
.inline-error span { flex: 1; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fi .2s; }
@keyframes fi { from{opacity:0} to{opacity:1} }
.dialog { width: 420px; max-width: 90vw; background: var(--card); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); animation: su .3s cubic-bezier(.16,1,.3,1); }
@keyframes su { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
.d-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.d-title { font-size: 15px; font-weight: 700; color: var(--text); }
.d-body { padding: 20px; }
.d-hint { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
.d-suggestions { margin-top: 16px; }
.d-sug-title { display: block; font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px; }
.d-sug-list { display: flex; flex-wrap: wrap; gap: 6px; }
.d-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--border); }
.dialog-status { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 8px; text-align: center; color: var(--text); }
.dialog-status p { max-width: 360px; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 12px; }
.dialog-status-icon { width: 36px; height: 36px; color: var(--primary); }
.dialog-status.success .dialog-status-icon { color: var(--success); }
.dialog-status.error .dialog-status-icon { color: var(--danger); }
</style>
