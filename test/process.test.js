import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import processService from '../public/preload/process-service.js';
import { classifyProcess, formatBytes, listNodeProcesses, killNodeProcess, detectPort, killPortProcess, findFolderOccupiers, killProcess } from '../src/utils/process.js';

const { createProcessService } = processService;
const identity = { pid: '123', name: 'node.exe', createdAt: '639000000000000000' };

function installService(t, service) {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { nodeAPI: { process: service } };
}

function decodePowerShellArgs(args) {
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  return Buffer.from(args[3], 'base64').toString('utf16le');
}

test('formatBytes converts raw byte counts to readable strings', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
});

test('process service redacts command lines before returning any detection results', async (t) => {
  const service = createProcessService(async () => JSON.stringify({
    ...identity, cmd: 'node app.js --token sample-value --password "sample phrase"',
  }));
  const expected = 'node app.js --token [已隐藏] --password [已隐藏]';
  for (const [process] of await Promise.all([
    service.listNodeProcesses(), service.detectPort(8080), service.findFolderOccupiers('C:\\repo'),
  ])) {
    assert.equal(process.cmd, expected);
    assert.equal(process.createdAt, identity.createdAt);
  }
  installService(t, service);
  const [process] = await listNodeProcesses();
  assert.equal(process.command, expected);
});

test('preload classifications reach the renderer for critical processes', async (t) => {
  const service = createProcessService(async () => JSON.stringify([
    { ...identity, name: 'System', pid: '4' },
    { ...identity, name: 'smss.exe' },
    { ...identity, name: 'LSASS.EXE', pid: '999' },
  ]));
  installService(t, service);
  const rows = await detectPort(8080);
  assert.deepEqual(rows.map((row) => classifyProcess(row).level), ['critical', 'critical', 'critical']);
});

test('classifyProcess flags protected system service processes', () => {
  assert.equal(classifyProcess({ name: 'svchost.exe', pid: 1000 }).level, 'system');
  assert.equal(classifyProcess({ name: 'explorer.exe', pid: 2000 }).level, 'system');
});

test('process detection carries creation identity into guarded termination commands', async (t) => {
  const scripts = [];
  installService(t, createProcessService(async (args) => {
    const script = decodePowerShellArgs(args);
    scripts.push(script);
    if (!script.includes('ConvertTo-Json')) return '';
    return JSON.stringify({ ...identity, reason: '命令行引用该目录' });
  }));

  const [portProcess] = await detectPort(8080);
  await killPortProcess(8080, portProcess);
  const [folderProcess] = await findFolderOccupiers('C:\\repo');
  await killProcess(folderProcess, 'C:\\repo');
  const [nodeProcess] = await listNodeProcesses();
  await killNodeProcess(nodeProcess);

  assert.equal(portProcess.createdAt, '639000000000000000');
  assert.equal(folderProcess.createdAt, portProcess.createdAt);
  assert.equal(nodeProcess.createdAt, portProcess.createdAt);
  assert.match(scripts[0], /Get-NetTCPConnection -State Listen -LocalPort \$port -ErrorAction Stop/);
  assert.doesNotMatch(scripts[0], /-ErrorAction SilentlyContinue/);
  assert.match(scripts[1], /Get-CimInstance Win32_Process/);
  assert.match(scripts[1], /Get-NetTCPConnection -State Listen -LocalPort \$port/);
  assert.match(scripts[1], /\[math\]::Abs\(\$targetProcess\.StartTime\.ToUniversalTime\(\)\.Ticks - \[long\]\$createdAt\) -gt 10000/);
  assert.match(scripts[1], /\$targetProcess\.Kill\(\)/);
  assert.match(scripts[3], /Get-FolderMatchReasons \$full/);
  assert.match(scripts[3], /\$createdAt = '639000000000000000'/);
  assert.match(scripts[3], /\$targetProcess\.Kill\(\)/);
  assert.doesNotMatch(scripts[3], /Stop-Process -Id/);
  for (const script of [scripts[1], scripts[3], scripts[5]]) {
    assert.match(script, /\$p\.Name -ne \$expectedName/);
    assert.match(script, /\$targetProcess\.Handle[\s\S]+\$targetProcess\.StartTime/);
    assert.match(script, /\$targetProcess\.WaitForExit\(3000\)/);
  }

  if (process.platform === 'win32') {
    for (const script of scripts) {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseInput($env:NODE_MANAGER_TEST_SCRIPT, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }',
      ], { env: { ...process.env, NODE_MANAGER_TEST_SCRIPT: script }, timeout: 10000 });
    }
  }
});

