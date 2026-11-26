const path = require('path');
const { redactCommandLine } = require('./credentials.js');

const CRITICAL_PROCESS_NAMES = [
  'system', 'system idle process', 'registry', 'memory compression',
  'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe',
];
const CRITICAL_PROCESS_NAMES_PS = CRITICAL_PROCESS_NAMES.map((name) => `'${name}'`).join(', ');
const CRITICAL_PROCESS_ERROR = 'Windows 系统关键进程受保护，无法终止';

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
  "  if ([string]::Equals($item.FullName.TrimEnd('\\', '/'), $root, [System.StringComparison]::OrdinalIgnoreCase)) { throw '请选择具体文件夹，无法检测整个磁盘' }",
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

const OPEN_CONFIRMED_PROCESS = [
  '$targetProcess = Get-Process -Id $target -ErrorAction Stop',
  '$null = $targetProcess.Handle',
  "if ([math]::Abs($targetProcess.StartTime.ToUniversalTime().Ticks - [long]$createdAt) -gt 10000) { throw '进程已变化，请重新检测' }",
];

const KILL_CONFIRMED_PROCESS = [
  '$targetProcess.Kill()',
  "if (-not $targetProcess.WaitForExit(3000)) { throw '暂未确认进程退出，请重新检测' }",
];

const JSON_ROWS = "if ($null -eq $rows) { '[]' } else { $rows | ConvertTo-Json -Compress }";

function parseInteger(value, min, max, message) {
  const number = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(message);
  return number;
}

function validatePort(port) {
  return parseInteger(port, 1, 65535, '端口号无效，请输入 1-65535 之间的整数');
}

function validateFolder(directory) {
  const value = typeof directory === 'string' && directory.length <= 1024
    ? directory.trim().replaceAll('/', '\\')
    : '';
  // Drive-letter paths exclude PowerShell providers, UNC shares and Windows device namespaces.
  if (!/^[a-z]:\\[^<>:"|?*\x00-\x1f\x7f]*$/i.test(value)) {
    throw new Error('请输入带盘符的绝对文件夹路径');
  }
  const normalized = path.win32.normalize(value);
  if (normalized === path.win32.parse(normalized).root) throw new Error('请选择具体文件夹，无法检测整个磁盘');
  return normalized;
}

/** Keep validated Unicode text in data literals without relying on PowerShell escaping. */
function psString(value) {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))`;
}

function confirmProcessScript(identity, nodeOnly = false) {
  const { pid, createdAt, name } = identity ?? {};
  const target = parseInteger(pid, 5, 0x7fffffff, '无法操作此进程 ID');
  if (typeof createdAt !== 'string' || !/^[1-9]\d{0,18}$/.test(createdAt)
      || BigInt(createdAt) > 3155378975999999999n
      || typeof name !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f\x7f]{1,255}$/.test(name)) {
    throw new Error('缺少进程身份信息，请重新检测');
  }
  if (nodeOnly && name.toLowerCase() !== 'node.exe') throw new Error('请重新检测 Node.js 进程');
  if (CRITICAL_PROCESS_NAMES.includes(name.toLowerCase())) throw new Error(CRITICAL_PROCESS_ERROR);
  return [
    `$target = ${target}`,
    `$createdAt = '${createdAt}'`,
    `$expectedName = ${nodeOnly ? "'node.exe'" : psString(name)}`,
    '$hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop',
    "if (-not $hostProcess -or $target -eq $PID -or $target -eq $hostProcess.ParentProcessId) { throw '无法终止当前插件的进程服务' }",
    '$p = Get-CimInstance Win32_Process -Filter "ProcessId = $target" -ErrorAction Stop',
    `if ($p.Name -in @(${CRITICAL_PROCESS_NAMES_PS})) { throw '${CRITICAL_PROCESS_ERROR}' }`,
    "if (-not $p -or -not $p.CreationDate -or $p.CreationDate.ToUniversalTime().Ticks.ToString() -ne $createdAt -or $p.Name -ne $expectedName) { throw '进程已变化，请重新检测' }",
  ];
}

function createProcessService(runPowerShell) {
  async function runScript(lines) {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'try {',
      ...lines,
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
      const command = Buffer.from(script, 'utf16le').toString('base64');
      return await runPowerShell(['-NoProfile', '-NonInteractive', '-EncodedCommand', command]);
    } catch (error) {
      if (error.code === null || error.code === 'ETIMEDOUT') throw new Error('进程操作超时或中断，请重新检测后再试');
      if (error.code === 'ENOENT') throw new Error('无法启动 Windows PowerShell，请检查系统配置');
      throw error;
    }
  }

  async function queryProcesses(lines) {
    const output = await runScript([...lines, JSON_ROWS]);
    let result;
    try {
      result = JSON.parse(output.trim());
    } catch {
      throw new Error('无法读取进程检测结果，请重新检测');
    }
    const rows = Array.isArray(result) ? result : [result];
    return rows.map((row) => ({
      ...row,
      cmd: redactCommandLine(row.cmd),
      isCritical: Number(row.pid) <= 4 || CRITICAL_PROCESS_NAMES.includes(String(row.name).toLowerCase()),
    }));
  }

  return {
    async listNodeProcesses() {
      return queryProcesses([
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
      ]);
    },
    async killNodeProcess(identity) {
      await runScript([
        ...confirmProcessScript(identity, true),
        ...OPEN_CONFIRMED_PROCESS,
        ...KILL_CONFIRMED_PROCESS,
      ]);
    },
    async detectPort(port) {
      return queryProcesses([
        ...PORT_MATCH_SCRIPT,
        `$port = ${validatePort(port)}`,
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
      ]);
    },
    async killPortProcess(port, identity) {
      await runScript([
        ...PORT_MATCH_SCRIPT,
        `$port = ${validatePort(port)}`,
        ...confirmProcessScript(identity),
        ...OPEN_CONFIRMED_PROCESS,
        '$still = @(Get-PortListeners $port | Where-Object { $_.OwningProcess -eq $target })',
        "if ($still.Count -eq 0) { throw '该端口已不再被此进程占用，无需关闭' }",
        ...KILL_CONFIRMED_PROCESS,
      ]);
    },
    async findFolderOccupiers(directory) {
      return queryProcesses([
        ...FOLDER_MATCH_SCRIPT,
        `$folder = ${psString(validateFolder(directory))}`,
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
      ]);
    },
    async killFolderProcess(directory, identity) {
      await runScript([
        ...FOLDER_MATCH_SCRIPT,
        `$folder = ${psString(validateFolder(directory))}`,
        '$full = Get-MatchDirectory $folder',
        ...confirmProcessScript(identity),
        ...OPEN_CONFIRMED_PROCESS,
        '$reasons = @(Get-FolderMatchReasons $full ([string]$p.ExecutablePath) ([string]$p.CommandLine))',
        "if ($reasons.Count -eq 0) { throw '该进程已不再匹配此目录，请重新检测' }",
        ...KILL_CONFIRMED_PROCESS,
      ]);
    },
  };
}

module.exports = { createProcessService };
