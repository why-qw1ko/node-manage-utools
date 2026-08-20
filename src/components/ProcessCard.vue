<script setup>
import IconApplicationCogOutline from '~icons/mdi/application-cog-outline';
import IconDeleteOutline from '~icons/mdi/delete-outline';
import IconLoading from '~icons/mdi/loading';

defineProps({
  pid: { type: [String, Number], required: true },
  memory: { type: String, default: '' },
  cpu: { type: String, default: '' },
  command: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['kill']);
</script>

<template>
  <div class="process-card">
    <div class="process-info">
      <IconApplicationCogOutline class="process-icon" />
      <div class="process-details">
        <div class="process-header">
          <span class="process-pid">PID: {{ pid }}</span>
          <span v-if="memory" class="process-memory">{{ memory }}</span>
          <span v-if="cpu" class="process-cpu">CPU: {{ cpu }}</span>
        </div>
        <div v-if="command" class="process-command">{{ command }}</div>
      </div>
    </div>
    <button class="btn btn-sm btn-ghost btn-danger-text" title="终止进程" aria-label="终止进程" :disabled="loading || disabled" @click="emit('kill', pid)">
      <IconLoading v-if="loading" class="spin" />
      <IconDeleteOutline v-else />
    </button>
  </div>
</template>

<style scoped>
.process-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.process-card:hover {
  border-color: var(--border-hover);
}
.process-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.process-icon {
  width: 20px;
  height: 20px;
  color: var(--success);
  flex-shrink: 0;
}
.process-details {
  flex: 1;
  min-width: 0;
}
.process-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.process-pid {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text);
}
.process-memory {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  padding: 2px 8px;
  background: var(--surface);
  border-radius: var(--radius-full);
}
.process-cpu {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  padding: 2px 8px;
  background: var(--surface);
  border-radius: var(--radius-full);
}
.process-command {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-danger-text {
  color: var(--danger);
}
.btn-danger-text:hover:not(:disabled) {
  background: var(--danger-dim);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
