<script setup>
import { ref, onMounted } from 'vue';
import IconEarth from '~icons/mdi/earth';
import IconRefresh from '~icons/mdi/refresh';
import EnvCard from '../components/EnvCard.vue';
import { getNpmConfig } from '../utils/npm.js';
import { copyToClipboard, showSuccess, showError } from '../utils/utools.js';

const envVars = ref([]);
const npmVars = ref([]);
const loading = ref(false);
const refreshing = ref(false);
const npmError = ref('');

const ENV_DEFINITIONS = [
  { name: 'NODE_ENV', description: 'Node 运行环境（development/production）' },
  { name: 'NODE_PATH', description: 'Node 模块搜索路径' },
  { name: 'NVM_HOME', description: 'nvm-windows 安装目录' },
  { name: 'NVM_SYMLINK', description: 'nvm 符号链接目录（当前使用的 Node 版本）' },
  { name: 'PATH', description: '系统路径（包含 Node.js）' },
  { name: 'HTTP_PROXY', description: 'HTTP 代理地址' },
  { name: 'HTTPS_PROXY', description: 'HTTPS 代理地址' },
  { name: 'NODE_OPTIONS', description: 'Node.js 启动参数' },
];

const NPM_CONFIG_KEYS = [
  { key: 'prefix', description: 'npm 全局安装目录' },
  { key: 'cache', description: 'npm 缓存目录' },
  { key: 'registry', description: '当前 npm registry' },
  { key: 'userconfig', description: '用户级 npm 配置文件路径' },
  { key: 'globalconfig', description: '全局 npm 配置文件路径' },
];

function loadEnvVars(silent = false) {
  envVars.value = ENV_DEFINITIONS.map((def) => ({
    ...def,
    value: window.nodeAPI.env?.[def.name] || '',
  })).filter((v) => v.value);
  if (!silent) showSuccess('环境变量已刷新');
}

async function loadNpmVars(silent = false) {
  loading.value = true;
  npmError.value = '';
  try {
    const configStr = await getNpmConfig();
    const config = {};
    const lines = configStr.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([^=]+?)\s*=\s*(.+)$/);
      if (match) {
        config[match[1].trim()] = match[2].trim();
      }
    }
    npmVars.value = NPM_CONFIG_KEYS.map((def) => ({
      ...def,
      name: `npm ${def.key}`,
      value: config[def.key] || '',
    })).filter((v) => v.value);
    if (!silent) showSuccess('npm 配置已刷新');
  } catch (err) {
    npmVars.value = [];
    npmError.value = err.message || 'npm 配置读取失败';
    if (!silent) showError('刷新失败');
  }
  finally {
    loading.value = false;
  }
}

function handleCopy(value) {
  copyToClipboard(value);
  showSuccess('已复制到剪贴板');
}

async function refreshAll(silent = false) {
  refreshing.value = true;
  try {
    loadEnvVars(true);
    await loadNpmVars(true);
    if (!silent) showSuccess('环境变量与 npm 配置已刷新');
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => refreshAll(true));
</script>

<template>
  <div class="view">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconEarth class="icon" /> 环境变量</h2>
        <button class="btn btn-sm btn-secondary" :disabled="refreshing" @click="refreshAll()">
          <IconRefresh :class="{ spin: refreshing }" /> {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </div>
      <p class="section-desc">查看 Node.js 和 npm 相关的环境变量配置</p>
    </div>

    <div class="section">
      <h3 class="sub-title">系统环境变量</h3>
      <div v-if="envVars.length === 0" class="empty-state" style="padding:24px">
        <p class="empty-state-desc">未检测到 Node 相关环境变量</p>
      </div>
      <div v-else class="env-grid">
        <EnvCard
          v-for="env in envVars" :key="env.name"
          :name="env.name" :value="env.value" :description="env.description"
          @copy="handleCopy"
        />
      </div>
    </div>

    <div class="section">
      <h3 class="sub-title">npm 配置</h3>
      <div v-if="loading" class="skeleton-list">
        <div v-for="i in 3" :key="i" class="skeleton" style="height:80px;margin-bottom:8px" />
      </div>
      <div v-else-if="npmError" class="empty-state" style="padding:24px">
        <p class="empty-state-desc">{{ npmError }}</p>
        <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="refreshAll()">重试</button>
      </div>
      <div v-else-if="npmVars.length === 0" class="empty-state" style="padding:24px">
        <p class="empty-state-desc">未检测到 npm 配置</p>
      </div>
      <div v-else class="env-grid">
        <EnvCard
          v-for="env in npmVars" :key="env.name"
          :name="env.name" :value="env.value" :description="env.description"
          @copy="handleCopy"
        />
      </div>
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
.sub-title { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 12px; }
.env-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.skeleton-list { display: flex; flex-direction: column; }
</style>
