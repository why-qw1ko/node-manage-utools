const CREATED_AT_PATTERN = /^[1-9]\d{0,18}$/;

async function callProcessService(method, ...args) {
  const service = window.nodeAPI?.process;
  if (typeof service?.[method] !== 'function') throw new Error('无法连接 uTools 的进程服务，请重开插件');
  return service[method](...args);
}

function processIdentity(item) {
  return {
    pid: String(item?.pid || ''),
    createdAt: String(item?.createdAt || ''),
    name: item?.name || '',
  };
}

function hasProcessIdentity(item) {
  return item.pid && CREATED_AT_PATTERN.test(item.createdAt);
}

function formatProcessDetails(item) {
  return {
    ...processIdentity(item),
    exe: item.exe || '',
    cmd: item.cmd || '',
    memory: formatBytes(item.mem),
    isCritical: item.isCritical === true,
  };
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// 系统服务/组件进程：关闭会导致对应服务或界面异常（通常可自行恢复）。
const PROTECTED_NAMES = new Set([
  'svchost.exe',
  'dwm.exe',
  'fontdrvhost.exe',
  'audiodg.exe',
  'spoolsv.exe',
  'explorer.exe',
]);

/**
 * Classify a process for kill-safety purposes.
 * @param {{ name: string, pid: string|number, isCritical: boolean }} process
 * @returns {{ level: 'critical'|'system'|'user', label: string }}
 */
export function classifyProcess({ name, pid, isCritical }) {
  const lower = String(name || '').toLowerCase();
  const numericPid = Number(pid);
  if (numericPid === 0) return { level: 'critical', label: '系统空闲进程' };
  if (numericPid === 4) return { level: 'critical', label: '系统进程 (PID 4)' };
  if (isCritical || numericPid < 5) return { level: 'critical', label: '系统关键进程' };
  if (PROTECTED_NAMES.has(lower)) return { level: 'system', label: '系统服务/组件进程' };
  return { level: 'user', label: '' };
}

export async function listNodeProcesses() {
  const rows = await callProcessService('listNodeProcesses');
  return rows.map((item) => ({
    ...processIdentity(item),
    command: item.cmd || 'node.exe',
    memory: formatBytes(item.mem),
  })).filter(hasProcessIdentity);
}

export async function killNodeProcess(process) {
  await callProcessService('killNodeProcess', processIdentity(process));
}

export async function detectPort(port) {
  const rows = await callProcessService('detectPort', port);
  return rows.map((item) => ({
    ...formatProcessDetails(item),
    parentPid: item.parentPid ? String(item.parentPid) : '',
  })).filter(hasProcessIdentity);
}

export async function killPortProcess(port, process) {
  await callProcessService('killPortProcess', port, processIdentity(process));
}

export async function killProcess(process, folderPath) {
  await callProcessService('killFolderProcess', folderPath, processIdentity(process));
}

export async function findFolderOccupiers(folderPath) {
  const rows = await callProcessService('findFolderOccupiers', folderPath);
  const items = rows.map((item) => ({
    ...formatProcessDetails(item),
    reason: item.reason || '',
  })).filter(hasProcessIdentity);

  // 可执行文件就在目录内的进程优先展示。
  return items.sort((a, b) => {
    const aInside = a.reason.includes('可执行文件位于该目录') ? 1 : 0;
    const bInside = b.reason.includes('可执行文件位于该目录') ? 1 : 0;
    return bInside - aInside;
  });
}
