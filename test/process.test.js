import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { classifyProcess, formatBytes, listNodeProcesses, killNodeProcess, detectPort, killPortProcess, findFolderOccupiers, killProcess } from '../src/utils/process.js';

test('formatBytes converts raw byte counts to readable strings', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
});

test('process details hide common credentials without changing process identity', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { nodeAPI: { execFile: async () => JSON.stringify({
    pid: '123',
    name: 'node.exe',
    createdAt: '639000000000000000',
    cmd: 'node app.js --token sample-value --password "sample phrase"',
  }) } };
  const [process] = await listNodeProcesses();
  assert.equal(process.createdAt, '639000000000000000');
  assert.equal(process.command, 'node app.js --token [已隐藏] --password [已隐藏]');
});

test('classifyProcess flags system critical processes', () => {
  assert.equal(classifyProcess('System', 4).level, 'critical');
  assert.equal(classifyProcess('smss.exe', 123).level, 'critical');
  assert.equal(classifyProcess('lsass.exe', 999).level, 'critical');
});

test('classifyProcess flags protected system service processes', () => {
  assert.equal(classifyProcess('svchost.exe', 1000).level, 'system');
  assert.equal(classifyProcess('explorer.exe', 2000).level, 'system');
});

test('process detection carries creation identity into guarded termination commands', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  const scripts = [];
  globalThis.window = {
    nodeAPI: {
      execFile: async (_file, args, options) => {
        assert.equal(options.timeout, 25000);
        const script = args[3];
        scripts.push(script);
        if (script.includes('Get-NetTCPConnection') && script.includes('ConvertTo-Json')) {
          return JSON.stringify({ pid: '123', createdAt: '639000000000000000', name: 'node.exe' });
        }
        if (script.includes('Get-FolderMatchReasons') && script.includes('ConvertTo-Json')) {
          return JSON.stringify({ pid: '123', createdAt: '639000000000000000', name: 'node.exe', reason: '命令行引用该目录' });
        }
        if (script.includes('ConvertTo-Json')) {
          return JSON.stringify({ pid: '123', createdAt: '639000000000000000', name: 'node.exe' });
        }
        return '';
      },
    },
  };

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
  assert.doesNotMatch(scripts[0], /SilentlyContinue/);
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

test('PowerShell folder matcher observes path-component boundaries', { skip: process.platform !== 'win32' }, async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  let script = '';
  globalThis.window = { nodeAPI: { execFile: async (_file, args) => {
    script = args[3];
    return '[]';
  } } };
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

test('termination rejects missing process identity before starting PowerShell', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  let calls = 0;
  globalThis.window = { nodeAPI: { execFile: async () => { calls += 1; } } };
  await assert.rejects(killProcess({ pid: '123' }, 'C:\\repo'), /重新检测/);
  await assert.rejects(killPortProcess(8080, { pid: '123' }), /重新检测/);
  await assert.rejects(killNodeProcess({ pid: '123', name: 'node.exe' }), /重新检测/);
  await assert.rejects(killNodeProcess({ pid: '123', name: 'powershell.exe', createdAt: '639000000000000000' }), /重新检测/);
  await assert.rejects(killPortProcess(8080, { pid: '4', name: 'System', createdAt: '639000000000000000' }), /无法操作此进程 ID/);
  assert.equal(calls, 0);
});

test('PowerShell rejects a reused Node.js PID before reaching the termination step', { skip: process.platform !== 'win32' }, async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  let script = '';
  globalThis.window = { nodeAPI: { execFile: async (_file, args) => { script = args[3]; } } };
  await killNodeProcess({ pid: '123', name: 'node.exe', createdAt: '639000000000000000' });
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

test('process detection reports timeout and unsupported platforms instead of an empty list', async (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { nodeAPI: {
    os: { platform: () => 'win32' },
    execFile: async () => { throw Object.assign(new Error('Command failed'), { code: null }); },
  } };
  await assert.rejects(detectPort(8080), /超时或中断/);
  globalThis.window.nodeAPI.os.platform = () => 'linux';
  await assert.rejects(listNodeProcesses(), /仅支持 Windows/);
});

test('classifyProcess treats ordinary processes as user level', () => {
  assert.equal(classifyProcess('node.exe', 8080).level, 'user');
  assert.equal(classifyProcess('', 1234).level, 'user');
});
