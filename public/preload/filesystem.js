const PROJECT_FILES = new Set(['.nvmrc', '.node-version']);
const PROJECT_FILE_LIMIT = 4 * 1024;
const DIRECTORY_SCAN_TIMEOUT = 10000;
const NVM_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ZIP_HEADERS = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])];

function filesystemError(code, message) {
  return Object.assign(new Error(message), { code });
}

function sameEntry(before, after) {
  return before.dev === after.dev && before.ino === after.ino;
}

function createFilesystem({ fs, path, homeDirectory, nvmSymlink, detectNvmContext, getWindowsDirectory, getNpmCommandOutput }) {
  const isWindows = path.sep === '\\';

  function normalizePath(value) {
    if (typeof value !== 'string' || value.length > 32767 || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value)
        || (isWindows && !/^[a-z]:[\\/][^:*?"<>|]*$/i.test(value))) {
      throw filesystemError('EINVAL', '需要有效的本地绝对路径');
    }
    return path.resolve(value);
  }

  function isWithin(root, target) {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  function assertScanRoot(directory, message = '磁盘占用统计不能扫描整个磁盘、用户主目录或 Windows 系统目录') {
    if (path.dirname(directory) === directory
        || (homeDirectory && isWithin(directory, homeDirectory))
        || (isWindows && isWithin(getWindowsDirectory(), directory))) {
      throw filesystemError('EACCES', message);
    }
  }

  async function readNpmPath(args) {
    try {
      return (await getNpmCommandOutput(args)).trim();
    } catch {
      return '';
    }
  }

  async function getNpmPrefix() {
    return await readNpmPath(['prefix', '-g']) || (isWindows
      ? path.join(homeDirectory, 'AppData', 'Roaming', 'npm')
      : '/usr/local');
  }

  const configPaths = new Map([
    ['npmrc-user', () => path.join(homeDirectory, '.npmrc')],
    ['npmrc-global', async () => await readNpmPath(['config', 'get', 'globalconfig'])
      || path.join(await getNpmPrefix(), 'etc', 'npmrc')],
    ['nvmrc', () => path.join(homeDirectory, '.nvmrc')],
    ['node-version', () => path.join(homeDirectory, '.node-version')],
    ['hosts', () => isWindows
      ? path.join(getWindowsDirectory(), 'System32', 'drivers', 'etc', 'hosts')
      : '/etc/hosts'],
    ['npm-global-dir', async () => path.join(await getNpmPrefix(), ...(isWindows ? [] : ['lib']), 'node_modules')],
    ['npm-cache-dir', async () => await readNpmPath(['config', 'get', 'cache']) || (isWindows
      ? path.join(homeDirectory, 'AppData', 'Local', 'npm-cache')
      : path.join(homeDirectory, '.npm'))],
    ['nvm-dir', () => {
      try {
        return detectNvmContext()?.installDir || '';
      } catch {
        return '';
      }
    }],
  ]);

  async function getConfigFileInfo(id) {
    const getPath = configPaths.get(id);
    if (!getPath) throw filesystemError('EINVAL', '不支持该配置文件或目录');
    const configured = await getPath();
    if (!configured) return { path: '', exists: false };

    try {
      const canonical = normalizePath(fs.realpathSync.native(normalizePath(configured)));
      const stats = fs.statSync(canonical);
      return { path: configured, exists: id.endsWith('-dir') ? stats.isDirectory() : stats.isFile() };
    } catch {
      return { path: configured, exists: false };
    }
  }

  function getNvmVersionTarget(version, expectedDirectory) {
    if (typeof version !== 'string' || !NVM_VERSION_PATTERN.test(version)) {
      throw filesystemError('EINVAL', '需要完整的 Node.js 版本号');
    }
    const context = detectNvmContext();
    const root = normalizePath(context?.root);
    const versionFolder = `v${version}`;
    const target = path.join(root, versionFolder);
    if (path.relative(target, normalizePath(expectedDirectory)) !== '') {
      throw filesystemError('ESTALE', 'NVM 版本目录已变更，请刷新后重试');
    }
    return { context, root, versionFolder };
  }

  function inspectNvmVersion(version, expectedDirectory) {
    const { root, versionFolder } = getNvmVersionTarget(version, expectedDirectory);
    let versionDirectory;
    try {
      const canonicalRoot = normalizePath(fs.realpathSync.native(root));
      versionDirectory = path.join(canonicalRoot, versionFolder);
      assertScanRoot(versionDirectory);
      if (!fs.lstatSync(versionDirectory).isDirectory()) return { exists: true, hasExecutable: false };
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, hasExecutable: false };
      throw error;
    }

    const hasExecutable = ['node.exe', 'node32.exe', 'node64.exe'].some((file) => {
      try {
        return fs.lstatSync(path.join(versionDirectory, file)).isFile();
      } catch {
        return false;
      }
    });
    return { exists: true, hasExecutable };
  }

  function assertInactiveNvmVersion(context, target) {
    for (const link of new Set([context.symlink, nvmSymlink].filter(Boolean))) {
      let active;
      try {
        active = normalizePath(fs.realpathSync.native(normalizePath(link)));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (isWithin(target, active)) {
        throw filesystemError('EBUSY', '该版本是 NVM 当前使用的版本，请先切换到其他版本');
      }
    }
  }

  function validateNvmDownload(file, original) {
    const invalidDownload = () => filesystemError('EACCES', 'node.zip 不是可确认的 NVM 下载残留，请手动检查版本目录');
    if (!original.isFile() || original.nlink !== 1) throw invalidDownload();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
    try {
      const status = fs.fstatSync(fd);
      if (!status.isFile() || status.nlink !== 1 || !sameEntry(original, status) || status.size !== original.size) {
        throw invalidDownload();
      }
      const header = Buffer.alloc(4);
      const length = fs.readSync(fd, header, 0, header.length, 0);
      if (status.size !== 0 && (length !== header.length || !ZIP_HEADERS.some((signature) => signature.equals(header)))) {
        throw invalidDownload();
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  function cleanIncompleteNvmVersion(version, expectedDirectory) {
    const { context, root, versionFolder } = getNvmVersionTarget(version, expectedDirectory);
    let canonicalRoot;
    let target;
    let original;
    try {
      const unsafeRoot = 'NVM root 指向磁盘根目录、用户主目录或 Windows 系统目录，请检查 NVM 配置';
      assertScanRoot(root, unsafeRoot);
      canonicalRoot = normalizePath(fs.realpathSync.native(root));
      assertScanRoot(canonicalRoot, unsafeRoot);
      target = path.join(canonicalRoot, versionFolder);
      original = fs.lstatSync(target);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }

    if (!original.isDirectory() || original.isSymbolicLink()) {
      throw filesystemError('EACCES', '仅可清理 NVM root 中的普通版本子目录，请手动检查版本目录');
    }
    assertInactiveNvmVersion(context, target);

    const entries = fs.readdirSync(target);
    if (entries.some((name) => name !== 'node.zip' && name !== 'node_modules')) {
      throw filesystemError('EACCES', '版本目录包含可执行文件或其他内容，请先核对后再手动处理');
    }
    const remaining = new Set(entries);
    const modules = path.join(target, 'node_modules');
    const modulesStatus = entries.includes('node_modules') ? fs.lstatSync(modules) : null;
    if (modulesStatus && (!modulesStatus.isDirectory() || modulesStatus.isSymbolicLink() || fs.readdirSync(modules).length)) {
      throw filesystemError('EACCES', '版本目录中的 node_modules 必须是普通空目录，请手动检查');
    }
    const archive = path.join(target, 'node.zip');
    const archiveStatus = entries.includes('node.zip') ? fs.lstatSync(archive) : null;
    if (archiveStatus) validateNvmDownload(archive, archiveStatus);

    const stale = () => filesystemError('ESTALE', '清理期间 NVM 版本目录发生变化，请刷新后检查剩余文件');
    function verifyTarget() {
      const current = getNvmVersionTarget(version, expectedDirectory);
      const currentRoot = normalizePath(fs.realpathSync.native(current.root));
      const currentTarget = fs.lstatSync(target);
      if (path.relative(canonicalRoot, currentRoot) !== ''
          || !currentTarget.isDirectory() || currentTarget.isSymbolicLink() || !sameEntry(original, currentTarget)) {
        throw stale();
      }
      assertInactiveNvmVersion(current.context, target);
      const currentEntries = fs.readdirSync(target);
      if (currentEntries.length !== remaining.size || currentEntries.some((name) => !remaining.has(name))) {
        throw stale();
      }
    }

    if (modulesStatus) {
      verifyTarget();
      const current = fs.lstatSync(modules);
      if (!current.isDirectory() || current.isSymbolicLink() || !sameEntry(modulesStatus, current)) throw stale();
      fs.rmdirSync(modules);
      remaining.delete('node_modules');
    }
    if (archiveStatus) {
      verifyTarget();
      const current = fs.lstatSync(archive);
      if (!sameEntry(archiveStatus, current) || current.size !== archiveStatus.size || current.mtimeMs !== archiveStatus.mtimeMs) {
        throw stale();
      }
      validateNvmDownload(archive, current);
      fs.unlinkSync(archive);
      remaining.delete('node.zip');
    }
    verifyTarget();
    fs.rmdirSync(target);
    return true;
  }

  function readSmallTextFileSync(directory, fileName) {
    if (!PROJECT_FILES.has(fileName)) throw filesystemError('EINVAL', '只支持读取项目版本声明文件');
    const realDirectory = normalizePath(fs.realpathSync.native(normalizePath(directory)));
    const file = path.join(realDirectory, fileName);
    const original = fs.lstatSync(file);
    const invalidFile = () => filesystemError('EINVAL', '版本声明必须是普通文件');
    if (!original.isFile() || original.nlink !== 1) throw invalidFile();

    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stats = fs.fstatSync(fd);
      if (!stats.isFile() || stats.nlink !== 1 || stats.ino !== original.ino || stats.dev !== original.dev) {
        throw invalidFile();
      }
      const tooLarge = () => filesystemError('EFBIG', `版本声明文件不能超过 ${PROJECT_FILE_LIMIT} 字节`);
      if (stats.size > PROJECT_FILE_LIMIT) throw tooLarge();

      const bytes = Buffer.alloc(PROJECT_FILE_LIMIT + 1);
      let used = 0;
      while (used < bytes.length) {
        const count = fs.readSync(fd, bytes, used, bytes.length - used, null);
        if (!count) break;
        used += count;
      }
      if (used > PROJECT_FILE_LIMIT) throw tooLarge();

      const contents = bytes.subarray(0, used);
      const text = contents.toString('utf8');
      if (text.includes('\0') || !Buffer.from(text, 'utf8').equals(contents)) {
        throw filesystemError('EILSEQ', '请将版本声明保存为 UTF-8 文本');
      }
      return text;
    } finally {
      fs.closeSync(fd);
    }
  }

  async function realPath(directory) {
    try {
      return normalizePath(await fs.promises.realpath(directory));
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }

  async function resolveNpmCacheDirectory(directory) {
    const configured = normalizePath(directory);
    assertScanRoot(configured);
    const canonical = await realPath(configured);
    if (!canonical) return '';
    assertScanRoot(canonical);
    if (!(await fs.promises.lstat(canonical)).isDirectory()) {
      throw filesystemError('EINVAL', 'npm 缓存路径必须指向目录');
    }
    return canonical;
  }

  async function scanDirectory(resolveDirectory) {
    let bytes = 0;
    let incomplete = false;
    let timedOut = false;
    let timer;

    async function scan() {
      const root = await resolveDirectory();
      const pending = root ? [root] : [];
      while (pending.length && !timedOut) {
        const current = pending.pop();
        let entries;
        try {
          const canonical = await realPath(current);
          if (!canonical || path.relative(current, canonical) !== '') {
            incomplete = true;
            continue;
          }
          entries = await fs.promises.readdir(current);
        } catch {
          incomplete = true;
          continue;
        }

        for (const name of entries) {
          if (timedOut) break;
          const entry = path.join(current, name);
          try {
            const stats = await fs.promises.lstat(entry);
            if (stats.isDirectory()) pending.push(entry);
            else if (stats.isFile()) bytes += stats.size;
            else incomplete = true;
          } catch {
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

  async function getDirectorySize(directory) {
    const requested = normalizePath(directory);
    assertScanRoot(requested);
    const context = detectNvmContext();
    const roots = [context?.root, context?.symlink, nvmSymlink].filter(Boolean);
    return scanDirectory(async () => {
      for (const configuredRoot of roots) {
        const root = normalizePath(configuredRoot);
        if (!isWithin(root, requested)) continue;
        assertScanRoot(root);
        const canonicalRoot = await realPath(root);
        if (!canonicalRoot) return '';
        assertScanRoot(canonicalRoot);
        const canonicalTarget = await realPath(requested);
        if (!canonicalTarget || isWithin(canonicalRoot, canonicalTarget)) return canonicalTarget;
      }
      throw filesystemError('EACCES', '统计路径必须位于 NVM 版本目录或 Node.js 链接目录内');
    });
  }

  async function getNpmDirectorySize(kind) {
    if (kind !== 'cache' && kind !== 'global') {
      throw filesystemError('EINVAL', '只支持统计 npm 缓存或全局包目录');
    }
    const args = kind === 'cache' ? ['config', 'get', 'cache'] : ['prefix', '-g'];
    const configuredPath = (await getNpmCommandOutput(args)).trim();
    const globalParts = isWindows ? ['node_modules'] : ['lib', 'node_modules'];

    let directory = '';
    const size = await scanDirectory(async () => {
      if (kind === 'cache') {
        const canonicalCache = await resolveNpmCacheDirectory(configuredPath);
        directory = configuredPath;
        return canonicalCache;
      }
      const configured = normalizePath(configuredPath);
      const candidate = path.join(configured, ...globalParts);
      assertScanRoot(candidate);
      const canonicalTarget = await realPath(candidate);
      if (canonicalTarget) {
        assertScanRoot(canonicalTarget);
        const canonicalPrefix = await realPath(configured);
        if (!canonicalPrefix || path.relative(path.join(canonicalPrefix, ...globalParts), canonicalTarget) !== '') {
          throw filesystemError('EACCES', 'npm 全局包目录必须位于全局安装路径内');
        }
      }
      directory = candidate;
      return canonicalTarget;
    });
    return { directory, ...size };
  }

  return {
    getConfigFileInfo,
    inspectNvmVersion,
    cleanIncompleteNvmVersion,
    readSmallTextFileSync,
    getDirectorySize,
    getNpmDirectorySize,
    resolveNpmCacheDirectory,
  };
}

module.exports = { createFilesystem };
