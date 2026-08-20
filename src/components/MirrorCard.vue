<script setup>
import { computed } from 'vue';
import IconWeb from '~icons/mdi/web';
import IconContentCopy from '~icons/mdi/content-copy';
import IconDeleteOutline from '~icons/mdi/delete-outline';
import IconNpm from '~icons/logos/npm';
import IconShopping from '~icons/mdi/shopping';
import IconCloud from '~icons/mdi/cloud';
import IconDomain from '~icons/mdi/domain';
import IconLoading from '~icons/mdi/loading';

const props = defineProps({
  name: { type: String, required: true },
  registry: { type: String, required: true },
  icon: { type: String, default: 'web' },
  iconSet: { type: String, default: 'mdi' },
  active: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  custom: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'delete', 'copy']);

const iconMap = { npm: IconNpm, shopping: IconShopping, cloud: IconCloud, domain: IconDomain, web: IconWeb };
const mirrorIcon = computed(() => iconMap[props.icon] || IconWeb);
</script>

<template>
  <div class="mirror-card" :class="{ active }">
    <div class="mirror-header">
      <div class="mirror-icon-wrap">
        <component :is="mirrorIcon" class="mirror-icon" />
      </div>
      <div class="mirror-info">
        <span class="mirror-name">{{ name }}</span>
        <span class="mirror-url">{{ registry }}</span>
      </div>
      <span v-if="active" class="tag tag-success">当前使用</span>
    </div>

    <div class="mirror-actions">
      <button
        v-if="!active"
        class="btn btn-sm btn-primary"
        :disabled="loading || disabled"
        @click="emit('select', registry)"
      >
        <IconLoading v-if="loading" class="spin" />
        {{ loading ? '切换中' : '切换' }}
      </button>
      <button
        class="btn btn-sm btn-ghost"
        :disabled="disabled"
        @click="emit('copy', registry)"
      >
        <IconContentCopy />
        复制
      </button>
      <button
        v-if="custom && !active"
        class="btn btn-sm btn-ghost btn-danger-text"
        :disabled="disabled"
        @click="emit('delete', registry)"
      >
        <IconDeleteOutline />
        删除
      </button>
    </div>
  </div>
</template>

<style scoped>
.mirror-card {
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.mirror-card:hover {
  border-color: var(--border-hover);
}

.mirror-card.active {
  border-color: var(--success);
  background: var(--success-dim);
}

.mirror-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.mirror-icon-wrap {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-dim);
  border-radius: var(--radius-sm);
}

.mirror-icon {
  width: 20px;
  height: 20px;
  color: var(--primary);
}

.mirror-info {
  flex: 1;
  min-width: 0;
}

.mirror-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.mirror-url {
  display: block;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mirror-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-danger-text {
  color: var(--danger);
}

.btn-danger-text:hover {
  background: var(--danger-dim);
}
</style>
