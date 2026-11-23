const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeMirrorUrl, readSettingsFile, updateMirrorSetting, updateMirrorSettings } = require('./nvm-settings.js');

const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_PROGRESS_TEXT = 64 * 1024;
const PROGRESS_TIMEOUT = 15 * 60 * 1000;
const DIRECTORY_SCAN_TIMEOUT = 10000;
const NODE_VERSION_PATTERN = /^(?:latest|lts|v?\d+(?:\.\d+){0,2})$/i;
const COMPLETE_NODE_VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/i;
const PACKAGE_SPEC_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9._-]+)?$/i;
const ALLOWED_ENV_KEYS = [
  'NODE_ENV',
  'NODE_PATH',
  'PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_OPTIONS',
  'WINDIR',
];

function normalizeArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('Command arguments must be an array of strings');
  }
  return args;
}

function normalizeOptions(options = {}, command = {}) {
  const normalized = {
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  };
  const cwd = command.cwd || (typeof options.cwd === 'string' ? options.cwd : '');
  if (cwd) normalized.cwd = cwd;
  if (command.env) normalized.env = command.env;
  if (Number.isFinite(options.timeout) && options.timeout > 0) normalized.timeout = options.timeout;
  return normalized;
}

function cleanDirectory(value) {
  return String(value || '').trim().replace(/^"(.*)"$/, '$1');
}

function getPathDirectories() {
  return String(process.env.PATH || '').split(path.delimiter).map(cleanDirectory).filter(Boolean);
}

function getWindowsDirectory() {
  return process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
}

function findExecutable(name, directories) {
  let searchError;
  for (const directory of new Set(directories)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') searchError ??= error;
    }
  }
  if (searchError) throw searchError;
  return '';
}

function detectNvmContext() {
  if (process.platform !== 'win32') return null;

  const appData = path.join(os.homedir(), 'AppData');
  const roaming = cleanDirectory(process.env.APPDATA) || path.join(appData, 'Roaming');
  const local = cleanDirectory(process.env.LOCALAPPDATA) || path.join(appData, 'Local');
  const executable = findExecutable('nvm.exe', [
    cleanDirectory(process.env.NVM_HOME),
    ...getPathDirectories(),
    path.join(roaming, 'nvm'),
    path.join(local, 'nvm'),
  ]);
  if (!executable) return null;

  const installDir = path.dirname(executable);
  const settingsPath = path.join(installDir, 'settings.txt');
  const settings = readSettingsFile(settingsPath);
  const root = path.resolve(installDir, cleanDirectory(settings.root) || '.');
  const configuredSymlink = cleanDirectory(settings.path) || cleanDirectory(process.env.NVM_SYMLINK);
  const fallbackSymlink = path.join(installDir, 'nodejs');
  const symlink = configuredSymlink
    ? path.resolve(installDir, configuredSymlink)
    : (fs.existsSync(fallbackSymlink) ? fallbackSymlink : '');

  return {
    executable,
    installDir,
    root,
    symlink,
    settings,
    settingsPath,
  };
}

function requireNvmContext() {
  const context = detectNvmContext();
  if (!context) {
    throw executableNotFound('未检测到 nvm-windows');
  }
  return context;
}

function executableNotFound(message) {
  return Object.assign(new Error(message), { code: 'ENOENT' });
}

function getNvmPath(key) {
  try {
    return detectNvmContext()?.[key] || '';
  } catch {
    return '';
  }
}

function getNodeSearchDirectories() {
  return [
    ...getPathDirectories(),
    cleanDirectory(process.env.NVM_SYMLINK),
    getNvmPath('symlink'),
  ];
}

function assertSafeNvmCommand(args, context) {
  const [command, value] = args;
  if (['current', 'list', 'version'].includes(command)) {
    if (args.length === 1 || (command === 'list' && args.length === 2 && value === 'available')) return;
    throw new Error('NVM 查询参数无效');
  }
  if (!['install', 'uninstall', 'use'].includes(command)) {
    throw new Error('不允许执行 NVM 配置命令');
  }
  if (args.length !== 2 || !NODE_VERSION_PATTERN.test(value)) throw new Error('NVM 版本参数无效');
  if (command === 'uninstall' && !COMPLETE_NODE_VERSION_PATTERN.test(value)) {
    throw new Error('卸载需要完整 Node.js 版本号');
  }

  const rootError = 'NVM root 安全检查失败，请在 settings.txt 中检查版本目录。';
  if (!cleanDirectory(context.settings.root) || isUnsafeNvmPath(context.root)) {
    throw new Error(rootError);
  }
  try {
    const realRoot = fs.realpathSync(context.root);
    if (isUnsafeNvmPath(realRoot) || !fs.statSync(realRoot).isDirectory()) {
      throw new Error(rootError);
    }
  } catch {
    throw new Error(rootError);
  }

  if (command === 'use') assertSafeNvmSymlink(context.symlink);
  if (command === 'uninstall') {
    const target = fs.lstatSync(path.join(context.root, `v${value.replace(/^v/i, '')}`));
    if (!target.isDirectory() || target.isSymbolicLink()) {
      throw new Error('卸载目标必须是 NVM 版本目录中的普通子目录。');
    }
  }
}

