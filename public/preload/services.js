const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readSettingsFile, updateMirrorSetting } = require('./nvm-settings.js');

const MAX_BUFFER = 10 * 1024 * 1024;
const ALLOWED_ENV_KEYS = [
  'NODE_ENV',
  'NODE_PATH',
  'NVM_HOME',
  'NVM_SYMLINK',
  'PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_OPTIONS',
  'WINDIR',
];

function normalizeArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
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
  const cwd = typeof options.cwd === 'string' && options.cwd ? options.cwd : command.cwd;
  if (cwd) normalized.cwd = cwd;
  if (command.env) normalized.env = command.env;
  if (Number.isFinite(options.timeout) && options.timeout > 0) normalized.timeout = options.timeout;
  return normalized;
}

function cleanDirectory(value) {
  return String(value || '').trim().replace(/^"(.*)"$/, '$1');
}

function findExecutable(name, preferredDirectory = '') {
  const searchDirs = [
    cleanDirectory(preferredDirectory),
    ...String(process.env.PATH || '').split(path.delimiter).map(cleanDirectory),
  ].filter(Boolean);

  for (const directory of new Set(searchDirs)) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function detectNvmContext() {
  if (process.platform !== 'win32') return null;

  const executable = findExecutable('nvm.exe', process.env.NVM_HOME);
  if (!executable) return null;

  const installDir = path.dirname(executable);
  const settingsPath = path.join(installDir, 'settings.txt');
  const settings = readSettingsFile(settingsPath);
  const configuredRoot = cleanDirectory(settings.root);
  const root = configuredRoot && configuredRoot !== '.'
    ? path.resolve(installDir, configuredRoot)
    : installDir;
  const configuredSymlink = cleanDirectory(process.env.NVM_SYMLINK || settings.path);
  const fallbackSymlink = path.join(installDir, 'nodejs');
  const symlink = configuredSymlink || (fs.existsSync(fallbackSymlink) ? fallbackSymlink : '');

  return {
    executable,
    installDir,
    root,
    symlink,
    settings,
    settingsPath,
  };
}

const NVM_CONTEXT = detectNvmContext();
const ALLOWED_NVM_COMMANDS = new Set([
  'current',
  'install',
  'list',
  'uninstall',
  'use',
  'version',
]);

function assertSafeNvmCommand(args) {
  const command = String(args[0] || '').toLowerCase();
  if (!ALLOWED_NVM_COMMANDS.has(command)) {
    throw new Error(`不允许执行 NVM 配置命令: ${command || '空命令'}`);
  }

  if (['install', 'uninstall', 'use'].includes(command)) {
    const root = NVM_CONTEXT?.root;
    if (!root || !path.isAbsolute(root) || path.parse(root).root === root) {
      throw new Error('NVM root 安全检查失败，已阻止修改操作');
    }
  }
}

function resolveProgram(file, args) {
  const normalizedFile = file.toLowerCase();
  if (process.platform === 'win32' && ['nvm', 'nvm.exe'].includes(normalizedFile) && NVM_CONTEXT) {
    assertSafeNvmCommand(args);
    return {
      file: NVM_CONTEXT.executable,
      args,
      cwd: NVM_CONTEXT.installDir,
      env: {
        ...process.env,
        NVM_HOME: NVM_CONTEXT.installDir,
        ...(NVM_CONTEXT.symlink ? { NVM_SYMLINK: NVM_CONTEXT.symlink } : {}),
      },
    };
  }

  if (process.platform !== 'win32' || normalizedFile !== 'npm.cmd') {
    return { file, args };
  }

  const searchDirs = [
    process.env.NVM_SYMLINK,
    ...String(process.env.PATH || '').split(path.delimiter),
  ].filter(Boolean);

  for (const directory of new Set(searchDirs)) {
    const npmCli = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const nodeExe = path.join(directory, 'node.exe');
    if (fs.existsSync(npmCli) && fs.existsSync(nodeExe)) {
      return { file: nodeExe, args: [npmCli, ...args] };
    }
  }

  throw new Error('无法定位 npm CLI，请检查 PATH 或 NVM_SYMLINK');
}

async function getDirectorySize(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath) return 0;

  let total = 0;
  const pending = [rootPath];

  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    const fileSizes = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        return 0;
      }
      if (!entry.isFile()) return 0;
      try {
        return (await fs.promises.stat(fullPath)).size;
      } catch {
        return 0;
      }
    }));
    total += fileSizes.reduce((sum, size) => sum + size, 0);
  }

  return total;
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

    execFile(command.file, command.args, normalizeOptions(options, command), (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
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
    const proc = spawn(command.file, command.args, {
      shell: false,
      windowsHide: true,
      ...(command.cwd ? { cwd: command.cwd } : {}),
      ...(command.env ? { env: command.env } : {}),
      ...(typeof options.cwd === 'string' && options.cwd ? { cwd: options.cwd } : {}),
    });
    return {
      kill: () => proc.kill(),
      promise: new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          options.onData?.(text);
        });
        proc.stderr.on('data', (data) => {
          const text = data.toString();
          stderr += text;
          options.onData?.(text);
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(stderr || `Process exited with code ${code}`));
          }
        });
        proc.on('error', (err) => {
          reject(err);
        });
      }),
    };
  },

  // File system
  fs: {
    existsSync: (p) => fs.existsSync(p),
    readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
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
  env: Object.fromEntries(ALLOWED_ENV_KEYS.map((key) => [
    key,
    process.env[key]
      || (key === 'NVM_HOME' ? NVM_CONTEXT?.root : '')
      || (key === 'NVM_SYMLINK' ? NVM_CONTEXT?.symlink : '')
      || (key === 'WINDIR' ? 'C:\\Windows' : ''),
  ])),

  nvm: {
    getSettings: () => (
      NVM_CONTEXT ? readSettingsFile(NVM_CONTEXT.settingsPath) : {}
    ),
    setMirror: (key, url) => {
      if (!NVM_CONTEXT) throw new Error('未检测到 nvm-windows');
      return updateMirrorSetting(NVM_CONTEXT.settingsPath, key, url);
    },
  },
};
