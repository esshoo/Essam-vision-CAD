/**
 * LayerVisibilityPerformancePatch.js
 * V21.3
 *
 * Fixes heavy 2D layer hide/show without changing the source data.
 *
 * Main idea:
 * - Layer panel visibility is a VIEW state, not an EntityRegistry edit.
 * - Do not let LayerRulesPanel.hide/show mutate thousands of entity.visible flags.
 * - Apply layer visibility to scene objects through a cached layer index.
 * - Avoid repeated scene.traverse for every click.
 * - Keep managed per-entity render only for real entity edits: deleted, individually hidden, or explicitly moved layers.
 */

const VERSION = "V21.3";
const state = {
  installed: false,
  debug: false,
  layerIndex: new Map(),
  layerIndexContext: "",
  layerIndexBuiltAt: 0,
  viewHiddenLayers: new Set(),
  patchedRegistries: new WeakSet(),
  counters: {
    registryPatch: 0,
    routedHideLayerCalls: 0,
    realHideLayerCalls: 0,
    layerIndexBuilds: 0,
    visibilityApplications: 0,
    visibilityObjectsTouched: 0,
    visibilityBatches: 0,
    cleanedLayerRuleFlags: 0,
  },
  lastApply: null,
  lastWarnings: [],
};

function log(...args) { if (state.debug) console.log(`[LayerVisibilityPerformance ${VERSION}]`, ...args); }
function warn(message, payload = null) {
  const item = { message, payload, at: new Date().toISOString() };
  state.lastWarnings.unshift(item);
  state.lastWarnings = state.lastWarnings.slice(0, 8);
  console.warn(`[LayerVisibilityPerformance ${VERSION}] ${message}`, payload || "");
}

function getFile() { return window.cadApp?.uploader?.file || window.cadApp?.currentFile || null; }
function getPage() {
  const candidates = [window.cadApp?.pdfPage, window.cadApp?.currentPage, window.cadApp?.currentPdfPage, window.cadDrawingOverlay?.currentPage, window.cadDrawingOverlay?.pageNumber];
  for (const v of candidates) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; }
  return 1;
}
function getContextKey() {
  const f = getFile();
  return `${f?.name || window.cadApp?.fileName || "active-file"}|${f?.size || 0}|page-${getPage()}`;
}
function getScene() { return window.cadApp?.viewer?.sceneManager?.scene || window.cadApp?.viewer?.scene || null; }
function getRegistry() { return window.__essamEntityRegistry || null; }
function normalizeLayerName(name) { return String(name || "0").trim() || "0"; }
function getObjLayer(obj) {
  const ud = obj?.userData || {};
  const n = ud.layer ?? ud.layerName ?? ud.dxfLayer ?? ud.name ?? obj?.name;
  return typeof n === "string" && n.trim() ? n.trim() : "0";
}
function isRenderableObject(obj) {
  return !!(obj && (obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh || obj.type === "Line" || obj.type === "LineSegments" || obj.type === "LineLoop" || obj.type === "Mesh"));
}

function buildLayerIndex(force = false) {
  const context = getContextKey();
  if (!force && state.layerIndexContext === context && state.layerIndex.size) return state.layerIndex;
  const scene = getScene();
  const index = new Map();
  if (!scene?.traverse) return index;

  scene.traverse((obj) => {
    if (!isRenderableObject(obj)) return;
    const layer = normalizeLayerName(getObjLayer(obj));
    if (!index.has(layer)) index.set(layer, []);
    index.get(layer).push(obj);
  });

  state.layerIndex = index;
  state.layerIndexContext = context;
  state.layerIndexBuiltAt = Date.now();
  state.counters.layerIndexBuilds += 1;
  log("layer index built", { context, layerCount: index.size, objectCount: Array.from(index.values()).reduce((a, b) => a + b.length, 0) });
  return index;
}

