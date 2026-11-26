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
import { getCurrentNodeVersion, listInstalledVersions, listAvailableVersions, installVersionWithProgress, uninstallVersion, cleanIncompleteVersion, useVersion } from '../utils/nvm.js';
import { getNodeMirror, getNpmMirror, setNodeMirror, setNpmMirror, applyMirrorPreset, OFFICIAL_NODE_MIRROR, PRESET_MIRRORS } from '../utils/nvm-mirror.js';
import { copyToClipboard, openExternal, showSuccess, showError } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const props = defineProps({
  hasNvm: Boolean,
  nvmStatus: { type: String, default: 'checking' },
  nvmError: { type: String, default: '' },
  versionRefreshId: { type: Number, default: 0 },
});
const emit = defineEmits(['recheck-nvm']);
const nvmDownloadUrl = 'https://github.com/coreybutler/nvm-windows/releases/latest';
const downloadError = ref('');

const currentVersion = ref(null);
const currentLoading = ref(false);
const currentLoaded = ref(false);
const currentError = ref('');
const installedVersions = ref([]);
const availableVersions = ref([]);
const availableLoading = ref(false);
const availableError = ref('');
let availableRequestId = 0;
const loading = ref(false);
const versionsError = ref('');
const versionActionError = ref('');
const installingVersion = ref(null);
const uninstallingVersion = ref(null);
const versionBusy = computed(() => Boolean(installingVersion.value || uninstallingVersion.value));
const showInstallDialog = ref(false);
const installInput = ref('');
const installStatus = ref('idle');
const installError = ref('');
const installErrorCode = ref('');
const installNeedsVerification = computed(() => ['ETIMEDOUT', 'NVM_RESULT_UNVERIFIED'].includes(installErrorCode.value));
const installSourceUnavailable = computed(() => installErrorCode.value === 'NVM_VERSION_UNAVAILABLE');

// Search and filter state
const searchQuery = ref('');
const activeFilter = ref('all');

// Install progress state
const installProgress = ref('');
const installCancelPending = ref(false);
let activeInstallTask;

// Mirror config state
const nodeMirror = ref('');
const npmMirror = ref('');
const mirrorLoading = ref(false);
const mirrorError = ref('');

const filters = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '当前使用' },
];

function formatNodeVersion(value) {
  const version = String(value || '').trim();
  if (!version) return '';
  return /^\d/.test(version) ? `v${version}` : version;
}

const filteredInstalledVersions = computed(() => {
  let list = installedVersions.value;
  if (searchQuery.value) {
    const q = searchQuery.value.trim().replace(/^v/i, '');
    list = list.filter((v) => v.version.includes(q));
  }
  if (activeFilter.value === 'active') {
    list = list.filter((v) => v.active);
  }
  return list;
});

watch(() => props.hasNvm, (val) => {
  if (val) loadAll();
  else if (showInstallDialog.value) closeInstallDialog();
}, { immediate: true });
watch(() => props.versionRefreshId, () => {
  if (props.hasNvm) refreshVersionState();
});

function handleDownloadNvm(event) {
  downloadError.value = '';
  if (!window.utools) return;

  event.preventDefault();
  if (!openExternal(nvmDownloadUrl)) {
    downloadError.value = '无法打开浏览器。请复制下载链接后在浏览器中打开。';
  }
}

async function handleCopyNvmLink() {
  try {
    if (window.utools) {
      if (!copyToClipboard(nvmDownloadUrl)) throw new Error('复制失败');
    } else {
      await navigator.clipboard.writeText(nvmDownloadUrl);
    }
    showSuccess('已复制下载链接');
  } catch {
    downloadError.value = '无法自动复制，请手动复制下方链接。';
  }
}

async function loadMirrors(silent = false) {
  if (mirrorLoading.value) return;
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
  if (mirrorLoading.value || versionBusy.value) return false;
  mirrorLoading.value = true;
  try {
    await setNodeMirror(url);
    nodeMirror.value = url;
    showSuccess('Node 安装源已切换');
    return true;
  } catch (err) {
    showError(`切换失败: ${err.message}`);
    return false;
  }
  finally { mirrorLoading.value = false; }
}

