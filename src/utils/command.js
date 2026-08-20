/**
 * Execute a program without invoking a shell and return stdout
 * Uses nodeAPI from preload.js
 * @param {string} file
 * @param {string[]} args
 * @param {object} options
 * @returns {Promise<string>}
 */
export function execFileCommand(file, args = [], options = {}) {
  return window.nodeAPI.execFile(file, args, options);
}

/**
 * Execute command and return {success, output, error}
 * @param {string} file
 * @param {string[]} args
 * @returns {Promise<{success: boolean, output: string, error: string|null}>}
 */
export async function safeExecFile(file, args = []) {
  try {
    const output = await execFileCommand(file, args);
    return { success: true, output, error: null };
  } catch (err) {
    return { success: false, output: '', error: err.message };
  }
}

/**
 * Execute command with real-time progress callbacks
 * @param {string} file
 * @param {string[]} args
 * @param {object} options - { onData: (text) => void }
 * @returns {{ kill: Function, promise: Promise<string> }}
 */
export function execFileCommandWithProgress(file, args = [], options = {}) {
  return window.nodeAPI.execFileWithProgress(file, args, options);
}

export function getNpmExecutable() {
  return window.nodeAPI.os.platform() === 'win32' ? 'npm.cmd' : 'npm';
}
