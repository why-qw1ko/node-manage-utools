<script setup>
import { computed } from 'vue';
import IconFileCogOutline from '~icons/mdi/file-cog-outline';
import IconNodejs from '~icons/mdi/nodejs';
import IconServerNetwork from '~icons/mdi/server-network';
import IconFolderOpenOutline from '~icons/mdi/folder-open-outline';
import IconCached from '~icons/mdi/cached';
import IconFolderCogOutline from '~icons/mdi/folder-cog-outline';
import IconFileOutline from '~icons/mdi/file-outline';
import IconFolderOutline from '~icons/mdi/folder-outline';
import IconContentCopy from '~icons/mdi/content-copy';
import IconOpenInApp from '~icons/mdi/open-in-app';

const props = defineProps({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: 'file-outline' },
  path: { type: String, required: true },
  type: { type: String, default: 'file' },
  exists: { type: Boolean, default: true },
  needAdmin: { type: Boolean, default: false },
});

const emit = defineEmits(['open', 'copy-path']);

const iconMap = {
  'file-cog-outline': IconFileCogOutline,
  nodejs: IconNodejs,
  'server-network': IconServerNetwork,
  'folder-open-outline': IconFolderOpenOutline,
  cached: IconCached,
  'folder-cog-outline': IconFolderCogOutline,
  'file-outline': IconFileOutline,
  'folder-outline': IconFolderOutline,
};
const configIcon = computed(() => iconMap[props.icon] || IconFileOutline);
</script>

<template>
  <div class="config-card">
    <div class="config-header">
      <div class="config-icon-wrap" :class="{ 'config-icon-dir': type === 'directory' }">
        <component :is="configIcon" class="config-icon" />
      </div>
      <div class="config-info">
        <span class="config-name">{{ name }}</span>
        <span class="config-desc">{{ description }}</span>
      </div>
      <span v-if="needAdmin" class="tag tag-warning">管理员</span>
      <span v-if="!exists" class="tag tag-danger">不存在</span>
    </div>

    <div class="config-path">
      <IconFolderOutline class="config-path-icon" />
      <span class="config-path-text" :title="path">{{ path }}</span>
    </div>

    <div class="config-actions">
      <button
        class="btn btn-sm btn-primary"
        :disabled="!exists"
        :title="exists ? '' : '文件或目录不存在'"
        @click="emit('open', path)"
      >
        <IconOpenInApp v-if="type === 'file'" />
        <IconFolderOpenOutline v-else />
        {{ type === 'directory' ? '打开目录' : '打开文件' }}
      </button>
      <button class="btn btn-sm btn-ghost" @click="emit('copy-path', path)">
        <IconContentCopy />
        复制路径
      </button>
    </div>
  </div>
</template>

<style scoped>
.config-card {
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.config-card:hover {
  border-color: var(--border-hover);
}

.config-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.config-icon-wrap {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-dim);
  border-radius: var(--radius-sm);
}

.config-icon-wrap.config-icon-dir {
  background: var(--warning-dim);
}

.config-icon {
  width: 20px;
  height: 20px;
  color: var(--primary);
}

.config-icon-dir .config-icon {
  color: var(--warning);
}

.config-info {
  flex: 1;
  min-width: 0;
}

.config-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.config-desc {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
}

.config-path {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 12px;
  background: var(--surface);
  border-radius: var(--radius-sm);
}

.config-path-icon {
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.config-path-text {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