function isUnsafeNvmPath(value) {
  if (path.parse(value).root === value) return true;
  const fromWindows = path.relative(getWindowsDirectory(), value);
  return fromWindows !== '..' && !fromWindows.startsWith(`..${path.sep}`) && !path.isAbsolute(fromWindows);
}

function assertSafeNvmSymlink(symlink) {
  if (!symlink || isUnsafeNvmPath(symlink)) {
    throw new Error('NVM 链接路径无效，请检查 NVM_SYMLINK 或 settings.txt 中的 path。');
  }
  let link;
  try {
    link = fs.lstatSync(symlink);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (link && !link.isSymbolicLink()) {
    throw new Error('NVM 链接位置已有普通文件或目录。请检查独立安装的 Node.js 是否占用了路径。');
  }
}

const NPM_COMMANDS = new Set([
  '-v', 'cache\0clean\0--force', 'config\0list', 'config\0list\0--long', 'config\0get\0cache', 'config\0get\0globalconfig',
  'config\0get\0registry', 'list\0-g\0--depth=0\0--json', 'prefix\0-g',
]);

function getSafeNpmArgs(args) {
  // NUL distinguishes argument boundaries after normalizeArgs has rejected embedded NUL.
  if (NPM_COMMANDS.has(args.join('\0'))) return args;
  const [command, flag, value, registry] = args;
  if (['install', 'uninstall'].includes(command) && flag === '-g' && args.length === 3
      && value.length <= 214 && PACKAGE_SPEC_PATTERN.test(value)) return args;
  if (command === 'config' && flag === 'set' && value === 'registry' && args.length === 4) {
    return [command, flag, value, normalizeMirrorUrl(registry)];
  }
  throw new Error('不支持此 npm 命令或参数');
}

function resolveProgram(file, args) {
  const isWindows = process.platform === 'win32';
  const normalizedFile = file.toLowerCase();
  if (isWindows && ['nvm', 'nvm.exe'].includes(normalizedFile)) {
    const context = requireNvmContext();
    assertSafeNvmCommand(args, context);
    return {
      file: context.executable,
      args,
      cwd: context.installDir,
      env: {
        ...process.env,
        NVM_HOME: context.installDir,
        ...(context.symlink ? { NVM_SYMLINK: context.symlink } : {}),
      },
    };
  }

  if (normalizedFile === 'node' || (isWindows && normalizedFile === 'node.exe')) {
    if (args.length !== 1 || args[0] !== '-v') throw new Error('仅支持查询 Node.js 版本');
    if (!isWindows) return { file: 'node', args };
    const executable = findExecutable('node.exe', getNodeSearchDirectories());
    if (!executable) throw executableNotFound('未检测到 Node.js');
    return { file: executable, args };
  }

  if (isWindows && normalizedFile === 'powershell.exe') {
    if (args.length !== 4 || args[0] !== '-NoProfile' || args[1] !== '-NonInteractive' || args[2] !== '-Command' || !args[3]) {
      throw new Error('PowerShell 参数无效');
    }
    return { file: path.join(getWindowsDirectory(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args };
  }

  if (normalizedFile !== 'npm' && !(isWindows && normalizedFile === 'npm.cmd')) {
    throw new Error('插件不支持运行此程序');
  }
  const npmArgs = getSafeNpmArgs(args);
  if (!isWindows) return { file: 'npm', args: npmArgs };

  for (const directory of new Set(getNodeSearchDirectories())) {
    if (!path.isAbsolute(directory)) continue;
    const npmCli = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const nodeExe = path.join(directory, 'node.exe');
    if (fs.existsSync(npmCli) && fs.existsSync(nodeExe)) {
      return { file: nodeExe, args: [npmCli, ...npmArgs] };
    }
  }

  throw executableNotFound('未检测到 npm。请安装 Node.js 或启用已安装的 Node.js 版本，然后刷新。');
}

async function getDirectorySize(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath) return { bytes: 0, incomplete: true };

  let bytes = 0;
  let incomplete = false;
  let timedOut = false;
  let timer;

  async function scan() {
    const pending = [rootPath];
    while (pending.length > 0 && !timedOut) {
      const current = pending.pop();
      let entries;
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch (error) {
        if (current !== rootPath || error.code !== 'ENOENT') incomplete = true;
        continue;
      }

      for (const entry of entries) {
        if (timedOut) break;
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(entryPath);
        } else if (entry.isFile()) {
          try {
            bytes += (await fs.promises.lstat(entryPath)).size;
          } catch {
            incomplete = true;
          }
        } else if (entry.isSymbolicLink()) {
          incomplete = true;
        }
      }
    }
    return { bytes, incomplete };
  }

  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ bytes, incomplete: true });
    }, DIRECTORY_SCAN_TIMEOUT);
  });
  try {
    return await Promise.race([scan(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function readSmallTextFileSync(filePath, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024) {
    throw new RangeError('文件读取上限无效');
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stats = fs.fstatSync(fd);
    if (!stats.isFile()) throw Object.assign(new Error('版本声明必须是普通文件'), { code: 'EINVAL' });
    const tooLarge = () => Object.assign(new Error(`版本声明文件不能超过 ${maxBytes} 字节`), { code: 'EFBIG' });
    if (stats.size > maxBytes) throw tooLarge();

    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = fs.readSync(fd, bytes, used, bytes.length - used, null);
      if (read === 0) break;
      used += read;
    }
    if (used > maxBytes) throw tooLarge();

    const contents = bytes.subarray(0, used);
    const text = contents.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(contents)) {
      throw Object.assign(new Error('请将版本声明保存为 UTF-8 文本'), { code: 'EILSEQ' });
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

// Expose Node.js APIs to renderer
window.nodeAPI = {
  // Execute a program without invoking a shell.
  execFile: (file, args = [], options = {}) => new Promise((resolve, reject) => {
    if (typeof file !== 'string' || !file) {
      reject(new TypeError('Command must be a non-empty string'));
      return;
    }

    let command;
    try {
      command = resolveProgram(file, normalizeArgs(args));
    } catch (error) {
      reject(error);
      return;
    }

    const opts = normalizeOptions(options, command);
    execFile(command.file, command.args, opts, (error, stdout, stderr) => {
      if (error) {
        const timedOut = Boolean(opts.timeout && error.killed && error.signal === 'SIGTERM');
        const message = timedOut ? '操作超时，请刷新状态后重试。' : stderr?.trim() || stdout?.trim() || error.message;
        const commandError = new Error(message);
        commandError.code = timedOut ? 'ETIMEDOUT' : error.code;
        reject(commandError);
      } else {
        resolve(stdout);
      }
    });
  }),

  // Execute command with real-time output
  execFileWithProgress: (file, args = [], options = {}) => {
    if (typeof file !== 'string' || !file) {
      throw new TypeError('Command must be a non-empty string');
    }

    const command = resolveProgram(file, normalizeArgs(args));
    const { cwd, env, timeout } = normalizeOptions(options, command);
    const proc = spawn(command.file, command.args, {
      shell: false,
      windowsHide: true,
      cwd,
      env,
    });
    return {
      kill: () => proc.kill(),
      promise: new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          const error = new Error('安装超时，可能有部分文件已写入。请先刷新已安装版本，再决定是否重试。');
          error.code = 'ETIMEDOUT';
          reject(error);
          proc.kill();
        }, Math.min(timeout || PROGRESS_TIMEOUT, PROGRESS_TIMEOUT));

        proc.stdout.setEncoding('utf8').on('data', (text) => {
          if (timedOut) return;
          stdout = (stdout + text).slice(-MAX_PROGRESS_TEXT);
          options.onData?.(text);
        });
        proc.stderr.setEncoding('utf8').on('data', (text) => {
          if (timedOut) return;
          stderr = (stderr + text).slice(-MAX_PROGRESS_TEXT);
          options.onData?.(text);
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(stderr.trim() || stdout.trim() || `Process exited with code ${code}`));
          }
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      }),
    };
  },

  // File system
  fs: {
    existsSync: (p) => fs.existsSync(p),
    readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
    readSmallTextFileSync,
    statSync: (p) => fs.statSync(p),
    readdirSync: (p) => fs.readdirSync(p),
    getDirectorySize,
  },

  // Path utilities
  path: {
    join: (...args) => path.join(...args),
    resolve: (...args) => path.resolve(...args),
    dirname: (p) => path.dirname(p),
    basename: (p) => path.basename(p),
    extname: (p) => path.extname(p),
  },

  // OS utilities
  os: {
    homedir: () => os.homedir(),
    platform: () => os.platform(),
    tmpdir: () => os.tmpdir(),
  },

  // Environment
  env: {
    ...Object.fromEntries(ALLOWED_ENV_KEYS.map((key) => [
      key,
      process.env[key] || (key === 'WINDIR' ? 'C:\\Windows' : ''),
    ])),
    get NVM_HOME() {
      return process.env.NVM_HOME || getNvmPath('installDir');
    },
    get NVM_SYMLINK() {
      return process.env.NVM_SYMLINK || getNvmPath('symlink');
    },
  },

  nvm: {
    getInstallDir: () => getNvmPath('installDir'),
    getRoot: () => getNvmPath('root'),
    getSettings: () => detectNvmContext()?.settings || {},
    setMirror: (key, url) => updateMirrorSetting(requireNvmContext().settingsPath, key, url),
    setMirrors: (mirrors) => updateMirrorSettings(requireNvmContext().settingsPath, mirrors),
  },
};
