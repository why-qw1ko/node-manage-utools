import { execFileCommand } from './command.js';

const PS_TIMEOUT = 25000;

function runPs(script) {
  return execFileCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: PS_TIMEOUT },
  );
}

/** Quote a string for use inside a PowerShell single-quoted literal. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Parse PowerShell `ConvertTo-Json` output that may be an object or array. */
function parseJsonCollection(output) {
  const raw = output && output.trim() ? JSON.parse(output) : [];
  return Array.isArray(raw) ? raw : [raw];
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// 系统关键进程：强杀可能导致系统崩溃、蓝屏或无法登录。
const CRITICAL_NAMES = new Set([
  'system',
  'system idle process',
  'registry',
  'memory compression',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
]);
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
 * @param {string} name process image name (e.g. "node.exe")
 * @param {string|number} pid
 * @returns {{ level: 'critical'|'system'|'user', label: string }}
 */
export function classifyProcess(name, pid) {
  const lower = String(name || '').toLowerCase();
  const numericPid = Number(pid);
  if (numericPid === 0) return { level: 'critical', label: '系统空闲进程' };
  if (numericPid === 4) return { level: 'critical', label: '系统进程 (PID 4)' };
  if (CRITICAL_NAMES.has(lower)) return { level: 'critical', label: '系统关键进程' };
  if (PROTECTED_NAMES.has(lower)) return { level: 'system', label: '系统服务/组件进程' };
  return { level: 'user', label: '' };
}

/**
 * Detect processes listening on a given port.
 * @param {string|number} port
 * @returns {Promise<Array<object>>}
 */
export async function detectPort(port) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error('端口号无效，请输入 1-65535 之间的整数');
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$port = ${numericPort}`,
    '$conns = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)',
    "if ($conns.Count -eq 0) { '[]'; exit }",
    '$ownerPids = $conns | Select-Object -ExpandProperty OwningProcess -Unique',
    '$rows = foreach ($ownerPid in $ownerPids) {',
    '  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue',
    '  if (-not $p) { continue }',
    '  [PSCustomObject]@{',
    '    pid = [string]$p.ProcessId',
    '    name = [string]$p.Name',
    '    exe = [string]$p.ExecutablePath',
    '    cmd = [string]$p.CommandLine',
    '    mem = [int64]$p.WorkingSetSize',
    '    parentPid = [string]$p.ParentProcessId',
    '  }',
    '}',
    '$result = @($rows)',
    "if ($result.Count -eq 0) { '[]' } else { $result | ConvertTo-Json -Compress }",
  ].join('\n');

  const output = await runPs(script);
  return parseJsonCollection(output)
    .map((item) => ({
      pid: String(item.pid || ''),
      name: item.name || '',
      exe: item.exe || '',
      cmd: item.cmd || '',
      memory: formatBytes(item.mem),
      parentPid: item.parentPid ? String(item.parentPid) : '',
    }))
    .filter((process) => process.pid);
}

/**
 * Kill the process currently listening on a port, re-verifying ownership first.
 * @param {string|number} port
 * @param {string|number} pid
 * @returns {Promise<void>}
 */
export async function killPortProcess(port, pid) {
  const numericPort = Number(port);
  const numericPid = Number(pid);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$port = ${numericPort}`,
    `$target = ${numericPid}`,
    '$still = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $target })',
    "if ($still.Count -eq 0) { throw '该端口已不再被此进程占用，无需关闭' }",
    'Stop-Process -Id $target -Force -ErrorAction Stop',
  ].join('\n');
  await runPs(script);
}

/**
 * Kill a process by PID.
 * @param {string|number} pid
 * @returns {Promise<void>}
 */
export async function killProcess(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    throw new Error('进程 ID 无效');
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$target = ${numericPid}`,
    'Stop-Process -Id $target -Force -ErrorAction Stop',
  ].join('\n');
  await runPs(script);
}

/**
 * Find processes that occupy a folder, based on executable path or command line.
 * @param {string} folderPath
 * @returns {Promise<Array<object>>}
 */
export async function findFolderOccupiers(folderPath) {
  const target = String(folderPath || '').trim();
  if (!target) throw new Error('请先输入或选择一个文件夹路径');

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$folder = ${psQuote(target)}`,
    "if (-not (Test-Path -LiteralPath $folder)) { throw '路径不存在或无法访问' }",
    '$item = Get-Item -LiteralPath $folder -ErrorAction Stop',
    '$full = $item.FullName',
    "$norm = $full.TrimEnd('\\') + '\\'",
    '$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue',
    '$rows = foreach ($p in $procs) {',
    '  $exe = [string]$p.ExecutablePath',
    '  $cmd = [string]$p.CommandLine',
    '  $match = $false',
    '  $reasons = @()',
    "  if ($exe -and $exe.StartsWith($norm, [System.StringComparison]::OrdinalIgnoreCase)) { $match = $true; $reasons += '可执行文件位于该目录' }",
    "  if ($cmd -and $cmd.IndexOf($full, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $match = $true; $reasons += '命令行引用该目录' }",
    '  if ($match) {',
    '    [PSCustomObject]@{',
    '      pid = [string]$p.ProcessId',
    '      name = [string]$p.Name',
    '      exe = $exe',
    '      cmd = $cmd',
    '      mem = [int64]$p.WorkingSetSize',
    '      reason = ($reasons -join "；")',
    '    }',
    '  }',
    '}',
    '$result = @($rows)',
    "if ($result.Count -eq 0) { '[]' } else { $result | ConvertTo-Json -Compress }",
  ].join('\n');

  const output = await runPs(script);
  const items = parseJsonCollection(output)
    .map((item) => ({
      pid: String(item.pid || ''),
      name: item.name || '',
      exe: item.exe || '',
      cmd: item.cmd || '',
      memory: formatBytes(item.mem),
      reason: item.reason || '',
    }))
    .filter((process) => process.pid);

  // 可执行文件就在目录内的进程优先展示。
  const normalized = target.replace(/[\\/]+$/, '').toLowerCase();
  return items.sort((a, b) => {
    const aInside = a.exe.toLowerCase().startsWith(normalized) ? 1 : 0;
    const bInside = b.exe.toLowerCase().startsWith(normalized) ? 1 : 0;
    return bInside - aInside;
  });
}
