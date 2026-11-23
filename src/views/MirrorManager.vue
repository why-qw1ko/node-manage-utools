<script setup>
import { ref, computed, onActivated } from 'vue';
import IconSwapHorizontal from '~icons/mdi/swap-horizontal';
import IconRefresh from '~icons/mdi/refresh';
import IconPlus from '~icons/mdi/plus';
import IconClose from '~icons/mdi/close';
import IconContentCopy from '~icons/mdi/content-copy';
import IconWeb from '~icons/mdi/web';
import MirrorCard from '../components/MirrorCard.vue';
import { BUILTIN_MIRRORS } from '../constants/mirrors.js';
import { getCurrentRegistry, normalizeRegistry, setRegistry } from '../utils/npm.js';
import { getCustomMirrors, setCustomMirrors } from '../utils/store.js';
import { showSuccess, showError, showWarning, copyToClipboard } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const currentRegistry = ref('');
const registryLoading = ref(false);
const registryError = ref('');
const switchingRegistry = ref('');
const customMirrors = ref([]);
const showAddDialog = ref(false);
const newMirrorName = ref('');
const newMirrorUrl = ref('');

const registryBusy = computed(() => registryLoading.value || !!switchingRegistry.value);
const allMirrors = computed(() => [...BUILTIN_MIRRORS, ...customMirrors.value]);

async function loadCurrentRegistry(silent = false) {
  if (registryBusy.value) return;
  registryLoading.value = true;
  registryError.value = '';
  try {
    currentRegistry.value = await getCurrentRegistry();
    if (!silent) showSuccess('镜像源已刷新');
  } catch (err) {
    registryError.value = err.message || '镜像源读取失败';
    if (!silent) showError(`刷新失败: ${registryError.value}`);
  } finally {
    registryLoading.value = false;
  }
}

function loadCustomMirrors() {
  try {
    const saved = getCustomMirrors();
    const seen = new Set(BUILTIN_MIRRORS.map(({ registry }) => registry));
    customMirrors.value = [];
    if (!Array.isArray(saved)) return;
    for (const mirror of saved) {
      if (typeof mirror?.name !== 'string' || typeof mirror.registry !== 'string') continue;
      if (!mirror.name.trim() || mirror.name.length > 40 || mirror.registry.length > 2048) continue;
      try {
        const registry = normalizeRegistry(mirror.registry);
        if (seen.has(registry)) continue;
        seen.add(registry);
        customMirrors.value.push({ name: mirror.name, registry, icon: 'web', iconSet: 'mdi', custom: true });
      } catch { /* 忽略无效的历史地址 */ }
    }
  } catch {
    customMirrors.value = [];
  }
}

async function handleSelect(registry) {
  if (registryBusy.value) return;
  switchingRegistry.value = registry;
  try {
    if (registry.startsWith('http:')) {
      const confirmed = await confirmAction({
        title: '切换到未加密的 npm 镜像',
        message: `${registry}\n\nHTTP 无法保护下载内容和发送到镜像的凭据。请确认该地址属于你信任的网络。`,
        confirmText: '仍然切换',
        danger: true,
      });
      if (!confirmed) return;
    }
    currentRegistry.value = await setRegistry(registry);
    registryError.value = '';
    showSuccess('镜像源已切换');
  } catch (err) {
    currentRegistry.value = await getCurrentRegistry().catch(() => '');
    registryError.value = err.message || '镜像切换失败，请刷新确认';
    showError(registryError.value);
  } finally {
    switchingRegistry.value = '';
  }
}

function handleCopy(registry) {
  if (copyToClipboard(registry)) showSuccess('已复制到剪贴板');
  else showError('复制镜像源地址失败');
}

