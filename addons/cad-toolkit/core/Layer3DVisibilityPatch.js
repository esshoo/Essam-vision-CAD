/**
 * Layer3DVisibilityPatch.js
 * V21.6.2
 *
 * Fixes V21.6.1 behavior:
 * - No separate 3D checkbox.
 * - Heavy/plain drafting layers are still set to dropdown type "Hide" by default once.
 * - If the user changes the existing dropdown from Hide to Lines/Walls/Light/Glass/etc,
 *   that manual choice is respected and never auto-hidden again.
 * - The patch no longer re-applies Hide on every DOM change.
 */
import { LayerRulesStore } from "../CADLayerKit.js";

const VERSION = "V21.6.2";
const PROJECT_ID = "active";
const AUTO_HIDE_TYPES = new Set(["lines", "line", "default", "annotation", "text", "image"]);

const runtime = {
  installed: true,
  version: VERSION,
  debug: false,
  defaultsApplied: 0,
  controlsRemoved: 0,
  userUnlocks: 0,
  savesPatched: false,
  progressiveRuns: 0,
  progressiveActive: false,
  lastProgressive: null,
  observer: null,
  contextsApplied: new Set(),
};

function log(...args) { if (runtime.debug) console.log(`[Layer3DVisibilityPatch ${VERSION}]`, ...args); }
function loadRules() { return LayerRulesStore.load(PROJECT_ID) || {}; }
function saveRules(rules) { LayerRulesStore.save(PROJECT_ID, rules || {}); }
function normalizeType(rule) { return String(rule?.type || "lines").toLowerCase(); }
function isAutoHideCandidate(rule) { return AUTO_HIDE_TYPES.has(normalizeType(rule)); }
function getContextKey() {
  const f = window.cadApp?.uploader?.file || window.cadApp?.currentFile || null;
  const page = Number(window.cadApp?.currentPage || window.cadApp?.pdfPage || window.cadDrawingOverlay?.currentPage || 1) || 1;
  return `${f?.name || 'active-file'}|${f?.size || 0}|page-${page}`;
}
function clear3DExporterCache() {
  try { window.__essamCADSceneExporterV31?.clearCache?.(); } catch (_) {}
  try { window.__essamCADSceneExporterV30?.clearCache?.(); } catch (_) {}
  try { window.__essamCADSceneExporterV29?.clearCache?.(); } catch (_) {}
  try { window.CADSceneExporter?.clearCache?.(); } catch (_) {}
}
function dispatchChanged(layer = null) {
  try { window.dispatchEvent(new CustomEvent("cad:3d-layer-default-hide-updated", { detail: { layer, version: VERSION } })); } catch (_) {}
}

function removeLegacy3DCheckboxes() {
  let removed = 0;
  document.querySelectorAll('[data-essam-3d-visible]').forEach((el) => { el.remove(); removed += 1; });
  runtime.controlsRemoved += removed;
  return removed;
}

function cleanLegacyVisible3DFlags(rules) {
  let changed = 0;
  for (const rule of Object.values(rules || {})) {
    if (!rule || typeof rule !== "object") continue;
    if ("visible3D" in rule) { delete rule.visible3D; changed += 1; }
  }
  return changed;
}

function markManualChanges(rules) {
  let changed = 0;
  for (const rule of Object.values(rules || {})) {
    if (!rule || typeof rule !== "object") continue;
    // When a user changes a previously auto-hidden layer from Hide to any real type,
    // keep that type. Do not auto-hide it again on file-loaded/panel-rendered.
    if (rule.__auto3DHidden === true && normalizeType(rule) !== "hide") {
      rule.__auto3DHidden = false;
      rule.__auto3DUnlocked = true;
      rule.__auto3DUnlockedAt = new Date().toISOString();
      runtime.userUnlocks += 1;
      changed += 1;
    }
  }
  return changed;
}

function patchLayerRulesStoreSave() {
  if (runtime.savesPatched || !LayerRulesStore?.save) return;
  const originalSave = LayerRulesStore.save.bind(LayerRulesStore);
  LayerRulesStore.save = function patchedLayerRulesSave(projectId, rules) {
    try {
      const changed = markManualChanges(rules || {}) + cleanLegacyVisible3DFlags(rules || {});
      if (changed) {
        clear3DExporterCache();
        setTimeout(() => dispatchChanged(null), 0);
      }
    } catch (_) {}
    return originalSave(projectId, rules);
  };
  runtime.savesPatched = true;
}

