<script setup>
import { ref, computed, onMounted } from 'vue';
import IconHarddisk from '~icons/mdi/harddisk';
import IconRefresh from '~icons/mdi/refresh';
import IconDeleteSweep from '~icons/mdi/delete-sweep';
import IconLoading from '~icons/mdi/loading';
import IconFolderOpen from '~icons/mdi/folder-open-outline';
import { getNpmPrefix, getNpmCacheDir, cleanNpmCache, isSafeCacheDirectory } from '../utils/npm.js';
import { getNvmDir } from '../utils/nvm.js';
import { openPath, showSuccess, showError } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const loading = ref(false);
const cleaning = ref(false);
const nodeVersions = ref([]);
const npmCacheSize = ref('');
const npmGlobalSize = ref('');
const totalSize = ref('');
const loadError = ref('');
const cacheDirectory = ref('');
const cacheWarning = ref('');
const cacheActionError = ref('');
const cacheConfirming = ref(false);

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getDirSize(dirPath) {
  if (!dirPath) return { bytes: 0, label: '不可用', incomplete: true };
  try {
    const { bytes, incomplete } = await window.nodeAPI.fs.getDirectorySize(dirPath);
    const label = incomplete ? (bytes ? `至少 ${formatSize(bytes)}` : '读取不完整') : formatSize(bytes);
    return { bytes, label, incomplete };
  } catch {
    return { bytes: 0, label: '计算失败', incomplete: true };
  }
}

async function loadDiskUsage(silent = false) {
  if (loading.value) return;
  loading.value = true;
  loadError.value = '';
  cacheDirectory.value = '';
  cacheWarning.value = '';
  try {
    const isWindows = window.nodeAPI.os.platform() === 'win32';
    const path = window.nodeAPI.path;
    const nvmHome = getNvmDir();
    const [prefix, cache] = await Promise.allSettled([getNpmPrefix(), getNpmCacheDir()]);
    const npmPrefix = prefix.status === 'fulfilled' ? prefix.value : '';
    const npmCacheDir = cache.status === 'fulfilled' ? cache.value : '';
    if (isSafeCacheDirectory(npmCacheDir)) cacheDirectory.value = npmCacheDir;
    else cacheWarning.value = cache.reason?.message || 'npm 缓存路径无效，请检查 npm 配置中的 cache';
    const npmGlobalDir = npmPrefix
      ? path.join(npmPrefix, ...(isWindows ? ['node_modules'] : ['lib', 'node_modules']))
      : '';

    // Get node versions directories
    const fs = window.nodeAPI.fs;
    if (nvmHome && fs.existsSync(nvmHome)) {
      const entries = fs.readdirSync(nvmHome);
      const versions = entries
        .filter((name) => /^v\d+\.\d+\.\d+$/i.test(name))
        .map((name) => ({
          name,
          path: path.join(nvmHome, name),
          size: '计算中...',
          bytes: 0,
        })).filter((version) => {
          try { return fs.statSync(version.path).isDirectory(); } catch { return false; }
        });
      nodeVersions.value = await Promise.all(versions.map(async (version) => {
        const result = await getDirSize(version.path);
        return {
          ...version,
          size: result.label,
          bytes: result.bytes,
          incomplete: result.incomplete,
        };
      }));
    } else {
      nodeVersions.value = [];
    }

    const [cacheResult, globalResult] = await Promise.all([
      getDirSize(cacheDirectory.value),
      getDirSize(npmGlobalDir),
    ]);
    npmCacheSize.value = cacheResult.label;
    npmGlobalSize.value = globalResult.label;

    const totalBytes = nodeVersions.value.reduce((sum, version) => sum + version.bytes, 0)
      + cacheResult.bytes
      + globalResult.bytes;
    const incomplete = cacheResult.incomplete || globalResult.incomplete || nodeVersions.value.some((version) => version.incomplete);
    totalSize.value = incomplete ? (totalBytes ? `至少 ${formatSize(totalBytes)}` : '读取不完整') : formatSize(totalBytes);

    if (!silent) showSuccess('磁盘占用数据已刷新');
  } catch (err) {
    loadError.value = err.message || '磁盘占用数据读取失败';
    if (!silent) showError('加载失败: ' + loadError.value);
  }
  finally {
    loading.value = false;
  }
}

async function handleCleanCache() {
  if (cleaning.value || loading.value || cacheConfirming.value || !cacheDirectory.value) return;
  const directory = cacheDirectory.value;
  cacheConfirming.value = true;
  cacheActionError.value = '';
  try {
    const confirmed = await confirmAction({
      title: '清理 npm 缓存',
      message: `缓存目录：${directory}\n\n清理下载缓存后，后续安装可能需要联网重新下载。已安装的包会保留。`,
      confirmText: '清理缓存',
      danger: true,
    });
    if (!confirmed) return;
    cacheConfirming.value = false;
    cleaning.value = true;
    await cleanNpmCache(directory);
    showSuccess('npm 缓存已清理');
    await loadDiskUsage(true);
  } catch (err) {
    cacheActionError.value = err.message || '清理失败，请刷新确认剩余缓存';
    await loadDiskUsage(true);
  }
  finally {
    cacheConfirming.value = false;
    cleaning.value = false;
  }
}

