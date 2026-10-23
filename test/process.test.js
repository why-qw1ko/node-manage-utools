import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { classifyProcess, formatBytes, detectPort, killPortProcess, findFolderOccupiers, killProcess } from '../src/utils/process.js';

test('formatBytes converts raw byte counts to readable strings', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
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
      execFile: async (_file, args) => {
        const script = args[3];
        scripts.push(script);
        if (script.includes('Get-NetTCPConnection') && script.includes('ConvertTo-Json')) {
          return JSON.stringify({ pid: '123', createdAt: '639000000000000000', name: 'node.exe' });
        }
        if (script.includes('Get-FolderMatchReasons') && script.includes('ConvertTo-Json')) {
          return JSON.stringify({ pid: '123', createdAt: '639000000000000000', name: 'node.exe', reason: '命令行引用该目录' });
        }
        return '';
      },
    },
  };

  const [portProcess] = await detectPort(8080);
  await killPortProcess(8080, portProcess);
  const [folderProcess] = await findFolderOccupiers('C:\\repo');
  await killProcess(folderProcess, 'C:\\repo');

  assert.equal(portProcess.createdAt, '639000000000000000');
  assert.equal(folderProcess.createdAt, portProcess.createdAt);
  assert.match(scripts[1], /Get-CimInstance Win32_Process/);
  assert.match(scripts[1], /Get-NetTCPConnection -State Listen -LocalPort \$port/);
  assert.match(scripts[1], /\[math\]::Abs\(\$targetProcess\.StartTime\.ToUniversalTime\(\)\.Ticks - \[long\]\$createdAt\) -gt 10000/);
  assert.match(scripts[1], /\$targetProcess\.Kill\(\)/);
  assert.match(scripts[3], /Get-FolderMatchReasons \$full/);
  assert.match(scripts[3], /\$createdAt = '639000000000000000'/);
  assert.match(scripts[3], /\$targetProcess\.Kill\(\)/);
  assert.doesNotMatch(scripts[3], /Stop-Process -Id/);

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
  const rules = script.slice(0, script.indexOf('$folder ='));
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
  assert.equal(calls, 0);
});

test('classifyProcess treats ordinary processes as user level', () => {
  assert.equal(classifyProcess('node.exe', 8080).level, 'user');
  assert.equal(classifyProcess('', 1234).level, 'user');
});