async function handleSetNpmMirror(url) {
  if (mirrorLoading.value || versionBusy.value) return;
  mirrorLoading.value = true;
  try {
    await setNpmMirror(url);
    npmMirror.value = url;
    showSuccess('npm 安装源已切换');
  } catch (err) { showError(`切换失败: ${err.message}`); }
  finally { mirrorLoading.value = false; }
}

async function applyPreset(preset) {
  if (mirrorLoading.value || versionBusy.value) return;
  mirrorLoading.value = true;
  try {
    const settings = await applyMirrorPreset(preset);
    nodeMirror.value = settings.node_mirror;
    npmMirror.value = settings.npm_mirror;
    mirrorError.value = '';
    showSuccess(`已应用${preset.name}`);
  } catch (err) {
    showError(`应用失败: ${err.message}`);
  } finally {
    mirrorLoading.value = false;
  }
}

async function refreshAvailable() {
  const requestId = ++availableRequestId;
  availableLoading.value = true;
  availableError.value = '';
  availableVersions.value = [];
  try {
    const versions = await listAvailableVersions();
    if (requestId === availableRequestId) availableVersions.value = versions;
  } catch (err) {
    if (requestId === availableRequestId) availableError.value = err.message || '可用版本读取失败';
  } finally {
    if (requestId === availableRequestId) availableLoading.value = false;
  }
}

async function loadAll() {
  await Promise.allSettled([refreshVersionState(), loadMirrors(true)]);
}

function refreshVersionState() {
  return Promise.all([refreshCurrent(true), refreshList(true)]);
}

async function refreshCurrent(silent = false) {
  currentLoading.value = true;
  currentError.value = '';
  try {
    currentVersion.value = await getCurrentNodeVersion();
    currentLoaded.value = true;
    if (!silent) showSuccess('当前版本已刷新');
  } catch (err) {
    currentVersion.value = null;
    currentLoaded.value = true;
    currentError.value = err.message || '当前 Node.js 版本检测失败';
  } finally {
    currentLoading.value = false;
  }
}

async function refreshList(silent = false) {
  loading.value = true;
  versionsError.value = '';
  try {
    const versions = await listInstalledVersions();
    installedVersions.value = versions.map((entry) => {
      try {
        const { hasExecutable } = window.nodeAPI.fs.inspectNvmVersion(entry.version, entry.path);
        return { ...entry, status: hasExecutable ? 'ready' : 'incomplete' };
      } catch {
        return { ...entry, status: 'unverified' };
      }
    });
    if (!silent) showSuccess('版本列表已刷新');
  } catch (err) {
    versionsError.value = err.message || '版本列表读取失败';
    if (!silent) showError(`刷新失败: ${versionsError.value}`);
  }
  finally { loading.value = false; }
}

async function handleUse(version) {
  if (!props.hasNvm || versionBusy.value || showInstallDialog.value) return;
  versionActionError.value = '';
  installingVersion.value = version;
  try {
    await useVersion(version);
    showSuccess(`已切换到 Node.js v${version}`);
  } catch (error) {
    versionActionError.value = `切换失败。${error.message}`;
  } finally {
    await refreshVersionState();
    installingVersion.value = null;
  }
}

async function handleUninstall({ version, path, status }) {
  if (!props.hasNvm || versionBusy.value || showInstallDialog.value) return;
  versionActionError.value = '';
  if (!path) {
    versionActionError.value = '无法确认版本目录。请刷新已安装版本列表后重试。';
    return;
  }
  const incomplete = status === 'incomplete';
  const actionLabel = incomplete ? '清理残留' : '卸载版本';
  const confirmed = await confirmAction({
    title: incomplete ? '清理未完成的安装' : '卸载 Node.js',
    message: incomplete
      ? `删除 Node.js v${version} 未完成的下载文件和空目录。\n\n${path}`
      : `卸载 Node.js v${version} 会删除此版本目录及其中安装的全局 npm 包。\n\n${path}`,
    confirmText: actionLabel,
    danger: true,
  });
  if (!confirmed || !props.hasNvm || versionBusy.value || showInstallDialog.value) return;
  uninstallingVersion.value = version;
  try {
    if (incomplete) {
      await cleanIncompleteVersion(version, path);
      showSuccess(`已清理 Node.js v${version} 的安装残留`);
    } else {
      await uninstallVersion(version, path);
      showSuccess(`已卸载 Node.js v${version}`);
    }
  } catch (error) {
    versionActionError.value = `${actionLabel}失败。${error.message}`;
  } finally {
    await refreshVersionState();
    uninstallingVersion.value = null;
  }
}