function applyDefaultHide(reason = "manual", options = {}) {
  const rules = loadRules();
  const context = getContextKey();
  const once = options.once !== false;
  if (once && runtime.contextsApplied.has(context) && reason !== "manual") {
    removeLegacy3DCheckboxes();
    return { changed: 0, removed: 0, skipped: "context-already-applied", context, rules };
  }

  let changed = 0;
  changed += markManualChanges(rules);
  changed += cleanLegacyVisible3DFlags(rules);

  for (const [layer, rule] of Object.entries(rules)) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.__auto3DUnlocked === true || rule.__auto3DHidden === false) continue;
    if (rule.__auto3DHidden !== undefined) continue; // Apply default only once per layer unless reset.
    if (normalizeType(rule) === "hide") continue;
    if (!isAutoHideCandidate(rule)) continue;

    rule.__auto3DHidden = true;
    rule.__auto3DHiddenFrom = rule.type || "lines";
    rule.type = "hide";
    changed += 1;
    log("default-hidden layer", { layer, reason });
  }

  runtime.contextsApplied.add(context);
  const removed = removeLegacy3DCheckboxes();
  if (changed) {
    runtime.defaultsApplied += changed;
    saveRules(rules);
    clear3DExporterCache();
    dispatchChanged(null);
    log("default hide applied", { reason, changed, removed, context });
  }
  return { changed, removed, context, rules };
}

function resetAutoHideForLayer(layer) {
  const rules = loadRules();
  const rule = rules[layer];
  if (!rule) return { ok: false, reason: "layer-not-found", layer };
  rule.__auto3DHidden = false;
  rule.__auto3DUnlocked = true;
  rule.__auto3DUnlockedAt = new Date().toISOString();
  if (normalizeType(rule) === "hide") rule.type = rule.__auto3DHiddenFrom || "lines";
  delete rule.visible3D;
  saveRules(rules);
  clear3DExporterCache();
  dispatchChanged(layer);
  return { ok: true, layer, type: rule.type };
}

function resetAllAutoHide() {
  const rules = loadRules();
  let changed = 0;
  for (const rule of Object.values(rules)) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.__auto3DHidden === true && normalizeType(rule) === "hide") {
      rule.type = rule.__auto3DHiddenFrom || "lines";
      changed += 1;
    }
    rule.__auto3DHidden = false;
    rule.__auto3DUnlocked = true;
    rule.__auto3DUnlockedAt = new Date().toISOString();
    delete rule.visible3D;
  }
  saveRules(rules);
  clear3DExporterCache();
  dispatchChanged(null);
  removeLegacy3DCheckboxes();
  return { changed };
}

function lockDefaultHideAgain(layer = null) {
  const rules = loadRules();
  let changed = 0;
  for (const [name, rule] of Object.entries(rules)) {
    if (layer && name !== layer) continue;
    if (!rule || typeof rule !== "object") continue;
    delete rule.__auto3DUnlocked;
    delete rule.__auto3DUnlockedAt;
    delete rule.__auto3DHidden;
    if (isAutoHideCandidate(rule)) changed += 1;
  }
  saveRules(rules);
  runtime.contextsApplied.clear();
  const applied = applyDefaultHide("lock-again", { once: false });
  return { changed, applied };
}

function getDeviceProfile() {
  let profile = "desktop";
  try {
    const ua = navigator.userAgent || "";
    if (/Quest|Oculus|VR|XR/i.test(ua)) profile = "vr";
    else if (/Android|iPhone|iPad|Mobile/i.test(ua)) profile = "mobile";
    else if (navigator.xr) profile = "xr-capable";
  } catch (_) {}
  return profile;
}