async function applyLayerVisibility(layerName, visible, options = {}) {
  const layer = normalizeLayerName(layerName);
  const show = visible !== false;
  if (show) state.viewHiddenLayers.delete(layer);
  else state.viewHiddenLayers.add(layer);

  const index = buildLayerIndex(false);
  let objects = index.get(layer);
  if (!objects) {
    buildLayerIndex(true);
    objects = state.layerIndex.get(layer) || [];
  }

  const chunkSize = Number(options.chunkSize || 4500);
  let touched = 0;
  for (let i = 0; i < objects.length; i += chunkSize) {
    const chunk = objects.slice(i, i + chunkSize);
    for (const obj of chunk) {
      if (!obj) continue;
      obj.visible = show;
      touched += 1;
    }
    state.counters.visibilityBatches += 1;
    if (objects.length > chunkSize) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  // Runtime annotations are not always in the CAD scene index.
  try {
    if (window.cadDrawingOverlay?.getLayerMeta?.(layer)) {
      window.cadDrawingOverlay.setLayerVisibility?.(layer, show, true);
    }
  } catch (err) {
    warn("annotation layer visibility failed", { layer, err });
  }

  window.cadApp?.viewer?.enableRender?.();
  state.counters.visibilityApplications += 1;
  state.counters.visibilityObjectsTouched += touched;
  state.lastApply = { layer, visible: show, touched, context: getContextKey(), at: new Date().toISOString(), reason: options.reason || "manual" };
  window.dispatchEvent(new CustomEvent("cad:layer-view-visibility-changed", { detail: state.lastApply }));
  return state.lastApply;
}

function isCallFromLayerRulesPanel() {
  try {
    const stack = new Error().stack || "";
    return /LayerRulesPanel\.js|applyViewerLayerVisibility|saveRules|onchange/.test(stack);
  } catch (_) { return false; }
}

function patchRegistry(registry = getRegistry()) {
  if (!registry || state.patchedRegistries.has(registry)) return false;
  if (typeof registry.hideLayer !== "function") return false;

  const originalHideLayer = registry.hideLayer.bind(registry);
  registry.__essamOriginalHideLayerV21_3 = registry.__essamOriginalHideLayerV21_3 || originalHideLayer;

  registry.hideLayer = function layerViewAwareHideLayer(layerName, hidden, ...args) {
    // LayerRulesPanel visibility is a view concern. Do not mutate entity.visible for thousands of entities.
    if (isCallFromLayerRulesPanel() || args?.[0]?.viewOnly === true) {
      state.counters.routedHideLayerCalls += 1;
      applyLayerVisibility(layerName, hidden !== true, { reason: "registry.hideLayer:viewOnly" });
      return { ok: true, viewOnly: true, layer: normalizeLayerName(layerName), hidden: hidden === true };
    }

    state.counters.realHideLayerCalls += 1;
    return originalHideLayer(layerName, hidden, ...args);
  };

  state.patchedRegistries.add(registry);
  state.counters.registryPatch += 1;
  return true;
}

function getLayerRules() {
  try { return JSON.parse(localStorage.getItem("cad-layer-rules:active") || "{}"); } catch (_) { return {}; }
}

function cleanLayerRuleVisibilityFlags() {
  // Repair state created by older versions where layer toggles changed entity.visible=false.
  const registry = getRegistry();
  const rules = getLayerRules();
  if (!registry?.getAll) return { ok: false, reason: "no-registry" };
  const hiddenLayers = new Set(Object.entries(rules).filter(([, r]) => r?.visible === false || r?.type === "hide").map(([name]) => normalizeLayerName(name)));
  let cleaned = 0;
  const all = registry.getAll({ includeDeleted: true }) || [];
  for (const entity of all) {
    if (!entity || entity.deleted === true) continue;
    const layer = normalizeLayerName(entity.layer || "0");
    // Only clean visibility false for layers that are controlled by layer rules.
    // Real individual hidden entities should be handled from Entity Editor, not Layer Panel.
    if (entity.visible === false && hiddenLayers.has(layer)) {
      entity.visible = true;
      cleaned += 1;
    }
  }
  state.counters.cleanedLayerRuleFlags += cleaned;
  if (cleaned) {
    window.__essamEntityRenderBridge?.rebuild?.();
    window.dispatchEvent(new CustomEvent("cad:entity-registry-updated", { detail: { reason: "layer-rule-visibility-cleanup", cleaned } }));
  }
  return { ok: true, cleaned, hiddenLayerCount: hiddenLayers.size };
}

function patchUiLayerCheckboxes() {
  if (window.__essamLayerVisibilityCheckboxPatchV21_3) return;
  window.__essamLayerVisibilityCheckboxPatchV21_3 = true;

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
    const panel = input.closest?.("#layer-rules-panel");
    if (!panel) return;

    const row = input.closest("div");
    const layerName = row?.querySelector?.("strong")?.textContent?.trim() || input.parentElement?.querySelector?.("strong")?.textContent?.trim();
    if (!layerName) return;

    // Do not stop the original handler. It still updates state.rules.
    // This patch only makes the heavy registry mutation route view-only and applies a cached scene visibility update.
    setTimeout(() => applyLayerVisibility(layerName, input.checked, { reason: "ui-checkbox" }), 0);
    setTimeout(() => cleanLayerRuleVisibilityFlags(), 80);
  }, true);
}

function getSummary() {
  const registry = getRegistry();
  return {
    installed: state.installed,
    version: VERSION,
    debug: state.debug,
    context: getContextKey(),
    layerIndex: {
      context: state.layerIndexContext,
      layerCount: state.layerIndex.size,
      objectCount: Array.from(state.layerIndex.values()).reduce((a, b) => a + b.length, 0),
      builtAt: state.layerIndexBuiltAt,
    },
    viewHiddenLayers: Array.from(state.viewHiddenLayers),
    registryStats: registry?.getStats?.() || null,
    counters: { ...state.counters },
    lastApply: state.lastApply,
    lastWarnings: [...state.lastWarnings],
  };
}

function setDebug(value = true) { state.debug = value === true; return getSummary(); }
function clearIndex() { state.layerIndex.clear(); state.layerIndexContext = ""; return getSummary(); }

function install() {
  if (state.installed) return getSummary();
  state.installed = true;

  patchRegistry();
  patchUiLayerCheckboxes();

  ["cad:entity-registry-ready", "cad:file-loaded", "cad:pdf-page-changed"].forEach((name) => {
    window.addEventListener(name, () => {
      patchRegistry();
      clearIndex();
      setTimeout(() => buildLayerIndex(false), name === "cad:pdf-page-changed" ? 800 : 250);
    });
  });

  window.__essamLayerVisibilityPerformanceV21_3 = {
    version: VERSION,
    getSummary,
    setDebug,
    clearIndex,
    buildLayerIndex,
    applyLayerVisibility,
    cleanLayerRuleVisibilityFlags,
    patchRegistry,
  };

  console.info(`[LayerVisibilityPerformance ${VERSION}] Installed 2D layer visibility stabilizer`);
  return getSummary();
}

install();
