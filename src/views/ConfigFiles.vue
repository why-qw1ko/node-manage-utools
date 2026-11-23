<script setup>
import { ref, watch, onActivated } from 'vue';
import IconFileCogOutline from '~icons/mdi/file-cog-outline';
import IconRefresh from '~icons/mdi/refresh';
import IconCogOutline from '~icons/mdi/cog-outline';
import IconContentCopy from '~icons/mdi/content-copy';
import ConfigFileCard from '../components/ConfigFileCard.vue';
import { getConfigFiles, initNpmPrefix } from '../constants/files.js';
import { getNpmCacheDir, getNpmConfig, getNpmGlobalConfigPath } from '../utils/npm.js';
import { openPath, copyToClipboard, showSuccess, showError } from '../utils/utools.js';

const props = defineProps({ hasNvm: Boolean });

const files = ref([]);
const filesLoading = ref(false);
const filesError = ref('');
const npmConfig = ref('');
const configLoading = ref(false);
const npmConfigError = ref('');

async function loadFiles(silent = false) {
  if (filesLoading.value) return;
  filesLoading.value = true;
  filesError.value = '';
  try {
    const [globalConfig, cacheDir] = await Promise.all([
      getNpmGlobalConfigPath().catch(() => ''),
      getNpmCacheDir().catch(() => ''),
      initNpmPrefix(),
    ]);
    const allFiles = getConfigFiles({ globalConfig, cacheDir });
    files.value = allFiles
      .filter((f) => !f.requireNvm || props.hasNvm)
      .map((f) => ({ ...f, exists: checkPath(f.path, f.type) }));
    if (!silent) showSuccess('配置文件列表已刷新');
  } catch (err) {
    filesError.value = err.message || '配置文件列表读取失败';
    files.value = [];
    if (!silent) showError(`刷新失败: ${filesError.value}`);
  } finally {
    filesLoading.value = false;
  }
}

async function loadNpmConfig(silent = false) {
  if (configLoading.value) return;
  configLoading.value = true;
  npmConfigError.value = '';
  try {
    npmConfig.value = await getNpmConfig();
    if (!silent) showSuccess('npm 配置已刷新');
  } catch (error) {
    npmConfig.value = '';
    npmConfigError.value = error.message || 'npm 配置读取失败';
    if (!silent) showError(npmConfigError.value);
  }
  finally {
    configLoading.value = false;
  }
}

function checkPath(filePath, type) {
  try {
    const details = window.nodeAPI.fs.statSync(filePath);
    return type === 'directory' ? details.isDirectory() : details.isFile();
  } catch {
    return false;
  }
}

function handleOpen(fp) {
  const file = files.value.find(({ path }) => path === fp);
  if (!file || !checkPath(fp, file.type)) {
    showError('文件或目录已不可用，请刷新配置文件列表');
  } else if (!openPath(fp)) {
    showError(file.needAdmin ? '无法打开 hosts，请检查权限或使用管理员编辑器' : '打开失败，请检查文件权限');
  }
}
function handleCopyPath(fp) {
  if (copyToClipboard(fp)) showSuccess('路径已复制');
  else showError('复制路径失败');
}

function handleCopyConfig() {
  if (copyToClipboard(npmConfig.value)) showSuccess('配置已复制');
  else showError('复制配置失败');
}

watch(() => props.hasNvm, () => loadFiles(true));
onActivated(() => {
  loadFiles(true);
  loadNpmConfig(true);
});
</script>

<template>
  <div class="config-files">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title"><IconFileCogOutline class="section-icon" /> 配置文件</h2>
        <button class="btn btn-sm btn-secondary" :disabled="filesLoading" @click="loadFiles()">
          <IconRefresh :class="{ spin: filesLoading }" /> {{ filesLoading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <p class="section-desc">
        快速打开常用的 Node.js 和 npm 配置文件及目录。
        <span v-if="!hasNvm" class="tag tag-warning" style="margin-left:8px">部分功能需要 nvm</span>
      </p>
    </div>
    <div v-if="filesLoading" class="file-grid">
      <div v-for="i in 4" :key="i" class="skeleton" style="height:142px" />
    </div>
    <div v-else-if="filesError" class="empty-state" style="padding:24px">
      <IconFileCogOutline class="empty-state-icon" style="width:36px;height:36px" />
      <p class="empty-state-desc">{{ filesError }}</p>
      <button class="btn btn-sm btn-secondary" style="margin-top:12px" @click="loadFiles()">重试</button>
    </div>
    <div v-else class="file-grid">
      <ConfigFileCard
        v-for="file in files" :key="file.id"
        :name="file.name" :description="file.description" :icon="file.icon"
        :path="file.path" :type="file.type" :exists="file.exists" :need-admin="file.needAdmin"
        @open="handleOpen" @copy-path="handleCopyPath"
      />
    </div>

    <div class="section" style="margin-top:24px">
      <div class="section-header">
        <h2 class="section-title"><IconCogOutline class="section-icon" /> npm 配置</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-secondary" :disabled="configLoading" @click="loadNpmConfig()">
            <IconRefresh :class="{ spin: configLoading }" /> {{ configLoading ? '刷新中' : '刷新' }}
          </button>
          <button class="btn btn-sm btn-ghost" :disabled="configLoading || !npmConfig" @click="handleCopyConfig"><IconContentCopy /> 复制</button>
        </div>
      </div>
      <div v-if="configLoading" class="skeleton" style="height:120px" />
      <div v-else-if="npmConfigError" class="empty-state" role="alert">
        <p class="empty-state-desc">{{ npmConfigError }}</p>
      </div>
      <pre v-else class="config-output">{{ npmConfig || '暂无配置信息' }}</pre>
    </div>
  </div>
</template>

<style scoped>
.config-files { height: 100%; overflow-y: auto; padding: 20px; }
.section { margin-bottom: 20px; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text); }
.section-icon { width: 20px; height: 20px; color: var(--primary); }
.section-desc { font-size: 13px; color: var(--text-secondary); }
.file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.config-output {
  padding: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