async function handleDelete(registry) {
  const mirror = customMirrors.value.find((item) => item.registry === registry);
  const confirmed = await confirmAction({
    title: '删除自定义镜像',
    message: `确定要删除“${mirror?.name || registry}”吗？此操作只移除插件中的条目，npm 当前配置仍会使用已选镜像。`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) return;
  const previous = customMirrors.value;
  customMirrors.value = previous.filter((m) => m.registry !== registry);
  if (!setCustomMirrors(customMirrors.value)) {
    customMirrors.value = previous;
    showError('保存失败，镜像源未删除');
    return;
  }
  showSuccess('已删除自定义镜像源');
}

function openAddDialog() {
  newMirrorName.value = '';
  newMirrorUrl.value = '';
  showAddDialog.value = true;
}

function closeAddDialog() {
  showAddDialog.value = false;
  newMirrorName.value = '';
  newMirrorUrl.value = '';
}

function handleAdd() {
  const name = newMirrorName.value.trim();
  const url = newMirrorUrl.value.trim();
  if (!name || !url) { showWarning('请填写完整信息'); return; }
  let normalizedUrl;
  try {
    normalizedUrl = normalizeRegistry(url);
  } catch (error) {
    showWarning(error instanceof TypeError ? '请输入有效的 HTTP/HTTPS 地址' : error.message);
    return;
  }
  if (name.length > 40 || normalizedUrl.length > 2048) { showWarning('名称或地址过长'); return; }
  if (allMirrors.value.some((m) => m.registry === normalizedUrl)) { showWarning('该镜像源已存在'); return; }
  const nextMirrors = [
    ...customMirrors.value,
    { name, registry: normalizedUrl, icon: 'web', iconSet: 'mdi', custom: true },
  ];
  if (!setCustomMirrors(nextMirrors)) {
    showError('保存失败，请重试');
    return;
  }
  customMirrors.value = nextMirrors;
  closeAddDialog();
  showSuccess('已添加自定义镜像源');
}

onActivated(() => {
  loadCurrentRegistry(true);
  loadCustomMirrors();
});
</script>

<template>
  <div class="mirror-manager">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconSwapHorizontal class="section-icon" /> 当前镜像源</h2>
        <button class="btn btn-sm btn-secondary" :disabled="registryBusy" @click="loadCurrentRegistry()">
          <IconRefresh :class="{ spin: registryLoading }" /> {{ registryLoading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <div class="current-mirror-card">
        <div class="current-mirror-info">
          <IconWeb class="current-icon" />
          <div>
            <span class="current-label">npm registry</span>
            <span class="current-url">
              {{ registryLoading && !currentRegistry ? '正在读取...' : currentRegistry || (registryError ? '读取失败' : '未配置') }}
            </span>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" :disabled="!currentRegistry" @click="handleCopy(currentRegistry)"><IconContentCopy /> 复制</button>
      </div>
      <div v-if="registryError" class="registry-error">
        <span>{{ registryError }}</span>
        <button class="btn btn-sm btn-ghost" :disabled="registryBusy" @click="loadCurrentRegistry()">重试</button>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconSwapHorizontal class="section-icon" /> 可用镜像源</h2>
        <button class="btn btn-sm btn-primary" @click="openAddDialog"><IconPlus /> 添加自定义</button>
      </div>
      <div class="mirror-grid">
        <MirrorCard
          v-for="m in allMirrors" :key="m.registry"
          :name="m.name" :registry="m.registry" :icon="m.icon" :icon-set="m.iconSet"
          :custom="m.custom" :active="currentRegistry === m.registry"
          :loading="switchingRegistry === m.registry"
          :disabled="registryBusy"
          @select="handleSelect" @copy="handleCopy" @delete="handleDelete"
        />
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showAddDialog" class="dialog-overlay" @click.self="closeAddDialog" @keydown.esc="closeAddDialog">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mirror-add-title">
          <div class="dialog-header">
            <h3 id="mirror-add-title" class="dialog-title">添加自定义镜像源</h3>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="关闭" @click="closeAddDialog"><IconClose /></button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label">名称</label>
              <input v-model="newMirrorName" class="input" placeholder="例如：公司私有源" autofocus />
            </div>
            <div class="form-group">
              <label class="form-label">Registry URL</label>
              <input v-model="newMirrorUrl" class="input" placeholder="https://registry.example.com/" />
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-secondary" @click="closeAddDialog">取消</button>
            <button class="btn btn-primary" :disabled="!newMirrorName.trim() || !newMirrorUrl.trim()" @click="handleAdd"><IconPlus /> 添加</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mirror-manager { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 24px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.section-icon { width: 20px; height: 20px; color: var(--primary); }
.current-mirror-card { display: flex; align-items: center; justify-content: space-between; padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.current-mirror-info { display: flex; align-items: center; gap: 16px; }
.current-icon { width: 40px; height: 40px; color: var(--primary); }
.current-label { display: block; font-size: 12px; color: var(--text-tertiary); }
.current-url { display: block; font-size: 14px; font-family: var(--font-mono); font-weight: 600; color: var(--text); }
.registry-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 8px 12px; color: var(--danger); background: var(--danger-dim); border-radius: var(--radius-md); font-size: 12px; }
.mirror-grid { display: flex; flex-direction: column; gap: 8px; }
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn .2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.dialog { width: 420px; max-width: 90vw; background: var(--card); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); animation: slideUp .3s cubic-bezier(.16,1,.3,1); }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.dialog-title { font-size: 15px; font-weight: 700; color: var(--text); }
.dialog-body { padding: 20px; }
.form-group { margin-bottom: 16px; }
.form-group:last-child { margin-bottom: 0; }
.form-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--border); }
</style>
