<script setup>
import { ref, watch } from 'vue';
import IconFolderLockOpen from '~icons/mdi/folder-lock-open';
import IconFolderSearch from '~icons/mdi/folder-search';
import IconFolderOpenOutline from '~icons/mdi/folder-open-outline';
import IconContentCopy from '~icons/mdi/content-copy';
import IconDeleteOutline from '~icons/mdi/delete-outline';
import IconLoading from '~icons/mdi/loading';
import IconAlertDecagram from '~icons/mdi/alert-decagram';
import { findFolderOccupiers, killProcess, classifyProcess } from '../utils/process.js';
import { showSuccess, showError, openPath, copyToClipboard } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const folder = ref('');
const loading = ref(false);
const detected = ref(false);
const results = ref([]);
const error = ref('');
const killingPid = ref(null);
const detectedFolder = ref('');
let requestId = 0;

function invalidateResults() {
  requestId += 1;
  loading.value = false;
  detected.value = false;
  detectedFolder.value = '';
  results.value = [];
  error.value = '';
}

watch(folder, invalidateResults, { flush: 'sync' });

function chooseFolder() {
  const selected = utools.showOpenDialog({
    title: '选择要解除占用的文件夹',
    properties: ['openDirectory'],
  });
  if (selected && selected[0]) {
    invalidateResults();
    folder.value = selected[0];
  }
}

async function readCurrentFolder() {
  invalidateResults();
  const startedAt = requestId;
  try {
    const path = await utools.readCurrentFolderPath();
    if (startedAt !== requestId) return;
    if (path) {
      invalidateResults();
      folder.value = path;
    } else {
      showError('无法读取当前文件夹');
    }
  } catch {
    if (startedAt === requestId) showError('无法读取当前文件夹，请打开一个资源管理器窗口后重试');
  }
}

