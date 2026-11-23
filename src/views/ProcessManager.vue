<script setup>
import { computed, ref, onActivated, onDeactivated } from 'vue';
import IconApplicationCogOutline from '~icons/mdi/application-cog-outline';
import IconRefresh from '~icons/mdi/refresh';
import IconLoading from '~icons/mdi/loading';
import IconLanDisconnect from '~icons/mdi/lan-disconnect';
import ProcessCard from '../components/ProcessCard.vue';
import PortKillDialog from '../components/PortKillDialog.vue';
import { killNodeProcess, listNodeProcesses } from '../utils/process.js';
import { showSuccess, showError } from '../utils/utools.js';
import { confirmAction } from '../utils/confirm.js';

const processes = ref([]);
const loading = ref(false);
const killingPid = ref(null);
const confirmingKill = ref(false);
const loadError = ref('');
const showPortDialog = ref(false);
const busy = computed(() => loading.value || confirmingKill.value || !!killingPid.value);
let viewRevision = 0;

async function loadProcesses(silent = false) {
  if (loading.value || (!silent && busy.value)) return;
  loading.value = true;
  loadError.value = '';
  try {
    processes.value = await listNodeProcesses();
    if (!silent) showSuccess('进程列表已刷新');
  } catch (err) {
    processes.value = [];
    loadError.value = err.message || '进程列表读取失败';
    if (!silent) showError(`刷新失败: ${loadError.value}`);
  }
  finally {
    loading.value = false;
  }
}

async function handleKill(pid) {
  if (busy.value || showPortDialog.value) return;
  const process = processes.value.find((item) => item.pid === pid);
  if (!process) {
    showError('进程列表已变化，请刷新后重试');
    return;
  }
  const revision = viewRevision;
  const command = process.command.length > 240 ? `${process.command.slice(0, 240)}…` : process.command;
  confirmingKill.value = true;
  let confirmed;
  try {
    confirmed = await confirmAction({
      title: '终止 Node.js 进程',
      message: `确定要强制终止 Node.js 进程（PID ${pid}）吗？未保存的数据可能丢失。\n\n命令行\n${command}`,
      confirmText: '终止进程',
      danger: true,
    });
  } finally {
    confirmingKill.value = false;
  }
  if (!confirmed || revision !== viewRevision) return;
  if (!processes.value.includes(process)) {
    showError('进程列表已变化，请刷新后重试');
    return;
  }
  killingPid.value = pid;
  try {
    await killNodeProcess(process);
    showSuccess(`已终止进程 ${pid}`);
  } catch (err) {
    showError(`终止失败: ${err.message}`);
  } finally {
    await loadProcesses(true);
    killingPid.value = null;
  }
}

onActivated(() => { if (!busy.value) loadProcesses(true); });
onDeactivated(() => {
  viewRevision += 1;
  showPortDialog.value = false;
});
</script>

<template>
  <div class="view">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconApplicationCogOutline class="icon" /> Node 进程管理</h2>
        <div class="header-actions">
          <button class="btn btn-sm btn-secondary" :disabled="busy" @click="loadProcesses()">
            <IconRefresh :class="{ spin: loading }" /> {{ loading ? '刷新中' : '刷新' }}
          </button>
          <button class="btn btn-sm btn-secondary" :disabled="busy" @click="showPortDialog = true">
            <IconLanDisconnect /> 按端口关闭
          </button>
        </div>
      </div>
      <p class="section-desc">查看和管理当前运行的 Node.js 进程</p>
    </div>

    <div v-if="loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton" style="height:52px;margin-bottom:8px" />
    </div>
    <div v-else-if="loadError" class="empty-state" style="padding:48px">
      <IconApplicationCogOutline class="empty-state-icon" />
      <p class="empty-state-desc">{{ loadError }}</p>
      <button class="btn btn-sm btn-secondary" style="margin-top:12px" :disabled="busy" @click="loadProcesses()">重试</button>
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
        :disabled="busy"
        @kill="handleKill"
      />
    </div>

    <PortKillDialog v-model="showPortDialog" @killed="loadProcesses(true)" />
  </div>
</template>

<style scoped>
.view { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 24px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.section-desc { font-size: 13px; color: var(--text-secondary); }
.icon { width: 20px; height: 20px; color: var(--primary); }
.process-list { display: flex; flex-direction: column; gap: 8px; }
.skeleton-list { display: flex; flex-direction: column; }
</style>