function openInstallDialog(version = '') {
  if (!props.hasNvm || versionBusy.value || showInstallDialog.value) return;
  installStatus.value = 'idle';
  installError.value = '';
  installErrorCode.value = '';
  installProgress.value = '';
  installInput.value = version;
  showInstallDialog.value = true;
  refreshAvailable();
}

function closeInstallDialog() {
  if (installStatus.value === 'installing') return;
  showInstallDialog.value = false;
  installStatus.value = 'idle';
  installError.value = '';
  installErrorCode.value = '';
  installProgress.value = '';
  installInput.value = '';
}

function reviewInstalledVersions() {
  closeInstallDialog();
  if (props.hasNvm) refreshVersionState();
}

async function switchInstallToOfficialMirror() {
  if (!await handleSetNodeMirror(OFFICIAL_NODE_MIRROR) || !showInstallDialog.value) return;
  installError.value = '';
  installErrorCode.value = '';
  installStatus.value = 'idle';
  refreshAvailable();
}

function cancelInstall() {
  if (!activeInstallTask || installCancelPending.value) return;
  try {
    if (activeInstallTask.kill()) installCancelPending.value = true;
    else installProgress.value = '取消请求未生效，正在等待 NVM 返回结果。';
  } catch {
    showError('无法取消安装，请等待 NVM 返回结果');
  }
}

async function handleInstall() {
  const v = installInput.value.trim();
  if (!v || !props.hasNvm || versionBusy.value || mirrorLoading.value || installNeedsVerification.value) return;
  installingVersion.value = v;
  installStatus.value = 'installing';
  installError.value = '';
  installErrorCode.value = '';
  installProgress.value = '准备安装...';
  try {
    activeInstallTask = installVersionWithProgress(v, (text) => {
      // Extract progress info from nvm output
      const lines = text.split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1]?.trim();
      if (lastLine) installProgress.value = lastLine;
    });
    await activeInstallTask.promise;
    await refreshVersionState();
    installStatus.value = 'success';
    showSuccess(`已安装 Node.js ${formatNodeVersion(v)}`);
  } catch (err) {
    if (err.code === 'ECANCELED') {
      installStatus.value = 'cancelled';
      await refreshVersionState();
      return;
    }
    installStatus.value = 'error';
    installError.value = err.message;
    installErrorCode.value = err.code || '';
  } finally {
    activeInstallTask = undefined;
    installCancelPending.value = false;
    installingVersion.value = null;
  }
}
</script>

