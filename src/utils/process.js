import { execFileCommand } from './command.js';
import { redactCommandLine } from './credentials.js';

const PS_TIMEOUT = 25000;

async function runPs(script) {
  const api = window.nodeAPI;
  if (!api?.execFile) throw new Error('无法连接 uTools 的进程服务，请重开插件');
  const platform = api.os?.platform?.();
  if (platform && platform !== 'win32') throw new Error('此功能仅支持 Windows');

  const command = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'try {',
    script,
    '} catch {',
    '  $cause = $_.Exception',
    '  while ($cause.InnerException) { $cause = $cause.InnerException }',
    "  if ($_.CategoryInfo.Category -in 'PermissionDenied', 'SecurityError' -or $cause -is [UnauthorizedAccessException] -or ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 5)) {",
    "    [Console]::Error.WriteLine('权限不足，无法确认或操作此进程。请检查当前账户的权限后重新检测。')",
    '  } else {',
    '    [Console]::Error.WriteLine($_.Exception.Message)',
    '  }',
    '  exit 1',
    '}',
  ].join('\n');
  try {
    return await execFileCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: PS_TIMEOUT });
  } catch (error) {
    if (error.code === null || error.code === 'ETIMEDOUT') {
      throw new Error('进程操作超时或中断，请重新检测后再试');
    }
    if (error.code === 'ENOENT') throw new Error('无法启动 Windows PowerShell，请检查系统配置');
    throw error;
  }
}