test('renderer sends structured operation arguments without process display fields', async (t) => {
  installService(t, {
    killNodeProcess: async (...args) => assert.deepEqual(args, [identity]),
    killPortProcess: async (...args) => assert.deepEqual(args, [8080, identity]),
    killFolderProcess: async (...args) => assert.deepEqual(args, ['C:\\repo', identity]),
  });
  const row = { ...identity, memory: '1.5 MB', command: 'node sample.js' };
  await killNodeProcess(row);
  await killPortProcess(8080, row);
  await killProcess(row, 'C:\\repo');
});

test('preload validates operation parameters before launching PowerShell', async () => {
  const service = createProcessService(() => assert.fail('invalid parameters must not launch PowerShell'));
  await assert.rejects(service.detectPort('abc'), /端口号无效/);
  await assert.rejects(service.detectPort(65536), /端口号无效/);
  await assert.rejects(service.killPortProcess(0, identity), /端口号无效/);
  await assert.rejects(service.findFolderOccupiers('relative\\repo'), /绝对文件夹路径/);
  await assert.rejects(service.findFolderOccupiers('C:\\project\\..'), /整个磁盘/);
  await assert.rejects(service.findFolderOccupiers('\\\\server\\share\\folder'), /绝对文件夹路径/);
  await assert.rejects(service.killFolderProcess('Registry::HKEY_LOCAL_MACHINE', identity), /绝对文件夹路径/);
  await assert.rejects(service.killFolderProcess('C:\\repo', { pid: '123' }), /重新检测/);
  await assert.rejects(service.killPortProcess(8080, { ...identity, createdAt: '9999999999999999999' }), /重新检测/);
  await assert.rejects(service.killNodeProcess({ ...identity, name: 'powershell.exe' }), /重新检测/);
  await assert.rejects(service.killPortProcess(8080, { ...identity, pid: '4' }), /无法操作此进程 ID/);
});

test('preload refuses to launch termination for known critical process identities', async () => {
  const service = createProcessService(() => assert.fail('protected processes must never reach termination'));
  const critical = { ...identity, name: 'LSASS.EXE' };
  await assert.rejects(service.killPortProcess(8080, critical), /系统关键进程受保护/);
  await assert.rejects(service.killFolderProcess('C:\\repo', critical), /系统关键进程受保护/);
});

test('preload keeps Unicode folder names in a PowerShell data literal', async () => {
  const folder = "C:\\项目\\O'Brien";
  const service = createProcessService(async (args) => {
    const script = decodePowerShellArgs(args);
    assert.ok(!script.includes(folder));
    const encodedFolder = script.match(/\$folder = .*FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1];
    assert.equal(Buffer.from(encodedFolder, 'base64').toString('utf8'), folder);
    return '[]';
  });
  assert.deepEqual(await service.findFolderOccupiers(folder), []);
});

test('PowerShell emits an empty array when no matching process is found', { skip: process.platform !== 'win32' }, async () => {
  const service = createProcessService(async (args) => {
    const script = decodePowerShellArgs(args);
    const command = [
      'function Get-CimInstance { }',
      'function Get-NetTCPConnection { }',
      script,
    ].join('\n');
    return execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
    ], { encoding: 'utf8', timeout: 10000 });
  });
  assert.deepEqual(await service.listNodeProcesses(), []);
  assert.deepEqual(await service.detectPort(8080), []);
  assert.deepEqual(await service.findFolderOccupiers(process.cwd()), []);
});

