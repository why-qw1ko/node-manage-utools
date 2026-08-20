<script setup>
import IconPackageVariant from '~icons/mdi/package-variant';
import IconDeleteOutline from '~icons/mdi/delete-outline';
import IconUpdate from '~icons/mdi/update';
import IconLoading from '~icons/mdi/loading';

defineProps({
  name: { type: String, required: true },
  version: { type: String, required: true },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['uninstall', 'update']);
</script>

<template>
  <div class="package-card">
    <div class="package-info">
      <IconPackageVariant class="package-icon" />
      <div class="package-text">
        <span class="package-name">{{ name }}</span>
        <span class="package-version">v{{ version }}</span>
      </div>
    </div>
    <div class="package-actions">
      <button class="btn btn-sm btn-ghost" title="更新" aria-label="更新全局包" :disabled="loading || disabled" @click="emit('update', name)">
        <IconLoading v-if="loading" class="spin" />
        <IconUpdate v-else />
      </button>
      <button class="btn btn-sm btn-ghost btn-danger-text" title="卸载" aria-label="卸载全局包" :disabled="loading || disabled" @click="emit('uninstall', name)">
        <IconDeleteOutline />
      </button>
    </div>
  </div>
</template>

<style scoped>
.package-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.package-card:hover {
  border-color: var(--border-hover);
}
.package-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.package-icon {
  width: 20px;
  height: 20px;
  color: var(--primary);
}
.package-text {
  display: flex;
  align-items: center;
  gap: 8px;
}
.package-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.package-version {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}
.package-actions {
  display: flex;
  align-items: center;
  gap: 4px;
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
