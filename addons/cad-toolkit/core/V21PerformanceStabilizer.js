/**
 * V21PerformanceStabilizer.js
 *
 * Goal:
 * Keep the data we already have, but reduce continuous heaviness.
 * This module is intentionally non-destructive:
 * - It does NOT change EntityRegistry structure.
 * - It does NOT change CADLayerKit extraction logic.
 * - It does NOT change PDF/DXF parsing.
 * - It wraps heavy calls with caching/throttling and exposes transition APIs.
 *
 * Load after CADLayerKit and EmptyExtractionGuard, before UI modules when possible.
 */

const VERSION = "V21";
const DEFAULTS = {
  extractCacheTtlMs: 2500,
  emptyFallbackTtlMs: 15000,
  rebuildThrottleMs: 350,
  transitionChunkSize2d: 20000,
  transitionChunkSize3d: 8000,
  transitionChunkSizeVr: 3000,
  debug: false,
};

const state = {
  installed: false,
  debug: DEFAULTS.debug,
  currentMode: "2d",
  previousMode: null,
  isTransitioning: false,
  transitionStartedAt: 0,
  lastTransition: null,
  lastContext: "",
  extractCache: new Map(),
  lastGoodByContext: new Map(),
  patched: {
    cadLayerKit: false,
    renderBridge: false,
  },
  counters: {
    extractFromViewer: 0,
    extractFromScene: 0,
    extractCacheHits: 0,
    extractEmptyFallbackHits: 0,
    extractMisses: 0,
    renderRebuildCalls: 0,
    renderRebuildSkipped: 0,
    renderRebuildScheduled: 0,
    transitions: 0,
    cleanupCalls: 0,
    compiledViewData: 0,
  },
  timings: {
    lastExtractMs: 0,
    lastCompileMs: 0,
    lastCleanupMs: 0,
    lastTransitionMs: 0,
  },
  lastSnapshot: null,
  lastViewData: null,
  lastErrors: [],
};

function log(...args) { if (state.debug) console.log(`[PerformanceStabilizer ${VERSION}]`, ...args); }
function warn(...args) { console.warn(`[PerformanceStabilizer ${VERSION}]`, ...args); }
function now() { return performance?.now?.() || Date.now(); }

function rememberError(label, err) {
  const item = { label, message: err?.message || String(err), at: new Date().toISOString() };
  state.lastErrors.unshift(item);
  state.lastErrors = state.lastErrors.slice(0, 10);
  warn(label, err);
}

function getCurrentFile() {
  return window.cadApp?.uploader?.file || window.cadApp?.currentFile || window.cadApp?.file || null;
}

