/** Logger.js - V23 */
export function createLogger(scope, { debug = false } = {}) {
  const prefix = `[${scope}]`;
  return {
    setDebug(value) { debug = value === true; },
    info(...args) { console.info(prefix, ...args); },
    warn(...args) { console.warn(prefix, ...args); },
    error(...args) { console.error(prefix, ...args); },
    debug(...args) { if (debug) console.debug(prefix, ...args); },
  };
}