test('PowerShell folder matcher observes path-component boundaries', { skip: process.platform !== 'win32' }, async (t) => {
  let script = '';
  installService(t, createProcessService(async (args) => {
    script = decodePowerShellArgs(args);
    return '[]';
  }));
  await findFolderOccupiers('C:\\repo');
  const rules = script.slice(script.indexOf('function Get-MatchDirectory'), script.indexOf('$folder ='));
  const samples = [
    "@(Get-FolderMatchReasons 'C:\\repo' '' 'node C:\\repo-old\\server.js').Count",
    "@(Get-FolderMatchReasons 'C:\\repo' '' 'node \"C:\\repo\\server.js\"').Count",
    "@(Get-FolderMatchReasons 'C:\\repo' '' 'node C:\\repo').Count",
    "@(Get-FolderMatchReasons 'C:\\repo' '' 'node C:\\repository\\server.js').Count",
    "@(Get-FolderMatchReasons 'C:\\repo' 'C:\\repo-old\\node.exe' '').Count",
    "@(Get-FolderMatchReasons 'C:\\repo' 'C:\\repo\\node.exe' '').Count",
  ];
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', `${rules}\n${samples.join('\n')}`,
  ], { encoding: 'utf8', timeout: 10000 });
  assert.deepEqual(output.trim().split(/\r?\n/), ['0', '1', '1', '0', '0', '1']);
});

test('PowerShell rejects a reused Node.js PID before reaching the termination step', { skip: process.platform !== 'win32' }, async (t) => {
  let script = '';
  installService(t, createProcessService(async (args) => { script = decodePowerShellArgs(args); }));
  await killNodeProcess(identity);
  const guards = script.slice(script.indexOf('$target ='), script.indexOf('$targetProcess ='));
  const readOnlyMock = [
    'function Get-CimInstance {',
    '  param($ClassName, $Filter, $ErrorAction)',
    "  [PSCustomObject]@{ ParentProcessId = 1; Name = 'node.exe'; CreationDate = [datetime]::new(2001, 1, 1) }",
    '}',
    'try {',
    guards,
    "  'guard incorrectly passed'",
    '} catch {',
    "  if ($_.Exception.Message -like '进程已变化*') { 'stale process blocked' } else { throw }",
    '}',
  ].join('\n');

  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', readOnlyMock], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(output.trim(), 'stale process blocked');
});

test('PowerShell independently rejects the current system-critical process name', { skip: process.platform !== 'win32' }, async () => {
  let script = '';
  const service = createProcessService(async (args) => { script = decodePowerShellArgs(args); });
  await service.killPortProcess(8080, identity);
  const guards = script.slice(script.indexOf('$target ='), script.indexOf('$targetProcess ='));
  const readOnlyMock = [
    'function Get-CimInstance {',
    '  param($ClassName, $Filter, $ErrorAction)',
    "  [PSCustomObject]@{ ParentProcessId = 1; Name = 'SmSs.ExE'; CreationDate = [datetime]::new(2001, 1, 1) }",
    '}',
    'try {',
    guards,
    "  'guard incorrectly passed'",
    '} catch {',
    "  if ($_.Exception.Message -like '*系统关键进程受保护*') { 'critical process blocked' } else { throw }",
    '}',
  ].join('\n');

  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', readOnlyMock], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(output.trim(), 'critical process blocked');
});

test('process detection reports timeout and unavailable service instead of an empty list', async (t) => {
  installService(t, createProcessService(async () => { throw Object.assign(new Error('Command failed'), { code: null }); }));
  await assert.rejects(detectPort(8080), /超时或中断/);
  delete globalThis.window.nodeAPI.process;
  await assert.rejects(listNodeProcesses(), /无法连接 uTools 的进程服务/);
});

test('classifyProcess treats ordinary processes as user level', () => {
  assert.equal(classifyProcess({ name: 'node.exe', pid: 8080 }).level, 'user');
  assert.equal(classifyProcess({ name: '', pid: 1234 }).level, 'user');
});