function openFolder(path) {
  if (!openPath(path)) showError('打开失败');
}

const sortedVersions = computed(() => {
  return [...nodeVersions.value].sort((a, b) => b.bytes - a.bytes);
});

onMounted(() => loadDiskUsage(true)); // silent on initial load
</script>

<template>
  <div class="view">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconHarddisk class="icon" /> 磁盘占用分析</h2>
        <button class="btn btn-sm btn-secondary" :disabled="loading || cleaning || cacheConfirming" @click="loadDiskUsage()">
          <IconRefresh :class="{ spin: loading }" /> {{ loading ? '扫描中' : '刷新' }}
        </button>
      </div>
      <p class="section-desc">分析 Node.js 相关文件的磁盘占用情况</p>
    </div>

    <div v-if="loading" class="skeleton-list">
      <div v-for="i in 5" :key="i" class="skeleton" style="height:52px;margin-bottom:8px" />
    </div>
    <div v-else-if="loadError" class="empty-state" style="padding:48px">
      <IconHarddisk class="empty-state-icon" />
      <p class="empty-state-desc">{{ loadError }}</p>
      <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="loadDiskUsage()">重试</button>
    </div>
    <template v-else>
      <!-- Summary -->
      <div class="summary-card">
        <div class="summary-item">
          <span class="summary-label">Node.js 版本</span>
          <span class="summary-value">{{ nodeVersions.length }} 个</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">npm 缓存</span>
          <span class="summary-value">{{ npmCacheSize }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">全局包</span>
          <span class="summary-value">{{ npmGlobalSize }}</span>
        </div>
        <div class="summary-item total">
          <span class="summary-label">总计占用</span>
          <span class="summary-value">{{ totalSize }}</span>
        </div>
      </div>

      <!-- Node Versions -->
      <div class="section">
        <div class="section-header">
          <h3 class="sub-title">Node.js 版本占用</h3>
        </div>
        <div v-if="nodeVersions.length === 0" class="empty-state" style="padding:24px">
          <IconHarddisk class="empty-state-icon" style="width:36px;height:36px" />
          <p class="empty-state-desc">未检测到 nvm 安装的 Node 版本</p>
        </div>
        <div v-else class="usage-list">
          <div v-for="v in sortedVersions" :key="v.name" class="usage-item">
            <div class="usage-info">
              <span class="usage-name">{{ v.name }}</span>
              <span class="usage-path">{{ v.path }}</span>
            </div>
            <div class="usage-actions">
              <span class="usage-size">{{ v.size }}</span>
              <button class="btn btn-sm btn-ghost" title="打开目录" @click="openFolder(v.path)">
                <IconFolderOpen />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="section">
        <div class="section-header">
          <h3 class="sub-title">清理操作</h3>
        </div>
        <div class="action-cards">
          <div class="action-card">
            <div class="action-info">
              <span class="action-title">清理 npm 缓存</span>
              <span class="action-desc">清理 npm 下载缓存，不影响已安装的包</span>
            </div>
            <button class="btn btn-danger" :disabled="cleaning || loading || cacheConfirming || !cacheDirectory" @click="handleCleanCache">
              <IconLoading v-if="cleaning" class="spin" />
              <IconDeleteSweep v-else />
              {{ cleaning ? '清理中...' : '清理缓存' }}
            </button>
          </div>
        </div>
        <p v-if="cacheActionError || cacheWarning" class="section-desc" role="alert">{{ cacheActionError || cacheWarning }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.view { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 24px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.section-desc { font-size: 13px; color: var(--text-secondary); }
.icon { width: 20px; height: 20px; color: var(--primary); }
.sub-title { font-size: 14px; font-weight: 600; color: var(--text); }
.summary-card {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
}
.summary-item {
  text-align: center;
}
.summary-item.total {
  border-left: 1px solid var(--border);
  padding-left: 12px;
}
.summary-label {
  display: block;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.summary-value {
  display: block;
  font-size: 18px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text);
}
.summary-item.total .summary-value {
  color: var(--primary);
}
.usage-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.usage-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.usage-info {
  flex: 1;
  min-width: 0;
}
.usage-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text);
}
.usage-path {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.usage-size {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--primary);
}
.action-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.action-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.action-info {
  flex: 1;
}
.action-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}
.action-desc {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
}
.skeleton-list { display: flex; flex-direction: column; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
