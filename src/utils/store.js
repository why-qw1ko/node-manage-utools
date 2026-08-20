// utools.db persistence wrapper
const STORE_PREFIX = 'node-manager:';

/**
 * Get value from utools.db
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function getStore(key, defaultValue = null) {
  try {
    const doc = window.utools?.db?.get(STORE_PREFIX + key);
    return doc ? doc.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Set value to utools.db
 * @param {string} key
 * @param {*} value
 */
export function setStore(key, value) {
  try {
    if (!window.utools?.db) return false;
    const id = STORE_PREFIX + key;
    const existing = window.utools.db.get(id);
    const doc = {
      _id: id,
      value,
      ...(existing?._rev ? { _rev: existing._rev } : {}),
    };
    const result = window.utools.db.put(doc);
    return result?.ok !== false;
  } catch (err) {
    console.error('Failed to save store:', err);
    return false;
  }
}

/**
 * Remove value from utools.db
 * @param {string} key
 */
export function removeStore(key) {
  try {
    if (!window.utools?.db) return false;
    const id = STORE_PREFIX + key;
    const doc = window.utools.db.get(id);
    if (doc) {
      window.utools.db.remove(id);
    }
    return true;
  } catch (err) {
    console.error('Failed to remove store:', err);
    return false;
  }
}

/**
 * Get custom mirrors from store
 * @returns {Array}
 */
export function getCustomMirrors() {
  return getStore('customMirrors', []);
}

/**
 * Save custom mirrors to store
 * @param {Array} mirrors
 */
export function setCustomMirrors(mirrors) {
  return setStore('customMirrors', mirrors);
}

export function removeLegacyRegistryCache() {
  return removeStore('currentRegistry');
}
