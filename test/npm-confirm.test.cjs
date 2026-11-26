const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, '../public/preload/npm-confirm.js'), 'utf8');
const credentials = require('../public/preload/credentials.js');
const details = { name: '@example/test', prefix: "C:\\项目\\O'Brien", registry: 'https://registry.example/' };

function loadConfirmation(platform, { env = {}, zenityInstalled = false } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, Buffer, process: { platform, env },
    require: (name) => ({
      fs: { existsSync: () => zenityInstalled },
      './credentials.js': credentials,
    })[name],
  });
  return module.exports.confirmNpmInstall;
}

test('Windows uses a fixed, default-No dialog and treats supplied values as data', async () => {
  const confirmNpmInstall = loadConfirmation('win32');
  let script;
  const runPowerShell = async (args, timeout) => {
    assert.deepEqual(Array.from(args.slice(0, -1)), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand']);
    assert.equal(timeout, 60000);
    script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /MessageBoxDefaultButton\]::Button2/);
    assert.doesNotMatch(script, /O'Brien/);
    const data = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1];
    assert.ok(Buffer.from(data, 'base64').toString('utf8').includes(details.prefix));
    return 'yes\r\n';
  };
  assert.equal(await confirmNpmInstall(details, { runPowerShell }), true);
  assert.equal(await confirmNpmInstall(details, { runPowerShell: async () => 'no' }), false);
  assert.equal(await confirmNpmInstall(details, { runPowerShell: async () => 'yes\nno' }), false);

  if (process.platform === 'win32') {
    const parse = '$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseInput($env:NODE_MANAGER_TEST_SCRIPT, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }';
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], {
      env: { ...process.env, NODE_MANAGER_TEST_SCRIPT: script }, timeout: 10000,
    });
  }
});

test('macOS and Linux invoke the system dialog with separate prompt arguments', async () => {
  const confirmOnMac = loadConfirmation('darwin');
  assert.equal(await confirmOnMac(details, { runCommand: async ({ file, args }) => {
    assert.equal(file, '/usr/bin/osascript');
    assert.match(args[1], /default button "取消"/);
    assert.doesNotMatch(args[1], /O'Brien/);
    assert.ok(args[2].includes(details.prefix));
    return 'yes';
  } }), true);

  const confirmOnLinux = loadConfirmation('linux', { env: { DISPLAY: ':0' }, zenityInstalled: true });
  assert.equal(await confirmOnLinux(details, { runCommand: async ({ file, args }) => {
    assert.equal(file, '/usr/bin/zenity');
    assert.ok(args.includes('--no-markup'));
    assert.ok(args.includes('--default-cancel'));
    assert.ok(args.find((arg) => arg.startsWith('--text=')).includes(details.prefix));
    throw Object.assign(new Error('canceled'), { code: 1 });
  } }), false);
  await assert.rejects(loadConfirmation('linux')(details, {}), /没有图形界面/);
  await assert.rejects(loadConfirmation('linux', { env: { WAYLAND_DISPLAY: 'wayland-0' } })(details, {}), /缺少可用/);
});