function getPdfPage() {
  const candidates = [
    window.cadApp?.pdfPage,
    window.cadApp?.currentPage,
    window.cadApp?.currentPdfPage,
    window.cadViewerCurrentPage,
    window.cadDrawingOverlay?.currentPage,
    window.cadDrawingOverlay?.pageNumber,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

function getContextKey() {
  const f = getCurrentFile();
  const name = f?.name || window.cadApp?.fileName || "active-file";
  const size = f?.size || 0;
  const page = getPdfPage();
  return `${name}|${size}|page-${page}`;
}

function hasUsefulRawData(raw) {
  const layers = Array.isArray(raw?.layers) ? raw.layers.length : 0;
  const entities = Array.isArray(raw?.entities) ? raw.entities.length : 0;
  return layers > 0 || entities > 0;
}

function cloneRawData(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return {
    ...raw,
    layers: Array.isArray(raw.layers) ? [...raw.layers] : raw.layers,
    entities: Array.isArray(raw.entities) ? [...raw.entities] : raw.entities,
  };
}

function cacheRawData(kind, raw, context = getContextKey()) {
  if (!raw || typeof raw !== "object") return;
  const item = { kind, context, raw: cloneRawData(raw), at: now(), stats: getRawStats(raw) };
  state.extractCache.set(`${kind}|${context}`, item);
  if (hasUsefulRawData(raw)) state.lastGoodByContext.set(context, item);
}

function getRawStats(raw) {
  return {
    source: raw?.source || "unknown",
    layers: Array.isArray(raw?.layers) ? raw.layers.length : 0,
    entities: Array.isArray(raw?.entities) ? raw.entities.length : 0,
  };
}

function getCachedRawData(kind, context = getContextKey()) {
  const item = state.extractCache.get(`${kind}|${context}`);
  if (!item) return null;
  if (now() - item.at > DEFAULTS.extractCacheTtlMs) return null;
  state.counters.extractCacheHits += 1;
  return cloneRawData(item.raw);
}

function getLastGoodRawData(context = getContextKey()) {
  const item = state.lastGoodByContext.get(context);
  if (!item) return null;
  if (now() - item.at > DEFAULTS.emptyFallbackTtlMs) return null;
  state.counters.extractEmptyFallbackHits += 1;
  return cloneRawData(item.raw);
}

function patchCadLayerKit() {
  const kit = window.CADLayerKit;
  if (!kit || state.patched.cadLayerKit) return false;

  if (typeof kit.extractFromViewer === "function") {
    const original = kit.extractFromViewer.bind(kit);
    kit.__essamV21OriginalExtractFromViewer = kit.__essamV21OriginalExtractFromViewer || original;
    kit.extractFromViewer = function guardedExtractFromViewer(viewer, options = {}) {
      const context = getContextKey();
      const force = options?.force === true || options?.bypassV21Cache === true;
      state.counters.extractFromViewer += 1;

      if (!force && !state.isTransitioning) {
        const cached = getCachedRawData("viewer", context);
        if (cached) return cached;
      }

      const t0 = now();
      let raw;
      try {
        raw = original(viewer, options);
      } catch (err) {
        rememberError("extractFromViewer failed", err);
        const fallback = getLastGoodRawData(context);
        if (fallback) return fallback;
        throw err;
      } finally {
        state.timings.lastExtractMs = Math.round(now() - t0);
      }

      if (hasUsefulRawData(raw)) {
        state.counters.extractMisses += 1;
        cacheRawData("viewer", raw, context);
        return raw;
      }

      // Avoid replacing useful context data with empty extraction during incidental refreshes.
      if (!force) {
        const fallback = getLastGoodRawData(context);
        if (fallback) {
          log("Returned last good extraction instead of empty viewer extraction", { context, raw: getRawStats(raw), fallback: getRawStats(fallback) });
          return fallback;
        }
      }
      return raw;
    };
  }

  if (typeof kit.extractFromScene === "function") {
    const originalScene = kit.extractFromScene.bind(kit);
    kit.__essamV21OriginalExtractFromScene = kit.__essamV21OriginalExtractFromScene || originalScene;
    kit.extractFromScene = function guardedExtractFromScene(scene, options = {}) {
      const context = getContextKey();
      const force = options?.force === true || options?.bypassV21Cache === true;
      state.counters.extractFromScene += 1;

      if (!force && !state.isTransitioning) {
        const cached = getCachedRawData("scene", context);
        if (cached) return cached;
      }

      const t0 = now();
      let raw;
      try {
        raw = originalScene(scene, options);
      } catch (err) {
        rememberError("extractFromScene failed", err);
        const fallback = getLastGoodRawData(context);
        if (fallback) return fallback;
        throw err;
      } finally {
        state.timings.lastExtractMs = Math.round(now() - t0);
      }

      if (hasUsefulRawData(raw)) {
        cacheRawData("scene", raw, context);
        return raw;
      }

      if (!force) {
        const fallback = getLastGoodRawData(context);
        if (fallback) return fallback;
      }
      return raw;
    };
  }

  state.patched.cadLayerKit = true;
  log("CADLayerKit patched");
  return true;
}

function patchRenderBridge(bridge = window.__essamEntityRenderBridge) {
  if (!bridge || bridge.__essamV21RenderBridgePatched || typeof bridge.rebuild !== "function") return false;

  const original = bridge.rebuild.bind(bridge);
  let lastRun = 0;
  let timer = null;
  let lastResult = bridge.getDebugSummary?.() || null;

  bridge.__essamV21OriginalRebuild = original;
  bridge.rebuild = function throttledEntityRenderRebuild(...args) {
    state.counters.renderRebuildCalls += 1;
    const dt = now() - lastRun;

    if (dt >= DEFAULTS.rebuildThrottleMs || state.isTransitioning) {
      lastRun = now();
      lastResult = original(...args);
      return lastResult;
    }

    state.counters.renderRebuildSkipped += 1;
    if (!timer) {
      state.counters.renderRebuildScheduled += 1;
      timer = setTimeout(() => {
        timer = null;
        lastRun = now();
        try { lastResult = original(...args); } catch (err) { rememberError("scheduled EntityRenderBridge rebuild failed", err); }
      }, DEFAULTS.rebuildThrottleMs);
    }
    return lastResult || bridge.getDebugSummary?.() || null;
  };

  bridge.__essamV21RenderBridgePatched = true;
  state.patched.renderBridge = true;
  log("EntityRenderBridge patched");
  return true;
}

function makeOverlay() {
  let el = document.getElementById("essam-v21-transition-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "essam-v21-transition-overlay";
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483000; display: none;
    align-items: center; justify-content: center; flex-direction: column;
    background: rgba(8, 12, 18, 0.72); color: #fff; font-family: system-ui, Arial;
    backdrop-filter: blur(3px); direction: ltr; text-align: center;
  `;
  el.innerHTML = `
    <div style="width:min(460px,90vw);padding:22px 24px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(0,0,0,.45);box-shadow:0 14px 45px rgba(0,0,0,.35)">
      <div id="essam-v21-transition-title" style="font-size:18px;font-weight:700;margin-bottom:8px">Preparing view...</div>
      <div id="essam-v21-transition-subtitle" style="font-size:13px;opacity:.78;margin-bottom:14px">Organizing geometry and cleaning temporary resources.</div>
      <div style="height:8px;background:rgba(255,255,255,.12);border-radius:999px;overflow:hidden">
        <div id="essam-v21-transition-progress" style="height:100%;width:0%;background:#fff;border-radius:999px;transition:width .18s ease"></div>
      </div>
      <div id="essam-v21-transition-percent" style="font-size:12px;opacity:.72;margin-top:8px">0%</div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

function showOverlay(title, subtitle) {
  const el = makeOverlay();
  el.style.display = "flex";
  el.querySelector("#essam-v21-transition-title").textContent = title || "Preparing view...";
  el.querySelector("#essam-v21-transition-subtitle").textContent = subtitle || "Organizing geometry and cleaning temporary resources.";
  updateOverlay(0);
}

function updateOverlay(percent, subtitle = null) {
  const el = makeOverlay();
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  el.querySelector("#essam-v21-transition-progress").style.width = `${p}%`;
  el.querySelector("#essam-v21-transition-percent").textContent = `${p}%`;
  if (subtitle) el.querySelector("#essam-v21-transition-subtitle").textContent = subtitle;
}

function hideOverlay() {
  const el = document.getElementById("essam-v21-transition-overlay");
  if (el) el.style.display = "none";
}

function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function registrySnapshot() {
  const registry = window.__essamEntityRegistry;
  const stats = registry?.getStats?.() || null;
  const all = registry?.getAll?.({ includeDeleted: true }) || [];
  return {
    context: getContextKey(),
    stats,
    entityCount: all.length,
    entities: all,
    selected: registry?.getSelected?.() || [],
    at: new Date().toISOString(),
  };
}

function cleanupOldMode(mode = state.currentMode) {
  const t0 = now();
  state.counters.cleanupCalls += 1;
  try {
    window.__essamSelectionEngine?.clear?.();
    window.__essamScreenSelectionBridge?.clearSelectionHighlights?.();
    window.cadEntityLayerEditor?.hideSelectionBox?.();

    if (mode === "3d" || mode === "vr") {
      window.cadSceneExporter?.cleanup?.();
      window.CADSceneExporter?.cleanup?.();
      window.__essam3DScene?.cleanup?.();
    }

    if (mode === "vr") {
      window.__essamXRSession?.end?.().catch?.(() => {});
      window.__essamVRControllers?.dispose?.();
    }
  } catch (err) {
    rememberError("cleanupOldMode failed", err);
  } finally {
    state.timings.lastCleanupMs = Math.round(now() - t0);
  }
}

function isVisibleForView(entity) {
  return entity && entity.deleted !== true && entity.visible !== false;
}

function layerLooksStructural(layer = "") {
  const l = String(layer).toLowerCase();
  return /wall|walls|axis|grid|door|window|floor|room|lighting|light|led|column|beam|structure|pdf_dd|pdf|0|خط|محور|جدار|باب|شباك|اضاءة|إنارة/.test(l);
}

function compileViewData(mode = "2d", snapshot = registrySnapshot(), options = {}) {
  const t0 = now();
  const source = snapshot.entities || [];
  let result;

  if (mode === "2d") {
    result = source.filter(isVisibleForView);
  } else if (mode === "3d") {
    result = source.filter((e) => isVisibleForView(e) && layerLooksStructural(e.layer) && String(e.kind || "").toUpperCase() !== "TEXT");
  } else if (mode === "vr") {
    result = source.filter((e) => isVisibleForView(e) && layerLooksStructural(e.layer) && String(e.kind || "").toUpperCase() !== "TEXT");
    // VR must be lighter. Keep deterministic sampling if massive.
    const hardLimit = Number(options.vrLimit || 60000);
    if (result.length > hardLimit) {
      const step = Math.ceil(result.length / hardLimit);
      result = result.filter((_, i) => i % step === 0);
    }
  } else {
    result = source.filter(isVisibleForView);
  }

  const viewData = {
    version: VERSION,
    mode,
    context: snapshot.context,
    sourceEntityCount: source.length,
    entityCount: result.length,
    entities: result,
    stats: snapshot.stats,
    compiledAt: new Date().toISOString(),
  };

  state.lastViewData = viewData;
  state.counters.compiledViewData += 1;
  state.timings.lastCompileMs = Math.round(now() - t0);
  return viewData;
}

async function chunkWarmup(viewData, mode) {
  const size = mode === "vr" ? DEFAULTS.transitionChunkSizeVr : mode === "3d" ? DEFAULTS.transitionChunkSize3d : DEFAULTS.transitionChunkSize2d;
  const total = viewData.entities.length || 1;
  for (let i = 0; i < viewData.entities.length; i += size) {
    const p = Math.min(95, (i / total) * 100);
    updateOverlay(p, `Preparing ${mode.toUpperCase()} data: ${Math.min(i + size, total).toLocaleString()} / ${total.toLocaleString()}`);
    await waitFrame();
  }
}

async function startTransition(targetMode, options = {}) {
  if (state.isTransitioning) return state.lastTransition;
  const t0 = now();
  state.isTransitioning = true;
  state.transitionStartedAt = Date.now();
  state.previousMode = state.currentMode;
  state.counters.transitions += 1;

  showOverlay(options.title || `Preparing ${String(targetMode).toUpperCase()} view...`, options.subtitle || "Cleaning previous view and compiling optimized data.");

  let snapshot, viewData;
  try {
    updateOverlay(8, "Taking stable registry snapshot...");
    snapshot = registrySnapshot();
    state.lastSnapshot = snapshot;
    await waitFrame();

    updateOverlay(18, "Cleaning temporary resources...");
    cleanupOldMode(state.currentMode);
    await waitFrame();

    updateOverlay(35, "Compiling view-specific data...");
    viewData = compileViewData(targetMode, snapshot, options);
    await waitFrame();

    updateOverlay(52, "Warming data in chunks...");
    await chunkWarmup(viewData, targetMode);

    state.currentMode = targetMode;
    state.lastTransition = {
      ok: true,
      from: state.previousMode,
      to: targetMode,
      context: snapshot.context,
      sourceEntityCount: viewData.sourceEntityCount,
      compiledEntityCount: viewData.entityCount,
      durationMs: Math.round(now() - t0),
      at: new Date().toISOString(),
    };
    state.timings.lastTransitionMs = state.lastTransition.durationMs;

    updateOverlay(100, "Ready");
    window.dispatchEvent(new CustomEvent("cad:mode-transition-ready", { detail: { mode: targetMode, viewData, summary: state.lastTransition } }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    return state.lastTransition;
  } catch (err) {
    rememberError("startTransition failed", err);
    state.lastTransition = { ok: false, from: state.previousMode, to: targetMode, message: err?.message || String(err), at: new Date().toISOString() };
    return state.lastTransition;
  } finally {
    state.isTransitioning = false;
    hideOverlay();
  }
}

function getSummary() {
  const context = getContextKey();
  const registry = window.__essamEntityRegistry;
  return {
    installed: state.installed,
    version: VERSION,
    debug: state.debug,
    currentMode: state.currentMode,
    previousMode: state.previousMode,
    isTransitioning: state.isTransitioning,
    context,
    registryStats: registry?.getStats?.() || null,
    cache: {
      extractCacheSize: state.extractCache.size,
      lastGoodContexts: state.lastGoodByContext.size,
      currentHasLastGood: state.lastGoodByContext.has(context),
    },
    patched: { ...state.patched },
    counters: { ...state.counters },
    timings: { ...state.timings },
    lastTransition: state.lastTransition,
    lastViewData: state.lastViewData ? {
      mode: state.lastViewData.mode,
      context: state.lastViewData.context,
      sourceEntityCount: state.lastViewData.sourceEntityCount,
      entityCount: state.lastViewData.entityCount,
      compiledAt: state.lastViewData.compiledAt,
    } : null,
    lastErrors: [...state.lastErrors],
  };
}

function clearCaches() {
  state.extractCache.clear();
  state.lastGoodByContext.clear();
  state.lastViewData = null;
  state.lastSnapshot = null;
  return getSummary();
}

function setDebug(value) { state.debug = !!value; return getSummary(); }

function install() {
  if (state.installed) return getSummary();
  state.installed = true;

  const tryPatch = () => {
    try { patchCadLayerKit(); } catch (err) { rememberError("patchCadLayerKit failed", err); }
    try { patchRenderBridge(); } catch (err) { rememberError("patchRenderBridge failed", err); }
  };

  tryPatch();
  const patchTimer = setInterval(() => {
    tryPatch();
    if (state.patched.cadLayerKit && state.patched.renderBridge) clearInterval(patchTimer);
  }, 1200);

  window.addEventListener("cad:entity-registry-ready", () => {
    patchRenderBridge();
    const raw = {
      source: "entity-registry-ready",
      layers: window.__essamEntityRegistry?.getLayerNames?.() || [],
      entities: window.__essamEntityRegistry?.getAll?.({ includeDeleted: true }) || [],
    };
    if (hasUsefulRawData(raw)) cacheRawData("registry", raw, getContextKey());
  });

  window.addEventListener("cad:file-loaded", () => clearCaches());
  window.addEventListener("cad:pdf-page-changed", () => {
    // New page = different context. Do not clear all, but make sure stale lastViewData is not reused.
    state.lastViewData = null;
  });

  window.__essamPerformanceCoordinator = {
    version: VERSION,
    getSummary,
    setDebug,
    clearCaches,
    patchCadLayerKit,
    patchRenderBridge,
    getContextKey,
  };

  window.__essamPerformanceMonitor = window.__essamPerformanceCoordinator;

  window.__essamModeTransitionManager = {
    version: VERSION,
    startTransition,
    prepare2D: (options = {}) => startTransition("2d", options),
    prepare3D: (options = {}) => startTransition("3d", options),
    prepareVR: (options = {}) => startTransition("vr", options),
    compileViewData,
    cleanupOldMode,
    getSummary,
    setDebug,
  };

  console.info(`[PerformanceStabilizer ${VERSION}] Installed. Use window.__essamModeTransitionManager.prepare3D() before heavy 3D/VR builds.`);
  return getSummary();
}

install();
