/**
 * Open file or directory in system explorer
 * @param {string} path
 * @returns {boolean}
 */
export function openPath(path) {
  try {
    window.utools.shellOpenPath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open URL in default browser
 * @param {string} url
 * @returns {boolean}
 */
export function openExternal(url) {
  try {
    window.utools.shellOpenExternal(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy text to clipboard
 * @param {string} text
 * @returns {boolean}
 */
export function copyToClipboard(text) {
  try {
    return window.utools.copyText(text);
  } catch {
    return false;
  }
}

/**
 * Show notification
 * @param {string} body
 * @param {string} [clickFeatureCode]
 */
export function showNotification(body, clickFeatureCode) {
  utools.showNotification(body, clickFeatureCode);
}

/**
 * Hide plugin window
 */
export function hidePlugin() {
  utools.hidePlugin();
}

/**
 * Set plugin feature
 * @param {object} feature
 */
export function setFeature(feature) {
  utools.setFeature(feature);
}

/**
 * Get current display
 * @returns {object}
 */
export function getDisplay() {
  return utools.getDisplay();
}

/**
 * Show toast message (custom implementation)
 * @param {string} message
 * @param {'default'|'success'|'error'|'warning'} type
 * @param {number} duration
 */
export function showToast(message, type = 'default', duration = 2000) {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Add icon based on type
  const iconSvg = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    default: '',
  };

  if (iconSvg[type]) {
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = iconSvg[type];
    toast.appendChild(icon);
  }

  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Show success toast
 * @param {string} message
 */
export function showSuccess(message) {
  showToast(message, 'success');
}

/**
 * Show error toast
 * @param {string} message
 */
export function showError(message) {
  showToast(message, 'error');
}

/**
 * Show warning toast
 * @param {string} message
 */
export function showWarning(message) {
  showToast(message, 'warning');
}