/** Pass Unicode paths and names as data without PowerShell quoting rules. */
function psString(value) {
  const encoded = btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''));
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))`;
}

const PORT_MATCH_SCRIPT = [
  'function Get-PortListeners {',
  '  param([int]$port)',
  '  try { Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop } catch {',
  "    if ($_.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound*') { throw }",
  '  }',
  '}',
];

const FOLDER_MATCH_SCRIPT = [
  'function Get-MatchDirectory {',
  '  param([string]$Directory)',
  '  $item = Get-Item -LiteralPath $Directory -ErrorAction Stop',
  "  if ($item.PSProvider.Name -ne 'FileSystem' -or -not $item.PSIsContainer) { throw '请选择文件系统中的文件夹' }",
  "  $root = [IO.Path]::GetPathRoot($item.FullName).TrimEnd('\\', '/')",
  "  if ([string]::Equals($item.FullName.TrimEnd('\\', '/'), $root, [System.StringComparison]::OrdinalIgnoreCase)) { throw '请选择具体文件夹，无法检测整个磁盘或共享根目录' }",
  '  return $item.FullName',
  '}',
  'function Get-FolderMatchReasons {',
  '  param([string]$Directory, [string]$Executable, [string]$CommandLine)',
  "  $base = $Directory.TrimEnd('\\', '/')",
  '  $reasons = @()',
  "  if ($Executable -and $Executable.StartsWith($base + '\\', [System.StringComparison]::OrdinalIgnoreCase)) { $reasons += '可执行文件位于该目录' }",
  '  if ($CommandLine) {',
  "    $pattern = '(^|[\\s\"''=])' + [regex]::Escape($base) + '($|[\\\\/\\s\"'';,])'",
  "    if ([regex]::IsMatch($CommandLine, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) { $reasons += '命令行引用该目录' }",
  '  }',
  '  return $reasons',
  '}',
];

const CREATED_AT_PATTERN = /^[1-9]\d{0,18}$/;

function validateProcessIdentity(process) {
  const pid = Number(process?.pid);
  const createdAt = String(process?.createdAt || '');
  const name = String(process?.name || '');
  if (!Number.isInteger(pid) || pid <= 4 || pid > 0xffffffff) throw new Error('无法操作此进程 ID');
  if (!CREATED_AT_PATTERN.test(createdAt) || !name) throw new Error('缺少进程身份信息，请重新检测');
  return { pid, createdAt, name };
}

function confirmProcessScript(process) {
  const { pid, createdAt, name } = validateProcessIdentity(process);
  return [
    `$target = ${pid}`,
    `$createdAt = '${createdAt}'`,
    `$expectedName = ${psString(name)}`,
    '$hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop',
    "if ($target -eq $PID -or $target -eq $hostProcess.ParentProcessId) { throw '无法终止当前插件的进程服务' }",
    '$p = Get-CimInstance Win32_Process -Filter "ProcessId = $target" -ErrorAction Stop',
    "if (-not $p -or -not $p.CreationDate -or $p.CreationDate.ToUniversalTime().Ticks.ToString() -ne $createdAt -or $p.Name -ne $expectedName) { throw '进程已变化，请重新检测' }",
  ];
}

const OPEN_CONFIRMED_PROCESS = [
  '$targetProcess = Get-Process -Id $target -ErrorAction Stop',
  '$null = $targetProcess.Handle',
  "if ([math]::Abs($targetProcess.StartTime.ToUniversalTime().Ticks - [long]$createdAt) -gt 10000) { throw '进程已变化，请重新检测' }",
];

const KILL_CONFIRMED_PROCESS = [
  '$targetProcess.Kill()',
  "if (-not $targetProcess.WaitForExit(3000)) { throw '暂未确认进程退出，请重新检测' }",
];

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

export async function listNodeProcesses() {
  const script = [
    '$processes = Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" -ErrorAction Stop',
    '$rows = foreach ($p in $processes) {',
    '  if (-not $p.CreationDate) { continue }',
    '  [PSCustomObject]@{',
    '    pid = [string]$p.ProcessId',
    '    createdAt = $p.CreationDate.ToUniversalTime().Ticks.ToString()',
    '    name = [string]$p.Name',
    '    cmd = [string]$p.CommandLine',
    '    mem = [int64]$p.WorkingSetSize',
    '  }',
    '}',
    "if (@($rows).Count -eq 0) { '[]' } else { $rows | ConvertTo-Json -Compress }",
  ].join('\n');

  return parseJsonCollection(await runPs(script)).map((item) => ({
    pid: String(item.pid || ''),
    createdAt: String(item.createdAt || ''),
    name: item.name || '',
    command: redactCommandLine(item.cmd) || 'node.exe',
    memory: formatBytes(item.mem),
  })).filter((item) => item.pid && CREATED_AT_PATTERN.test(item.createdAt));
}

export async function killNodeProcess(process) {
  if (String(process?.name || '').toLowerCase() !== 'node.exe') throw new Error('请重新检测 Node.js 进程');
  await runPs([...confirmProcessScript(process), ...OPEN_CONFIRMED_PROCESS, ...KILL_CONFIRMED_PROCESS].join('\n'));
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
    ...PORT_MATCH_SCRIPT,
    `$port = ${numericPort}`,
    '$conns = @(Get-PortListeners $port)',
    '$ownerPids = $conns | Select-Object -ExpandProperty OwningProcess -Unique',
    '$rows = foreach ($ownerPid in $ownerPids) {',
    '  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction Stop',
    '  if (-not $p -or -not $p.CreationDate -or -not $p.Name) { throw "端口存在监听记录，但无法核实 PID $ownerPid 的身份，请重新检测" }',
    '  [PSCustomObject]@{',
    '    pid = [string]$p.ProcessId',
    '    createdAt = $p.CreationDate.ToUniversalTime().Ticks.ToString()',
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
      createdAt: String(item.createdAt || ''),
      name: item.name || '',
      exe: item.exe || '',
      cmd: redactCommandLine(item.cmd),
      memory: formatBytes(item.mem),
      parentPid: item.parentPid ? String(item.parentPid) : '',
    }))
    .filter((process) => process.pid && CREATED_AT_PATTERN.test(process.createdAt));
}

/** Kill the originally detected process only while it still listens on the port. */
export async function killPortProcess(port, process) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error('端口号无效，请输入 1-65535 之间的整数');
  }
  const script = [
    ...PORT_MATCH_SCRIPT,
    `$port = ${numericPort}`,
    ...confirmProcessScript(process),
    ...OPEN_CONFIRMED_PROCESS,
    '$still = @(Get-PortListeners $port | Where-Object { $_.OwningProcess -eq $target })',
    "if ($still.Count -eq 0) { throw '该端口已不再被此进程占用，无需关闭' }",
    ...KILL_CONFIRMED_PROCESS,
  ].join('\n');
  await runPs(script);
}

/** Kill a previously detected folder process only if its identity and match still hold. */
export async function killProcess(process, folderPath) {
  const target = String(folderPath || '').trim();
  if (!target) throw new Error('请先输入或选择一个文件夹路径');

  const script = [
    ...FOLDER_MATCH_SCRIPT,
    `$folder = ${psString(target)}`,
    '$full = Get-MatchDirectory $folder',
    ...confirmProcessScript(process),
    ...OPEN_CONFIRMED_PROCESS,
    '$reasons = @(Get-FolderMatchReasons $full ([string]$p.ExecutablePath) ([string]$p.CommandLine))',
    "if ($reasons.Count -eq 0) { throw '该进程已不再匹配此目录，请重新检测' }",
    ...KILL_CONFIRMED_PROCESS,
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
    ...FOLDER_MATCH_SCRIPT,
    `$folder = ${psString(target)}`,
    '$full = Get-MatchDirectory $folder',
    '$procs = Get-CimInstance Win32_Process -ErrorAction Stop',
    '$rows = foreach ($p in $procs) {',
    '  if ($p.ProcessId -eq $PID -or -not $p.CreationDate -or -not $p.Name) { continue }',
    '  $exe = [string]$p.ExecutablePath',
    '  $cmd = [string]$p.CommandLine',
    '  $reasons = @(Get-FolderMatchReasons $full $exe $cmd)',
    '  if ($reasons.Count -gt 0) {',
    '    [PSCustomObject]@{',
    '      pid = [string]$p.ProcessId',
    '      createdAt = $p.CreationDate.ToUniversalTime().Ticks.ToString()',
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
      createdAt: String(item.createdAt || ''),
      name: item.name || '',
      exe: item.exe || '',
      cmd: redactCommandLine(item.cmd),
      memory: formatBytes(item.mem),
      reason: item.reason || '',
    }))
    .filter((process) => process.pid && CREATED_AT_PATTERN.test(process.createdAt));

  // 可执行文件就在目录内的进程优先展示。
  return items.sort((a, b) => {
    const aInside = a.reason.includes('可执行文件位于该目录') ? 1 : 0;
    const bInside = b.reason.includes('可执行文件位于该目录') ? 1 : 0;
    return bInside - aInside;
  });
}