async function handleDetect() {
  const value = folder.value.trim();
  if (!value) { showError('请先输入或选择文件夹路径'); return; }
  invalidateResults();
  const currentRequest = requestId;
  loading.value = true;
  try {
    const items = await findFolderOccupiers(value);
    if (currentRequest !== requestId) return;
    results.value = items;
    detectedFolder.value = value;
    detected.value = true;
    if (items.length === 0) showSuccess('未检测到匹配的进程');
  } catch (err) {
    if (currentRequest === requestId) error.value = err.message || '检测失败';
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
}

async function confirmKill(proc) {
  const cls = classifyProcess(proc.name, proc.pid);
  if (cls.level === 'user') {
    return confirmAction({
      title: '终止进程',
      message: `确定要强制终止进程 ${proc.name} (PID: ${proc.pid}) 以解除占用吗？未保存的数据可能丢失。`,
      confirmText: '终止进程',
      danger: true,
    });
  }

  const first = await confirmAction({
    title: '警告：系统进程',
    message: `${proc.name} 是${cls.label}，强制关闭可能导致系统不稳定或相关服务异常。\n\n确定要继续吗？`,
    confirmText: '继续',
    danger: true,
  });
  if (!first) return false;
  return confirmAction({
    title: '最后确认',
    message: `即将强制终止 ${proc.name} (PID: ${proc.pid})。\n${cls.level === 'critical' ? '该进程为系统关键进程，关闭可能导致系统崩溃或蓝屏！' : '关闭后相关系统服务可能失效。'}\n\n请再次确认。`,
    confirmText: '仍然终止',
    danger: true,
  });
}

async function handleKill(proc) {
  const currentRequest = requestId;
  const path = detectedFolder.value;
  const confirmed = await confirmKill(proc);
  if (!confirmed) return;
  if (currentRequest !== requestId || !path || folder.value.trim() !== path || !results.value.includes(proc)) {
    showError('检测结果已过期，请重新检测');
    return;
  }
  killingPid.value = proc.pid;
  try {
    await killProcess(proc, path);
    showSuccess(`已关闭进程 ${proc.pid}`);
    results.value = results.value.filter((p) => p.pid !== proc.pid);
  } catch (err) {
    showError(`关闭失败: ${err.message}`);
  } finally {
    killingPid.value = null;
  }
}

function levelTag(proc) {
  return classifyProcess(proc.name, proc.pid);
}

function dirname(p) {
  if (!p) return '';
  try { return window.nodeAPI.path.dirname(p); } catch { return ''; }
}
</script>

<template>
  <div class="view">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconFolderLockOpen class="icon" /> 文件夹解除占用</h2>
      </div>
      <p class="section-desc">根据进程路径或命令行查找可能占用该文件夹的进程</p>
    </div>

    <div class="search-card">
      <div class="search-row">
        <input
          v-model="folder"
          class="input"
          type="text"
          placeholder="输入文件夹路径，例如 D:\project\my-app"
          :disabled="loading || !!killingPid"
          @keydown.enter="handleDetect"
        />
        <button class="btn btn-secondary" :disabled="loading || !!killingPid" @click="chooseFolder">
          <IconFolderSearch /> 选择文件夹
        </button>
        <button class="btn btn-secondary" :disabled="loading || !!killingPid" @click="readCurrentFolder">
          读取当前
        </button>
        <button class="btn btn-primary" :disabled="loading || !!killingPid || !folder.trim()" @click="handleDetect">
          <IconLoading v-if="loading" class="spin" />
          检测占用
        </button>
      </div>
      <p class="search-hint">仅根据可执行文件路径和命令行推断；仅以此目录为工作目录或持有文件句柄的进程可能无法检测到。</p>
    </div>

    <div v-if="loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton" style="height:72px;margin-bottom:8px" />
    </div>

    <div v-else-if="error" class="empty-state" style="padding:48px">
      <IconFolderLockOpen class="empty-state-icon" />
      <p class="empty-state-desc">{{ error }}</p>
      <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="handleDetect">重试</button>
    </div>

    <div v-else-if="detected && results.length === 0" class="empty-state" style="padding:48px">
      <IconFolderLockOpen class="empty-state-icon" />
      <p class="empty-state-desc">未检测到路径匹配的进程（不代表文件夹未被占用）</p>
    </div>

    <div v-else-if="results.length > 0" class="section">
      <div class="section-header">
        <h3 class="sub-title">发现 {{ results.length }} 个路径匹配的进程</h3>
      </div>
      <div class="result-list">
        <div v-for="proc in results" :key="proc.pid" class="result-card">
          <div class="result-head">
            <div class="result-title">
              <span class="result-name">{{ proc.name || '未知进程' }}</span>
              <span class="tag">PID: {{ proc.pid }}</span>
              <span class="tag">{{ proc.memory }}</span>
              <span v-if="levelTag(proc).level === 'critical'" class="tag tag-danger">
                <IconAlertDecagram /> 系统关键进程
              </span>
              <span v-else-if="levelTag(proc).level === 'system'" class="tag tag-warning">
                <IconAlertDecagram /> 系统进程
              </span>
            </div>
            <button
              class="btn btn-sm btn-danger"
              :disabled="!!killingPid"
              @click="handleKill(proc)"
            >
              <IconLoading v-if="killingPid === proc.pid" class="spin" />
              <IconDeleteOutline v-else />
              关闭进程
            </button>
          </div>

          <div v-if="levelTag(proc).level !== 'user'" class="warn-banner" :class="levelTag(proc).level">
            <IconAlertDecagram class="warn-icon" />
            <span v-if="levelTag(proc).level === 'critical'">
              {{ proc.name }} 是系统关键进程，强制关闭可能导致系统崩溃、蓝屏或无法登录，请谨慎操作。
            </span>
            <span v-else>
              {{ proc.name }} 是系统服务/组件进程，关闭可能导致相关服务或界面异常。
            </span>
          </div>

          <div class="detail-list">
            <div v-if="proc.reason" class="detail-row">
              <dt>占用原因</dt>
              <dd><span class="detail-value">{{ proc.reason }}</span></dd>
            </div>
            <div class="detail-row">
              <dt>可执行文件</dt>
              <dd>
                <span class="detail-value mono" :title="proc.exe">{{ proc.exe || '未知' }}</span>
                <button v-if="proc.exe" class="btn btn-ghost btn-icon btn-sm" title="复制路径" @click="copyToClipboard(proc.exe); showSuccess('路径已复制')">
                  <IconContentCopy />
                </button>
                <button v-if="proc.exe" class="btn btn-ghost btn-icon btn-sm" title="打开所在目录" @click="openPath(dirname(proc.exe))">
                  <IconFolderOpenOutline />
                </button>
              </dd>
            </div>
            <div v-if="proc.cmd" class="detail-row">
              <dt>命令行</dt>
              <dd>
                <span class="detail-value mono cmd">{{ proc.cmd }}</span>
                <button class="btn btn-ghost btn-icon btn-sm" title="复制命令行" @click="copyToClipboard(proc.cmd); showSuccess('命令行已复制')">
                  <IconContentCopy />
                </button>
              </dd>
            </div>
          </div>
        </div>
      </div>
    </div>
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
.search-card {
  padding: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
}
.search-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.search-row .input {
  flex: 1;
  min-width: 220px;
}
.search-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.result-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.result-card {
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.result-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.result-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.result-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.warn-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 12px;
  line-height: 1.5;
  border-radius: var(--radius-sm);
}
.warn-banner.critical {
  color: var(--danger);
  background: var(--danger-dim);
}
.warn-banner.system {
  color: var(--warning);
  background: var(--warning-dim);
}
.warn-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}
.detail-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-row {
  display: flex;
  gap: 12px;
  font-size: 12px;
}
.detail-row dt {
  flex: 0 0 76px;
  color: var(--text-tertiary);
  padding-top: 2px;
}
.detail-row dd {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.detail-value {
  color: var(--text-secondary);
  word-break: break-all;
}
.detail-value.mono {
  font-family: var(--font-mono);
}
.detail-value.cmd {
  flex: 1;
  white-space: pre-wrap;
}
.skeleton-list { display: flex; flex-direction: column; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
