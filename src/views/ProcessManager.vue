<script setup>
import { ref, onMounted } from 'vue';
import IconApplicationCogOutline from '~icons/mdi/application-cog-outline';
import IconRefresh from '~icons/mdi/refresh';
import IconLoading from '~icons/mdi/loading';
import ProcessCard from '../components/ProcessCard.vue';
import { execFileCommand } from '../utils/command.js';
import { showSuccess, showError } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const processes = ref([]);
const loading = ref(false);
const killingPid = ref(null);
const loadError = ref('');

async function loadProcesses(silent = false) {
  loading.value = true;
  loadError.value = '';
  try {
    const script = [
      "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
      'Select-Object ProcessId,CommandLine,WorkingSetSize',
      'ConvertTo-Json -Compress',
    ].join(' | ');
    const output = await execFileCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000 },
    );
    const raw = output.trim() ? JSON.parse(output) : [];
    const items = Array.isArray(raw) ? raw : [raw];
    processes.value = items.map((item) => ({
      pid: String(item.ProcessId || ''),
      memory: formatMemory(Number(item.WorkingSetSize) || 0),
      command: item.CommandLine || 'node.exe',
    })).filter((process) => process.pid);
    if (!silent) showSuccess('进程列表已刷新');
  } catch (err) {
    loadError.value = err.message || '进程列表读取失败';
    if (!silent) showError(`刷新失败: ${loadError.value}`);
  }
  finally {
    loading.value = false;
  }
}

function formatMemory(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function handleKill(pid) {
  if (!/^\d+$/.test(String(pid))) {
    showError('进程 ID 无效');
    return;
  }
  const confirmed = await confirmAction({
    title: '终止 Node.js 进程',
    message: `确定要强制终止进程 PID: ${pid} 吗？未保存的数据可能丢失。`,
    confirmText: '终止进程',
    danger: true,
  });
  if (!confirmed) return;
  killingPid.value = pid;
  try {
    const numericPid = Number(pid);
    const script = [
      `$process = Get-Process -Id ${numericPid} -ErrorAction Stop`,
      "if ($process.ProcessName -ne 'node') { throw '目标进程不是 node.exe' }",
      '$process.Kill()',
    ].join('; ');
    await execFileCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000 },
    );
    showSuccess(`已终止进程 ${pid}`);
    await loadProcesses(true);
  } catch (err) {
    showError(`终止失败: ${err.message}`);
  } finally {
    killingPid.value = null;
  }
}

onMounted(() => loadProcesses(true)); // silent on initial load
</script>

<template>
  <div class="view">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconApplicationCogOutline class="icon" /> Node 进程管理</h2>
        <button class="btn btn-sm btn-secondary" :disabled="loading" @click="loadProcesses()">
          <IconRefresh :class="{ spin: loading }" /> {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <p class="section-desc">查看和管理当前运行的 Node.js 进程</p>
    </div>

    <div v-if="loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton" style="height:52px;margin-bottom:8px" />
    </div>
    <div v-else-if="loadError" class="empty-state" style="padding:48px">
      <IconApplicationCogOutline class="empty-state-icon" />
      <p class="empty-state-desc">{{ loadError }}</p>
      <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="loadProcesses()">重试</button>
    </div>
    <div v-else-if="processes.length === 0" class="empty-state" style="padding:48px">
      <IconApplicationCogOutline class="empty-state-icon" />
      <p class="empty-state-desc">暂无运行中的 Node.js 进程</p>
    </div>
    <div v-else class="process-list">
      <ProcessCard
        v-for="proc in processes" :key="proc.pid"
        :pid="proc.pid" :memory="proc.memory" :command="proc.command"
        :loading="killingPid === proc.pid"
        :disabled="!!killingPid"
        @kill="handleKill"
      />
    </div>
  </div>
</template>

<style scoped>
.view { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 24px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.section-desc { font-size: 13px; color: var(--text-secondary); }
.icon { width: 20px; height: 20px; color: var(--primary); }
.process-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-list { display: flex; flex-direction: column; }
</style>