async function enableLayers3DProgressively(layers, options = {}) {
  const list = Array.isArray(layers) ? layers.filter(Boolean) : [];
  const profile = getDeviceProfile();
  const batchSize = Number(options.batchSize || (profile === "desktop" ? 8 : 3));
  const delayMs = Number(options.delayMs || (profile === "desktop" ? 70 : 180));
  runtime.progressiveRuns += 1;
  runtime.progressiveActive = true;
  runtime.lastProgressive = { profile, total: list.length, done: 0, batchSize, delayMs, startedAt: new Date().toISOString() };

  for (let i = 0; i < list.length; i += batchSize) {
    const rules = loadRules();
    const batch = list.slice(i, i + batchSize);
    for (const layer of batch) {
      const rule = rules[layer];
      if (!rule) continue;
      if (normalizeType(rule) === "hide") rule.type = rule.__auto3DHiddenFrom || "lines";
      rule.__auto3DHidden = false;
      rule.__auto3DUnlocked = true;
      rule.__auto3DUnlockedAt = new Date().toISOString();
      delete rule.visible3D;
    }
    saveRules(rules);
    clear3DExporterCache();
    dispatchChanged(null);
    runtime.lastProgressive.done = Math.min(list.length, i + batch.length);
    if (typeof options.onBatch === "function") {
      try { options.onBatch({ batch, done: runtime.lastProgressive.done, total: list.length }); } catch (_) {}
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  runtime.progressiveActive = false;
  runtime.lastProgressive.finishedAt = new Date().toISOString();
  return { ok: true, ...runtime.lastProgressive };
}

function getSummary() {
  const rules = loadRules();
  let total = 0, autoHidden = 0, unlocked = 0, legacyVisible3D = 0, hideType = 0;
  for (const rule of Object.values(rules)) {
    total += 1;
    if (rule?.__auto3DHidden === true) autoHidden += 1;
    if (rule?.__auto3DUnlocked === true || rule?.__auto3DHidden === false) unlocked += 1;
    if (rule && "visible3D" in rule) legacyVisible3D += 1;
    if (normalizeType(rule) === "hide") hideType += 1;
  }
  return {
    installed: true,
    version: VERSION,
    debug: runtime.debug,
    totalRules: total,
    autoHidden,
    unlocked,
    hideType,
    legacyVisible3D,
    defaultsApplied: runtime.defaultsApplied,
    controlsRemoved: runtime.controlsRemoved,
    userUnlocks: runtime.userUnlocks,
    savesPatched: runtime.savesPatched,
    contextsApplied: runtime.contextsApplied.size,
    progressiveRuns: runtime.progressiveRuns,
    progressiveActive: runtime.progressiveActive,
    lastProgressive: runtime.lastProgressive,
    deviceProfile: getDeviceProfile(),
  };
}

function setDebug(value) { runtime.debug = value !== false; return getSummary(); }
function scheduleApply(reason) { clearTimeout(scheduleApply._t); scheduleApply._t = setTimeout(() => applyDefaultHide(reason), 180); }

function installObserver() {
  if (runtime.observer) return;
  runtime.observer = new MutationObserver(() => removeLegacy3DCheckboxes());
  runtime.observer.observe(document.body, { childList: true, subtree: true });
}

function install() {
  patchLayerRulesStoreSave();
  installObserver();
  applyDefaultHide("install", { once: true });
  window.addEventListener("cad:file-loaded", () => scheduleApply("file-loaded"));
  window.addEventListener("cad:layers-panel-rendered", () => removeLegacy3DCheckboxes());
  window.addEventListener("cad:language-changed", () => removeLegacy3DCheckboxes());

  window.__essam3DLayerVisibilityV21_6_2 = {
    getSummary,
    setDebug,
    applyDefaultHide,
    resetAutoHideForLayer,
    resetAllAutoHide,
    lockDefaultHideAgain,
    enableLayers3DProgressively,
    removeLegacy3DCheckboxes,
  };
  // Backward aliases so existing console commands still work.
  window.__essam3DLayerVisibilityV21_6_1 = window.__essam3DLayerVisibilityV21_6_2;
  window.__essam3DLayerVisibilityV21_6 = window.__essam3DLayerVisibilityV21_6_2;
  console.log(`[Layer3DVisibilityPatch ${VERSION}] Installed. Existing dropdown controls 3D. Manual changes are respected.`);
}

install();
