<script setup>
import IconContentCopy from '~icons/mdi/content-copy';

defineProps({
  name: { type: String, required: true },
  value: { type: String, default: '' },
  description: { type: String, default: '' },
});

const emit = defineEmits(['copy']);
</script>

<template>
  <div class="env-card">
    <div class="env-header">
      <span class="env-name">{{ name }}</span>
      <button class="btn btn-sm btn-ghost" title="复制" @click="emit('copy', value)">
        <IconContentCopy />
      </button>
    </div>
    <div class="env-value">{{ value || '未设置' }}</div>
    <div v-if="description" class="env-desc">{{ description }}</div>
  </div>
</template>

<style scoped>
.env-card {
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.env-card:hover {
  border-color: var(--border-hover);
}
.env-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.env-name {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--primary);
}
.env-value {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text);
  word-break: break-all;
  padding: 6px 10px;
  background: var(--surface);
  border-radius: var(--radius-sm);
}
.env-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 6px;
}
</style>
