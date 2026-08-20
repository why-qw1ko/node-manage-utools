<script setup>
import IconNodejs from '~icons/mdi/nodejs';
import IconDeleteOutline from '~icons/mdi/delete-outline';
import IconLoading from '~icons/mdi/loading';

defineProps({
  version: { type: String, required: true },
  active: { type: Boolean, default: false },
  lts: { type: [String, Boolean], default: false },
  installing: { type: Boolean, default: false },
  uninstalling: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['use', 'uninstall']);
</script>

<template>
  <div class="version-card" :class="{ active }">
    <div class="version-info">
      <IconNodejs class="version-icon" :class="{ active }" />
      <div class="version-text">
        <span class="version-number">v{{ version }}</span>
        <span v-if="lts" class="version-lts tag">{{ lts }}</span>
      </div>
    </div>

    <div class="version-actions">
      <span v-if="active" class="tag tag-success">当前使用</span>
      <template v-else>
        <button
          class="btn btn-sm btn-primary"
          :disabled="disabled || installing || uninstalling"
          @click="emit('use', version)"
        >
          <IconLoading v-if="installing" class="spin" />
          <span>{{ installing ? '切换中...' : '使用' }}</span>
        </button>
        <button
          class="btn btn-sm btn-ghost"
          :class="{ 'btn-icon': !uninstalling }"
          :title="uninstalling ? '正在卸载' : '卸载'"
          :aria-label="uninstalling ? '正在卸载' : '卸载版本'"
          :disabled="disabled || installing || uninstalling"
          @click="emit('uninstall', version)"
        >
          <IconLoading v-if="uninstalling" class="spin" />
          <IconDeleteOutline v-else />
          <span v-if="uninstalling">卸载中...</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.version-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.version-card:hover {
  border-color: var(--border-hover);
}

.version-card.active {
  border-color: var(--success);
  background: var(--success-dim);
}

.version-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.version-icon {
  width: 20px;
  height: 20px;
  color: var(--text-tertiary);
}

.version-icon.active {
  color: var(--success);
}

.version-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-number {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text);
}

.version-lts {
  font-size: 10px;
  padding: 2px 6px;
}

.version-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
