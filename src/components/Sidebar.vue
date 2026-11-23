<script setup>
import IconNodejs from '~icons/mdi/nodejs';
import IconSwapHorizontal from '~icons/mdi/swap-horizontal';
import IconFileCogOutline from '~icons/mdi/file-cog-outline';
import IconPackageVariant from '~icons/mdi/package-variant';
import IconEarth from '~icons/mdi/earth';
import IconApplicationCogOutline from '~icons/mdi/application-cog-outline';
import IconFolderLockOpen from '~icons/mdi/folder-lock-open';
import IconHarddisk from '~icons/mdi/harddisk';

defineProps({
  activeTab: { type: String, default: 'node' },
});

const emit = defineEmits(['change']);

const tabs = [
  { id: 'node', label: 'Node 版本', icon: IconNodejs },
  { id: 'mirror', label: '镜像源', icon: IconSwapHorizontal },
  { id: 'packages', label: '全局包', icon: IconPackageVariant },
  { id: 'config', label: '配置文件', icon: IconFileCogOutline },
  { id: 'env', label: '环境变量', icon: IconEarth },
  { id: 'process', label: '进程管理', icon: IconApplicationCogOutline },
  { id: 'unlock', label: '文件夹解除占用', icon: IconFolderLockOpen },
  { id: 'disk', label: '磁盘分析', icon: IconHarddisk },
];
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <IconNodejs class="sidebar-logo" />
      <span class="sidebar-title">Node 管理</span>
    </div>
    <nav class="sidebar-nav">
      <button
        v-for="tab in tabs" :key="tab.id"
        class="sidebar-item" :class="{ active: activeTab === tab.id }"
        :aria-current="activeTab === tab.id ? 'page' : undefined"
        @click="emit('change', tab.id)"
      >
        <component :is="tab.icon" class="sidebar-icon" />
        <span class="sidebar-label">{{ tab.label }}</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar { width: 180px; height: 100vh; display: flex; flex-direction: column; background: var(--card); border-right: 1px solid var(--border); user-select: none; }
.sidebar-header { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; }
.sidebar-logo { width: 24px; height: 24px; color: var(--primary); }
.sidebar-title { font-size: 14px; font-weight: 700; color: var(--text); }
.sidebar-nav { flex: 1; padding: 4px 8px; overflow-y: auto; }
.sidebar-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; margin-bottom: 2px; font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--text-secondary); background: transparent; border: none; border-radius: var(--radius-md); cursor: pointer; transition: all var(--transition-fast); text-align: left; }
.sidebar-item:hover { background: var(--surface); color: var(--text); }
.sidebar-item.active { background: var(--primary-dim); color: var(--primary); }
.sidebar-icon { width: 18px; height: 18px; flex-shrink: 0; }
.sidebar-label { flex: 1; }
</style>
