<script setup>
import { ref, computed, onMounted } from 'vue';
import IconPackageVariant from '~icons/mdi/package-variant';
import IconRefresh from '~icons/mdi/refresh';
import IconPlus from '~icons/mdi/plus';
import IconClose from '~icons/mdi/close';
import IconMagnify from '~icons/mdi/magnify';
import IconDownload from '~icons/mdi/download';
import IconLoading from '~icons/mdi/loading';
import PackageCard from '../components/PackageCard.vue';
import { getGlobalPackages, installGlobalPackage, uninstallGlobalPackage, normalizePackageSpec } from '../utils/npm.js';
import { showSuccess, showError } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const packages = ref([]);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref('');
const searchQuery = ref('');
const showInstallDialog = ref(false);
const installInput = ref('');
const installingPkg = ref(null);
const operatingPkg = ref(null);

const filteredPackages = computed(() => {
  if (!searchQuery.value) return packages.value;
  const q = searchQuery.value.toLowerCase();
  return packages.value.filter((p) => p.name.toLowerCase().includes(q));
});

async function loadPackages(silent = false) {
  loading.value = true;
  loadError.value = '';
  try {
    packages.value = await getGlobalPackages();
    loaded.value = true;
    if (!silent) showSuccess('全局包列表已刷新');
  } catch (err) {
    loaded.value = true;
    loadError.value = err.message || '全局包读取失败';
    if (!silent) showError(`刷新失败: ${loadError.value}`);
  }
  finally {
    loading.value = false;
  }
}

function openInstallDialog() {
  installInput.value = '';
  showInstallDialog.value = true;
}

function closeInstallDialog() {
  if (installingPkg.value) return;
  showInstallDialog.value = false;
  installInput.value = '';
}

async function handleInstall() {
  const name = installInput.value.trim();
  if (!name) return;
  try {
    normalizePackageSpec(name);
  } catch (err) {
    showError(err.message);
    return;
  }
  installingPkg.value = name;
  try {
    await installGlobalPackage(name);
    showSuccess(`已安装 ${name}`);
    showInstallDialog.value = false;
    installInput.value = '';
    await loadPackages(true);
  } catch (err) {
    showError(`安装失败: ${err.message}`);
  } finally {
    installingPkg.value = null;
  }
}

async function handleUninstall(name) {
  const confirmed = await confirmAction({
    title: '卸载全局包',
    message: `确定要卸载全局包 ${name} 吗？`,
    confirmText: '卸载',
    danger: true,
  });
  if (!confirmed) return;
  operatingPkg.value = name;
  try {
    await uninstallGlobalPackage(name);
    showSuccess(`已卸载 ${name}`);
    await loadPackages(true);
  } catch (err) {
    showError(`卸载失败: ${err.message}`);
  } finally {
    operatingPkg.value = null;
  }
}

async function handleUpdate(name) {
  operatingPkg.value = name;
  try {
    await installGlobalPackage(name);
    showSuccess(`已更新 ${name}`);
    await loadPackages(true);
  } catch (err) {
    showError(`更新失败: ${err.message}`);
  } finally {
    operatingPkg.value = null;
  }
}

onMounted(() => loadPackages(true)); // silent on initial load
</script>

<template>
  <div class="view">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconPackageVariant class="icon" /> 全局包管理</h2>
        <button class="btn btn-sm btn-secondary" :disabled="loading" @click="loadPackages()">
          <IconRefresh :class="{ spin: loading }" /> {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <p class="section-desc">
        {{ !loaded ? '正在读取 npm 全局包...' : loadError ? '全局包读取失败' : `管理 npm 全局安装的包，共 ${packages.length} 个` }}
      </p>
    </div>

    <div class="toolbar">
      <div class="search-wrap">
        <IconMagnify class="search-icon" />
        <input v-model="searchQuery" class="input search-input" placeholder="搜索包名..." />
      </div>
      <button class="btn btn-primary" :disabled="!!installingPkg || !!operatingPkg" @click="openInstallDialog"><IconPlus /> 安装新包</button>
    </div>

    <div v-if="installingPkg" class="install-banner">
      <IconLoading class="spin" />
      <span>正在安装 {{ installingPkg }}...</span>
    </div>

    <div v-if="loading" class="skeleton-list">
      <div v-for="i in 5" :key="i" class="skeleton" style="height:52px;margin-bottom:8px" />
    </div>
    <div v-else-if="loadError" class="empty-state" style="padding:48px">
      <IconPackageVariant class="empty-state-icon" />
      <p class="empty-state-desc">{{ loadError }}</p>
      <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="loadPackages()">重试</button>
    </div>
    <div v-else-if="filteredPackages.length === 0" class="empty-state" style="padding:48px">
      <IconPackageVariant class="empty-state-icon" />
      <p class="empty-state-desc">{{ searchQuery ? '未找到匹配的包' : '暂无全局安装的包' }}</p>
    </div>
    <div v-else class="package-list">
      <PackageCard
        v-for="pkg in filteredPackages" :key="pkg.name"
        :name="pkg.name" :version="pkg.version"
        :loading="operatingPkg === pkg.name"
        :disabled="!!operatingPkg || !!installingPkg"
        @uninstall="handleUninstall" @update="handleUpdate"
      />
    </div>

    <Teleport to="body">
      <div v-if="showInstallDialog" class="overlay" @click.self="closeInstallDialog" @keydown.esc="closeInstallDialog">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="package-install-title">
          <div class="d-head">
            <h3 id="package-install-title" class="d-title">安装全局包</h3>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="关闭" :disabled="!!installingPkg" @click="closeInstallDialog"><IconClose /></button>
          </div>
          <div class="d-body">
            <p class="d-hint">输入包名，例如 express、typescript、vite</p>
            <input v-model="installInput" class="input" placeholder="包名" autofocus @keyup.enter="handleInstall" />
          </div>
          <div class="d-foot">
            <button class="btn btn-secondary" :disabled="!!installingPkg" @click="closeInstallDialog">取消</button>
            <button class="btn btn-primary" :disabled="!installInput.trim() || !!installingPkg" @click="handleInstall">
              <IconLoading v-if="installingPkg" class="spin" />
              <IconDownload v-else />
              {{ installingPkg ? '安装中' : '安装' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.view { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 20px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.section-icon { width: 20px; height: 20px; color: var(--primary); }
.section-desc { font-size: 13px; color: var(--text-secondary); }
.icon { width: 20px; height: 20px; color: var(--primary); }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.search-wrap { position: relative; flex: 1; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: 32px; }
.install-banner { display: flex; align-items: center; gap: 8px; padding: 10px 16px; margin-bottom: 12px; background: var(--primary-dim); border: 1px solid var(--primary); border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: var(--primary); }
.package-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-list { display: flex; flex-direction: column; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn .2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.dialog { width: 420px; max-width: 90vw; background: var(--card); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); animation: slideUp .3s cubic-bezier(.16,1,.3,1); }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.d-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.d-title { font-size: 15px; font-weight: 700; color: var(--text); }
.d-body { padding: 20px; }
.d-hint { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
.d-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--border); }
</style>
