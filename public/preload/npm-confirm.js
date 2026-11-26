const fs = require('fs');
const { redactCredentials } = require('./credentials.js');

const TITLE = 'Node 版本管理';
const TIMEOUT = 60000;
const APPLE_SCRIPT = [
  'on run argv',
  '  try',
  `    set answer to display dialog (item 1 of argv) with title "${TITLE}" buttons {"取消", "安装"} default button "取消" cancel button "取消" with icon caution giving up after 60`,
  '    if gave up of answer then return "no"',
  '    if button returned of answer is "安装" then return "yes"',
  '  on error number -128',
  '    return "no"',
  '  end try',
  '  return "no"',
  'end run',
].join('\n');

function formatPrompt({ name, prefix, registry }) {
  for (const value of [name, prefix, registry]) {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)) {
      throw new Error('无法在系统窗口中安全显示 npm 安装信息，请在终端确认后安装');
    }
  }
  const prompt = [
    `安装或更新全局包 ${name}？`,
    '',
    `安装目录：${prefix}`,
    `下载源：${redactCredentials(registry)}`,
    '',
    'npm 会下载软件包及其依赖。部分 Git 依赖仍可能运行准备脚本。请确认你信任软件包和下载源。',
  ].join('\n');
  if (Buffer.byteLength(prompt) > 7000) {
    throw new Error('npm 安装信息过长，请在终端确认后安装');
  }
  return prompt;
}

function windowsConfirmationArgs(prompt) {
  const data = Buffer.from(prompt, 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    `$prompt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${data}'))`,
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    'try {',
    '  $answer = [System.Windows.Forms.MessageBox]::Show(',
    '    $owner,',
    '    $prompt,',
    `    '${TITLE}',`,
    '    [System.Windows.Forms.MessageBoxButtons]::YesNo,',
    '    [System.Windows.Forms.MessageBoxIcon]::Warning,',
    '    [System.Windows.Forms.MessageBoxDefaultButton]::Button2',
    '  )',
    "  if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { 'yes' } else { 'no' }",
    '} finally {',
    '  $owner.Dispose()',
    '}',
  ].join('\n');
  return ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

async function confirmNpmInstall(details, { runPowerShell, runCommand }) {
  const prompt = formatPrompt(details);
  const platform = process.platform;
  if (platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('当前 Linux 会话没有图形界面，请在终端安装全局包');
  }
  const zenity = platform === 'linux' && ['/usr/bin/zenity', '/bin/zenity'].find((file) => fs.existsSync(file));
  if (platform !== 'win32' && platform !== 'darwin' && !zenity) {
    throw new Error('当前系统缺少可用的安装确认窗口，请在终端安装全局包');
  }

  try {
    if (platform === 'win32') {
      return (await runPowerShell(windowsConfirmationArgs(prompt), TIMEOUT)).trim() === 'yes';
    }
    if (platform === 'darwin') {
      const args = ['-e', APPLE_SCRIPT, prompt];
      return (await runCommand({ file: '/usr/bin/osascript', args }, { timeout: TIMEOUT })).trim() === 'yes';
    }
    await runCommand({
      file: zenity,
      args: ['--question', `--title=${TITLE}`, `--text=${prompt}`, '--no-markup', '--default-cancel', '--ok-label=安装', '--cancel-label=取消', '--timeout=60'],
    }, { timeout: TIMEOUT });
    return true;
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || (zenity && [1, 5].includes(error?.code))) return false;
    throw new Error('无法打开系统安装确认窗口，请在终端安装全局包');
  }
}

module.exports = { confirmNpmInstall };
