<script setup>
import { ref, watch, nextTick } from 'vue';
import IconLanDisconnect from '~icons/mdi/lan-disconnect';
import IconClose from '~icons/mdi/close';
import IconMagnify from '~icons/mdi/magnify';
import IconLoading from '~icons/mdi/loading';
import IconAlertDecagram from '~icons/mdi/alert-decagram';
import IconFolderOpenOutline from '~icons/mdi/folder-open-outline';
import IconContentCopy from '~icons/mdi/content-copy';
import IconDeleteOutline from '~icons/mdi/delete-outline';
import { detectPort, killPortProcess, classifyProcess } from '../utils/process.js';
import { showSuccess, showError, openPath, copyToClipboard } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'killed']);

const portInput = ref(null);
const port = ref('');
const detecting = ref(false);
const detected = ref(false);
const results = ref([]);
const error = ref('');
const killingPid = ref(null);
const detectedPort = ref('');
let requestId = 0;

function invalidateResults() {
  requestId += 1;
  detecting.value = false;
  detected.value = false;
  detectedPort.value = '';
  results.value = [];
  error.value = '';
}

watch(port, invalidateResults, { flush: 'sync' });

function reset() {
  invalidateResults();
  port.value = '';
}

function close() {
  reset();
  emit('update:modelValue', false);
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    reset();
    await nextTick();
    portInput.value?.focus();
  }
});

function dirname(p) {
  if (!p) return '';
  try { return window.nodeAPI.path.dirname(p); } catch { return ''; }
}

async function handleDetect() {
  const value = port.value.trim();
  if (!value) { showError('请输入端口号'); return; }
  invalidateResults();
  const currentRequest = requestId;
  detecting.value = true;
  try {
    const items = await detectPort(value);
    if (currentRequest !== requestId || !props.modelValue) return;
    results.value = items;
    detectedPort.value = value;
    detected.value = true;
    if (items.length === 0) showSuccess('该端口当前未被占用');
  } catch (err) {
    if (currentRequest === requestId && props.modelValue) error.value = err.message || '检测失败';
  } finally {
    if (currentRequest === requestId) detecting.value = false;
  }
}

async function confirmKill(proc) {
  const cls = classifyProcess(proc.name, proc.pid);
  if (cls.level === 'user') {
    return confirmAction({
      title: '终止进程',
      message: `确定要强制终止进程 ${proc.name} (PID: ${proc.pid}) 吗？未保存的数据可能丢失。`,
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
  const targetPort = detectedPort.value;
  const confirmed = await confirmKill(proc);
  if (!confirmed) return;
  if (currentRequest !== requestId || !props.modelValue || !targetPort || port.value.trim() !== targetPort || !results.value.includes(proc)) {
    showError('检测结果已过期，请重新检测');
    return;
  }
  killingPid.value = proc.pid;
  try {
    await killPortProcess(targetPort, proc);
    if (currentRequest === requestId && props.modelValue) showSuccess(`已关闭进程 ${proc.pid}`);
    emit('killed');
    if (currentRequest === requestId && props.modelValue) await handleDetect();
  } catch (err) {
    if (currentRequest === requestId && props.modelValue) showError(`关闭失败: ${err.message}`);
  } finally {
    if (killingPid.value === proc.pid) killingPid.value = null;
  }
}

function levelTag(proc) {
  return classifyProcess(proc.name, proc.pid);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="port-dialog-overlay" @click.self="close">
      <div class="port-dialog" role="dialog" aria-modal="true" aria-label="按端口关闭进程">
        <div class="dialog-head">
          <div class="dialog-title">
            <IconLanDisconnect class="dialog-title-icon" />
            <span>按端口关闭进程</span>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="关闭" @click="close">
            <IconClose />
          </button>
        </div>

        <div class="dialog-body">
          <div class="search-row">
            <input
              ref="portInput"
              v-model="port"
              class="input"
              type="text"
              inputmode="numeric"
              placeholder="输入端口号，例如 8080"
              :disabled="detecting || !!killingPid"
              @keydown.enter="handleDetect"
            />
            <button class="btn btn-primary" :disabled="detecting || !!killingPid || !port.trim()" @click="handleDetect">
              <IconLoading v-if="detecting" class="spin" />
              <IconMagnify v-else />
              {{ detecting ? '检测中' : '检测' }}
            </button>
          </div>
          <p class="dialog-hint">自动检测占用该端口的进程及其运行目录、命令行等详细信息</p>

          <div v-if="killingPid && !detected" class="detect-state">
            <IconLoading class="spin" />
            <span>正在终止进程 {{ killingPid }}，请稍候…</span>
          </div>
          <div v-else-if="detecting" class="detect-state">
            <IconLoading class="spin detect-spinner" />
            <span>正在检测端口占用…</span>
          </div>

          <div v-else-if="error" class="detect-state error">
            <IconAlertDecagram />
            <span>{{ error }}</span>
          </div>

          <div v-else-if="detected && results.length === 0" class="detect-state">
            <span>该端口当前未被任何进程占用</span>
          </div>

          <div v-else-if="results.length > 0" class="result-list">
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

              <dl class="detail-list">
                <div class="detail-row">
                  <dt>可执行文件</dt>
                  <dd>
                    <span class="detail-value mono" :title="proc.exe">{{ proc.exe || '未知' }}</span>
                    <button v-if="proc.exe" class="btn btn-ghost btn-icon btn-sm" title="复制路径" @click="copyToClipboard(proc.exe); showSuccess('路径已复制')">
                      <IconContentCopy />
                    </button>
                    <button v-if="dirname(proc.exe)" class="btn btn-ghost btn-icon btn-sm" title="打开所在目录" @click="openPath(dirname(proc.exe))">
                      <IconFolderOpenOutline />
                    </button>
                  </dd>
                </div>
                <div v-if="dirname(proc.exe)" class="detail-row">
                  <dt>所在目录</dt>
                  <dd><span class="detail-value mono">{{ dirname(proc.exe) }}</span></dd>
                </div>
                <div v-if="proc.parentPid" class="detail-row">
                  <dt>父进程 PID</dt>
                  <dd><span class="detail-value mono">{{ proc.parentPid }}</span></dd>
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
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.port-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
}
.port-dialog {
  width: min(680px, 100%);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.dialog-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.dialog-title-icon {
  width: 20px;
  height: 20px;
  color: var(--primary);
}
.dialog-body {
  padding: 20px;
  overflow-y: auto;
}
.search-row {
  display: flex;
  gap: 8px;
}
.search-row .input {
  flex: 1;
}
.dialog-hint {
  margin: 8px 0 16px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.detect-state {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 32px;
  font-size: 13px;
  color: var(--text-secondary);
}
.detect-state.error {
  color: var(--danger);
}
.detect-spinner {
  width: 20px;
  height: 20px;
  color: var(--primary);
}
.result-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.result-card {
  padding: 14px 16px;
  background: var(--surface);
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
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