<template>
  <div class="view">
    <div v-if="!hasNvm" class="no-nvm">
      <div class="empty-state">
        <IconNodejs class="empty-state-icon" />
        <h3 v-if="nvmStatus === 'checking'" class="empty-state-title" role="status">正在检测 nvm-windows…</h3>
        <h3 v-else-if="nvmStatus === 'unsupported'" class="empty-state-title">nvm-windows 仅适用于 Windows</h3>
        <template v-else>
          <h3 class="empty-state-title">{{ nvmStatus === 'error' ? '无法检测 nvm-windows' : '未检测到 nvm-windows' }}</h3>
          <p v-if="nvmError" class="empty-state-desc" role="alert">{{ nvmError }}</p>
          <p class="empty-state-desc">从 GitHub 官方发布页下载 nvm-setup.exe 并手动运行。安装后请重新检测，如仍未检测到，请退出并重新打开 uTools。</p>
          <div class="nvm-actions">
            <a :href="nvmDownloadUrl" target="_blank" rel="noopener noreferrer" class="btn btn-primary" @click="handleDownloadNvm">
              <IconDownload /> 下载 nvm-windows
            </a>
            <button type="button" class="btn btn-secondary" @click="emit('recheck-nvm')">
              <IconRefresh /> 重新检测
            </button>
            <button type="button" class="btn btn-ghost" @click="handleCopyNvmLink">复制下载链接</button>
          </div>
          <template v-if="downloadError">
            <p class="empty-state-desc nvm-download-error" role="alert">{{ downloadError }}</p>
            <input class="input nvm-download-link" aria-label="NVM 下载链接" :value="nvmDownloadUrl" readonly @focus="$event.target.select()" />
          </template>
        </template>
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
                {{ currentLoading ? '正在检测...' : currentError ? '检测失败' : !currentLoaded ? '等待检测' : currentVersion || '未检测到 Node.js' }}
              </span>
            </div>
          </div>
          <button class="btn btn-primary" :disabled="versionBusy || mirrorLoading" @click="openInstallDialog()"><IconPlus /> 安装新版本</button>
        </div>
        <div v-if="currentError" class="inline-error current-error" role="alert">
          <IconAlertCircle /> <span>{{ currentError }}</span>
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
              <button v-for="p in PRESET_MIRRORS" :key="p.name" class="btn btn-sm btn-ghost" :disabled="mirrorLoading || versionBusy" @click="handleSetNodeMirror(p.node)">{{ p.name }}</button>
            </div>
          </div>
          <div class="mirror-row">
            <span class="mirror-label">npm 安装源</span>
            <span class="mirror-value">{{ npmMirror || '加载中...' }}</span>
            <div class="mirror-actions">
              <button v-for="p in PRESET_MIRRORS" :key="p.name" class="btn btn-sm btn-ghost" :disabled="mirrorLoading || versionBusy" @click="handleSetNpmMirror(p.npm)">{{ p.name }}</button>
            </div>
          </div>
          <div class="mirror-presets">
            <span class="mirror-preset-label">一键切换：</span>
            <button v-for="p in PRESET_MIRRORS" :key="p.name" class="btn btn-sm btn-secondary" :disabled="mirrorLoading || versionBusy" @click="applyPreset(p)">{{ p.name }}</button>
          </div>
        </div>
        <p class="d-hint">安装源变更前会在 NVM 安装目录备份 settings.txt，备份文件名为 settings.txt.mirror-backup。</p>
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title"><IconFormatListBulleted class="icon" /> 本地版本</h2>
          <button class="btn btn-sm btn-secondary" :disabled="loading" @click="refreshList()">
            <IconRefresh :class="{ spin: loading }" /> {{ loading ? '刷新中' : '刷新' }}
          </button>
        </div>
        <div v-if="versionActionError" class="inline-error" role="alert">
          <IconAlertCircle /> <span>{{ versionActionError }}</span>
          <button class="btn btn-sm btn-ghost" @click="versionActionError = ''">关闭</button>
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
          <p class="empty-state-desc">{{ searchQuery.trim() ? '未找到匹配的版本' : activeFilter === 'active' ? '暂无正在使用的 NVM 版本' : '暂无已安装的版本' }}</p>
        </div>
        <div v-else class="v-list">
          <VersionCard
            v-for="v in filteredInstalledVersions" :key="v.version"
            :version="v.version" :active="v.active" :status="v.status"
            :installing="installingVersion === v.version" :uninstalling="uninstallingVersion === v.version"
            :disabled="versionBusy"
            @use="handleUse" @uninstall="handleUninstall(v)" @reinstall="openInstallDialog(v.version)"
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
            <template v-if="installStatus === 'idle' || (installStatus === 'error' && !installNeedsVerification)">
              <p class="d-hint">输入版本号，例如 20.11.0、20、lts、latest</p>
              <input v-model="installInput" class="input" placeholder="版本号" autofocus @keyup.enter="handleInstall" />
            </template>
            <div v-if="installStatus === 'installing'" class="dialog-status" role="status">
              <IconLoading class="dialog-status-icon spin" />
              <strong>{{ installCancelPending ? '正在取消安装' : `正在安装 Node.js ${formatNodeVersion(installInput)}` }}</strong>
              <p>{{ installCancelPending ? '正在等待 NVM 进程退出。' : installProgress || '正在准备安装...' }}</p>
            </div>
            <div v-else-if="installStatus === 'cancelled'" class="dialog-status" role="status">
              <strong>已取消安装</strong>
              <p>可在本地版本列表中重新安装，或清理留下的下载文件。</p>
            </div>
            <div v-else-if="installStatus === 'success'" class="dialog-status success">
              <IconCheckCircle class="dialog-status-icon" />
              <strong>Node.js {{ formatNodeVersion(installInput) }} 安装成功</strong>
            </div>
            <div v-else-if="installStatus === 'error'" class="dialog-status error" role="alert">
              <IconAlertCircle class="dialog-status-icon" />
              <strong v-if="installSourceUnavailable">当前 Node 安装源的版本检查未通过</strong>
              <strong v-else>{{ installNeedsVerification ? '无法确认安装结果' : '安装失败' }}</strong>
              <p>{{ installError }}</p>
              <p v-if="installSourceUnavailable && nodeMirror !== OFFICIAL_NODE_MIRROR">镜像的最新版本清单可能尚未同步。可切换 Node 官方源后重试。</p>
              <p v-if="installNeedsVerification">安装状态可能已变化。请先查看已安装版本，再决定是否重试。</p>
            </div>
            <div v-if="installStatus === 'idle' && availableLoading" class="d-hint" style="margin-top:16px">
              正在获取可用版本...
            </div>
            <div v-else-if="installStatus === 'idle' && availableError" class="d-hint" style="margin-top:16px;color:var(--warning)">
              可用版本获取失败，可直接输入版本号安装
              <button type="button" class="btn btn-sm btn-ghost" @click="refreshAvailable">重试获取</button>
            </div>
            <div v-else-if="installStatus === 'idle' && availableVersions.length" class="d-suggestions">
              <span class="d-sug-title">近期稳定版本（来自 nvm-windows）</span>
              <div class="d-sug-list">
                <button v-for="v in availableVersions.slice(0,12)" :key="v.version"
                  class="btn btn-sm btn-ghost" @click="installInput = v.version">
                  {{ v.version }}<span v-if="v.lts" class="tag" style="margin-left:4px">{{ v.lts }}</span>
                </button>
              </div>
            </div>
          </div>
          <div class="d-foot">
            <template v-if="installStatus === 'idle'">
              <button class="btn btn-secondary" @click="closeInstallDialog">取消</button>
              <button class="btn btn-primary" :disabled="!hasNvm || !installInput.trim() || versionBusy || mirrorLoading" @click="handleInstall"><IconDownload /> 安装</button>
            </template>
            <button v-else-if="installStatus === 'installing'" type="button" class="btn btn-secondary" :disabled="installCancelPending" @click="cancelInstall">
              {{ installCancelPending ? '正在取消…' : '取消安装' }}
            </button>
            <template v-else-if="installStatus === 'error'">
              <button class="btn btn-secondary" @click="closeInstallDialog">关闭</button>
              <button v-if="installNeedsVerification" class="btn btn-primary" @click="reviewInstalledVersions"><IconRefresh /> 查看已安装版本</button>
              <button v-else-if="installSourceUnavailable && nodeMirror !== OFFICIAL_NODE_MIRROR" class="btn btn-primary" :disabled="mirrorLoading" @click="switchInstallToOfficialMirror">切换 Node 官方源</button>
              <button v-else class="btn btn-primary" :disabled="!hasNvm || !installInput.trim() || versionBusy || mirrorLoading" @click="handleInstall"><IconRefresh /> 重试</button>
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
.current-error { margin-top: 12px; }
.current-info { display: flex; align-items: center; gap: 16px; }
.current-icon { width: 40px; height: 40px; color: var(--success); }
.c-label { display: block; font-size: 12px; color: var(--text-tertiary); }
.c-num { display: block; font-size: 20px; font-weight: 700; font-family: var(--font-mono); color: var(--text); }
.v-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-list { display: flex; flex-direction: column; }
.no-nvm { height: 100%; display: flex; align-items: center; justify-content: center; }
.no-nvm .empty-state { min-width: 0; }
.no-nvm .empty-state-desc { overflow-wrap: anywhere; }
.nvm-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 16px; }
.nvm-download-error { color: var(--danger); margin-top: 16px; }
.nvm-download-link { width: 100%; margin: 8px 0; }
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
