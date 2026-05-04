/**
 * EmptyExtractionGuard.js - V18.3 PDF PAGE AWARE
 *
 * Purpose:
 * Prevent a valid EntityRegistry/DocumentModel from being replaced by an empty
 * extraction caused by temporary viewer refresh, failed DXF load, DrawingOverlay autosave,
 * or scene-fallback returning layers=0/entities=0.
 *
 * V18.1 change:
 * - No repeated "Captured good registry" console spam.
 * - Interval capture is silent.
 * - Logs only on install, first good capture, debug mode, or real restore from empty extraction.
 */

import { CADLayerKit } from "../CADLayerKit.js";

const STATE = {
  lastGoodRegistry: null,
  lastGoodDocumentModel: null,
  lastGoodRawData: null,
  lastGoodStats: null,
  lastGoodSignature: "",
  lastGoodByContext: new Map(),
  activeContextKey: "",
  pendingContextChangeUntil: 0,
  firstGoodCaptured: false,
  restoring: false,
  installed: false,
  debug: false,
  lastRestoreLogAt: 0,
};

function getStats(registry = window.__essamEntityRegistry) {
  try { return registry?.getStats?.() || null; } catch (_) { return null; }
}

function statsSignature(stats) {
  if (!stats) return "none";
  return `${Number(stats.layerCount || 0)}:${Number(stats.entityCount || 0)}:${Number(stats.selectedCount || 0)}`;
}

function getCadContextKey() {
  const app = window.cadApp || {};
  const file = app.uploader?.file || app.currentFile || null;
  const name = file?.name || app.currentFileName || "active-file";
  const size = Number(file?.size || 0);
  const pageCount = Number(app._pdfPageCount || 1);
  const page = Math.max(1, Number(app._pdfCurrentPage || 1));
  return `${name}|${size}|page-${pageCount > 1 ? page : 1}`;
}

function clearLastGoodForActiveContext(reason = "context-clear") {
  STATE.lastGoodRegistry = null;
  STATE.lastGoodDocumentModel = null;
  STATE.lastGoodRawData = null;
  STATE.lastGoodStats = null;
  STATE.lastGoodSignature = "";
  if (STATE.debug) console.info("[EmptyExtractionGuard V18.3] Cleared active context cache", { reason, context: STATE.activeContextKey });
}

function syncActiveContext(reason = "context-check") {
  const key = getCadContextKey();
  if (!STATE.activeContextKey) STATE.activeContextKey = key;
  if (key === STATE.activeContextKey) return false;

  const previous = STATE.activeContextKey;
  STATE.activeContextKey = key;
  STATE.pendingContextChangeUntil = Date.now() + 2500;

  const saved = STATE.lastGoodByContext.get(key);
  if (saved) {
    STATE.lastGoodRegistry = saved.registry || null;
    STATE.lastGoodDocumentModel = saved.documentModel || null;
    STATE.lastGoodRawData = saved.rawData || null;
    STATE.lastGoodStats = saved.stats || null;
    STATE.lastGoodSignature = saved.signature || "";
  } else {
    clearLastGoodForActiveContext(reason);
  }

  console.info("[EmptyExtractionGuard V18.3] CAD context changed", { reason, previous, current: key, restoredFromContextCache: !!saved });
  return true;
}

function isContextChangePending() {
  return Date.now() < Number(STATE.pendingContextChangeUntil || 0);
}

function isGoodStats(stats) {
  return !!stats && Number(stats.layerCount || 0) > 0 && Number(stats.entityCount || 0) > 0;
}

function isEmptyExtraction(result) {
  const layers = Array.isArray(result?.layers) ? result.layers.length : 0;
  const entities = Array.isArray(result?.entities) ? result.entities.length : 0;
  return layers === 0 && entities === 0;
}

function registryToRawData(registry = STATE.lastGoodRegistry, documentModel = STATE.lastGoodDocumentModel) {
  if (!registry) return null;
  let layers = [];
  let entities = [];

  try { layers = registry.getLayerNames?.() || registry.getLayerIds?.() || []; } catch (_) {}
  try { entities = registry.getAll?.({ includeDeleted: true }) || []; } catch (_) {}

  return {
    source: "guard-last-good-registry",
    layers,
    entities,
    entityRegistry: registry,
    documentModel: documentModel || window.__essamDocumentModel || null,
    guarded: true,
    stats: registry.getStats?.() || null,
  };
}

function captureGoodState(reason = "capture", options = {}) {
  syncActiveContext(reason);
  const { silent = true } = options;
  const registry = window.__essamEntityRegistry;
  const stats = getStats(registry);
  if (!isGoodStats(stats)) return false;

  const sig = statsSignature(stats);
  const firstGood = !STATE.firstGoodCaptured;
  const changed = sig !== STATE.lastGoodSignature;

  STATE.lastGoodRegistry = registry;
  STATE.lastGoodDocumentModel = window.__essamDocumentModel || STATE.lastGoodDocumentModel || null;
  STATE.lastGoodStats = stats;
  STATE.lastGoodSignature = sig;
  STATE.lastGoodRawData = registryToRawData(registry, STATE.lastGoodDocumentModel);
  STATE.lastGoodByContext.set(STATE.activeContextKey || getCadContextKey(), {
    registry: STATE.lastGoodRegistry,
    documentModel: STATE.lastGoodDocumentModel,
    rawData: STATE.lastGoodRawData,
    stats: STATE.lastGoodStats,
    signature: STATE.lastGoodSignature,
  });
  STATE.firstGoodCaptured = true;

  if (STATE.debug || (!silent && (firstGood || changed))) {
    console.info("[EmptyExtractionGuard V18.1] Captured good registry", { reason, stats });
  }

  return true;
}

function restoreLastGood(reason = "restore") {
  syncActiveContext(reason);
  if (isContextChangePending() && !STATE.lastGoodByContext.has(STATE.activeContextKey)) return false;
  if (!STATE.lastGoodRegistry || STATE.restoring) return false;
  STATE.restoring = true;
  try {
    window.__essamEntityRegistry = STATE.lastGoodRegistry;
    if (STATE.lastGoodDocumentModel) window.__essamDocumentModel = STATE.lastGoodDocumentModel;

    // Restore logs are useful, but throttle identical bursts caused by repeated autosave/refresh loops.
    const now = Date.now();
    if (STATE.debug || now - STATE.lastRestoreLogAt > 1200) {
      console.warn("[EmptyExtractionGuard V18.1] Restored last good registry after empty extraction", {
        reason,
        stats: STATE.lastGoodStats,
      });
      STATE.lastRestoreLogAt = now;
    }

    window.dispatchEvent(new CustomEvent("cad:entity-registry-guard-restored", {
      detail: {
        reason,
        registry: STATE.lastGoodRegistry,
        documentModel: STATE.lastGoodDocumentModel,
        stats: STATE.lastGoodStats,
      },
    }));

    return true;
  } finally {
    STATE.restoring = false;
  }
}

function guardResult(result, reason = "extract") {
  syncActiveContext(reason);
  const currentStats = getStats(window.__essamEntityRegistry);

  if (isGoodStats(currentStats)) {
    captureGoodState(`${reason}:current-good`, { silent: true });
  }

  if (!isEmptyExtraction(result)) {
    // A non-empty extraction is probably valid. Capture after caller builds registry, silently.
    setTimeout(() => captureGoodState(`${reason}:non-empty-result`, { silent: true }), 0);
    return result;
  }

  if (STATE.lastGoodRegistry && !(isContextChangePending() && !STATE.lastGoodByContext.has(STATE.activeContextKey))) {
    restoreLastGood(`${reason}:empty-result`);
    return registryToRawData();
  }

  return result;
}

function patchCADLayerKit() {
  if (!CADLayerKit || CADLayerKit.__essamEmptyExtractionGuardV18_1) return;

  const originalExtractFromViewer = CADLayerKit.extractFromViewer?.bind(CADLayerKit);
  const originalExtractFromScene = CADLayerKit.extractFromScene?.bind(CADLayerKit);

  if (originalExtractFromViewer) {
    CADLayerKit.extractFromViewer = function guardedExtractFromViewer(viewer, opts = {}) {
      const result = originalExtractFromViewer(viewer, opts);
      return guardResult(result, "extractFromViewer");
    };
  }

  if (originalExtractFromScene) {
    CADLayerKit.extractFromScene = function guardedExtractFromScene(scene, opts = {}) {
      const result = originalExtractFromScene(scene, opts);
      return guardResult(result, "extractFromScene");
    };
  }

  CADLayerKit.__essamEmptyExtractionGuardV18_1 = true;
}

function installEventGuards() {
  const maybeCaptureOrRestore = (event) => {
    syncActiveContext(event?.type || "event");
    if (STATE.restoring) return;

    const incoming = event?.detail?.registry || window.__essamEntityRegistry;
    const incomingStats = getStats(incoming);

    if (isGoodStats(incomingStats)) {
      captureGoodState(event?.type || "event-good", { silent: true });
      return;
    }

    if (STATE.lastGoodRegistry) {
      restoreLastGood(`${event?.type || "event"}:empty-incoming`);
    }
  };

  [
    "cad:entity-registry-ready",
    "cad:entity-registry-updated",
    "cad:document-model-ready",
    "cad:file-loaded",
    "cad:content-recognition-ready",
  ].forEach((name) => window.addEventListener(name, maybeCaptureOrRestore));

  window.addEventListener("cad:pdf-page-changed", (event) => {
    STATE.pendingContextChangeUntil = Date.now() + 2500;
    syncActiveContext("cad:pdf-page-changed");
    window.__essamPdfPageChangeUntilV18_3 = STATE.pendingContextChangeUntil;
    console.info("[EmptyExtractionGuard V18.3] PDF page changed; allowing page-specific extraction", {
      page: event?.detail?.page,
      context: STATE.activeContextKey,
    });
  });

  // DrawingOverlay autosave can indirectly call refreshLayerOptions repeatedly.
  // V18.1 keeps the capture silent and only warns when a real restore happens.
  setInterval(() => {
    syncActiveContext("interval");
    const current = getStats(window.__essamEntityRegistry);
    if (isGoodStats(current)) {
      captureGoodState("interval-good", { silent: true });
      return;
    }
    if (STATE.lastGoodRegistry && current && !isGoodStats(current)) {
      restoreLastGood("interval-empty-current");
    }
  }, 1500);
}

function exposeDebugApi() {
  STATE.setDebug = (value = true) => {
    STATE.debug = value === true;
    console.info("[EmptyExtractionGuard V18.1] debug =", STATE.debug);
    return STATE.debug;
  };

  STATE.getSummary = () => ({
    installed: STATE.installed,
    debug: STATE.debug,
    hasLastGoodRegistry: !!STATE.lastGoodRegistry,
    lastGoodStats: STATE.lastGoodStats,
    lastGoodSignature: STATE.lastGoodSignature,
    currentStats: getStats(window.__essamEntityRegistry),
    context: STATE.activeContextKey,
    hasContextCache: STATE.lastGoodByContext.has(STATE.activeContextKey),
    cachedContexts: STATE.lastGoodByContext.size,
    pendingContextChange: isContextChangePending(),
  });
}

export function installEmptyExtractionGuard() {
  if (STATE.installed) return STATE;
  STATE.installed = true;
  patchCADLayerKit();
  installEventGuards();
  exposeDebugApi();
  captureGoodState("install", { silent: true });
  window.__essamEmptyExtractionGuardV18 = STATE;
  window.__essamEmptyExtractionGuardV18_1 = STATE;
  window.__essamEmptyExtractionGuardV18_3 = STATE;
  console.info("[EmptyExtractionGuard V18.3] Installed PDF page-aware guard");
  return STATE;
}

installEmptyExtractionGuard();

/**
 * IdleManagedRenderGuard - V18.2
 *
 * Fixes this case:
 * - Deleted/hidden/moved entity is correct in EntityRegistry.
 * - 3D and Entity Management view are correct.
 * - Normal 2D view still shows the original x-viewer grouped render.
 *
 * Solution:
 * If entity-level edits exist, keep EntityRenderBridge active even when the
 * EntityLayerEditor panel is closed. This keeps the original grouped objects hidden
 * and shows the managed per-entity render that respects deleted/hidden/moved state.
 */

const IDLE_RENDER_STATE_V18_2 = {
  installed: false,
  debug: false,
  lastHadEdits: false,
  lastAction: "none",
  lastLogAt: 0,
  patchedBridges: new WeakSet(),
  pdfPageChangeUntil: 0,
};

function idleGetRegistry() {
  return window.__essamEntityRegistry || null;
}

function idleGetStats() {
  try { return idleGetRegistry()?.getStats?.() || null; } catch (_) { return null; }
}

function idleIsGoodRegistry() {
  const stats = idleGetStats();
  return !!stats && Number(stats.layerCount || 0) > 0 && Number(stats.entityCount || 0) > 0;
}

function idleGetEditor() {
  return window.cadEntityLayerEditor || window.__essamEntityLayerEditor || null;
}

function idleGetBridge() {
  const editor = idleGetEditor();
  const existing = window.__essamEntityRenderBridge || null;
  if (existing) return existing;
  try { return editor?.getEntityRenderBridge?.() || null; } catch (_) { return null; }
}

function idleIsEditorEnabled() {
  try { return idleGetEditor()?.enabled === true; } catch (_) { return false; }
}

function idleIsPdfPageChanging() {
  const until = Math.max(Number(IDLE_RENDER_STATE_V18_2.pdfPageChangeUntil || 0), Number(window.__essamPdfPageChangeUntilV18_3 || 0));
  return Date.now() < until;
}

function idleForceDisableForPageChange(reason = "pdf-page-change") {
  const bridge = idlePatchBridgeDisable(idleGetBridge());
  try {
    bridge?.disable?.({ restoreOriginals: true, forceIdleManagedRenderDisable: true, force: true });
    IDLE_RENDER_STATE_V18_2.lastAction = `disabled:${reason}`;
    return true;
  } catch (err) {
    idleLog("warn", "Failed to disable managed render for PDF page change", { reason, err });
    return false;
  }
}

function idleHasEntityEdits() {
  const registry = idleGetRegistry();
  if (!registry?.getAll) return false;

  let entities = [];
  try { entities = registry.getAll({ includeDeleted: true }) || []; } catch (_) { return false; }

  return entities.some((entity) => {
    if (!entity) return false;
    if (entity.deleted === true) return true;
    if (entity.visible === false) return true;

    const currentLayer = String(entity.layer || "0");
    const originalLayer = String(
      entity.originalLayer ||
      entity.meta?.originalLayer ||
      entity.meta?.userData?.__sourceOriginalLayer ||
      entity.meta?.userData?.layer ||
      entity.meta?.layer ||
      currentLayer
    );

    return !!originalLayer && currentLayer !== originalLayer;
  });
}

function idleLog(kind, message, payload = null, throttleMs = 1200) {
  if (!IDLE_RENDER_STATE_V18_2.debug && kind === "debug") return;
  const now = Date.now();
  if (!IDLE_RENDER_STATE_V18_2.debug && now - IDLE_RENDER_STATE_V18_2.lastLogAt < throttleMs) return;
  IDLE_RENDER_STATE_V18_2.lastLogAt = now;
  const fn = kind === "warn" ? console.warn : kind === "error" ? console.error : console.info;
  fn(`[IdleManagedRenderGuard V18.2] ${message}`, payload || "");
}

function idlePatchBridgeDisable(bridge) {
  if (!bridge || IDLE_RENDER_STATE_V18_2.patchedBridges.has(bridge)) return bridge;
  if (typeof bridge.disable !== "function") return bridge;

  const originalDisable = bridge.disable.bind(bridge);

  bridge.disable = function guardedDisable(options = {}) {
    const force = options?.force === true || options?.forceIdleManagedRenderDisable === true;
    if (!force && idleHasEntityEdits()) {
      idleLog("debug", "Blocked EntityRenderBridge.disable because entity edits exist", { options });
      try {
        bridge.enable?.();
        bridge.rebuild?.();
      } catch (err) {
        idleLog("warn", "Failed to keep managed render active after blocked disable", err);
      }
      return bridge;
    }
    return originalDisable(options);
  };

  IDLE_RENDER_STATE_V18_2.patchedBridges.add(bridge);
  return bridge;
}

function idleEnableManagedRender(reason = "enable") {
  if (!idleIsGoodRegistry()) return false;
  const bridge = idlePatchBridgeDisable(idleGetBridge());
  if (!bridge) return false;

  try {
    bridge.enable?.();
    bridge.rebuild?.();
    IDLE_RENDER_STATE_V18_2.lastAction = `enabled:${reason}`;
    return true;
  } catch (err) {
    idleLog("warn", "Failed to enable managed render", { reason, err });
    return false;
  }
}

function idleDisableManagedRenderIfClean(reason = "disable-clean") {
  const bridge = idlePatchBridgeDisable(idleGetBridge());
  if (!bridge || idleIsEditorEnabled()) return false;
  if (idleHasEntityEdits()) return false;

  try {
    bridge.disable?.({ restoreOriginals: true, forceIdleManagedRenderDisable: true });
    IDLE_RENDER_STATE_V18_2.lastAction = `disabled:${reason}`;
    return true;
  } catch (err) {
    idleLog("warn", "Failed to disable managed render after clean state", { reason, err });
    return false;
  }
}

function idleEnforceManagedRender(reason = "enforce") {
  if (idleIsPdfPageChanging()) {
    idleForceDisableForPageChange(reason);
    IDLE_RENDER_STATE_V18_2.lastHadEdits = false;
    return false;
  }
  const hasEdits = idleHasEntityEdits();
  const bridge = idlePatchBridgeDisable(idleGetBridge());

  if (hasEdits) {
    const summary = bridge?.getDebugSummary?.() || {};
    const needsEnable = !bridge || summary.enabled !== true || Number(summary.managedChildren || 0) === 0;
    const ok = idleEnableManagedRender(reason);

    if (!IDLE_RENDER_STATE_V18_2.lastHadEdits || needsEnable) {
      idleLog("info", "Kept managed per-entity render active because entity edits exist", {
        reason,
        ok,
        stats: idleGetStats(),
        render: bridge?.getDebugSummary?.() || null,
      }, 1500);
    }

    IDLE_RENDER_STATE_V18_2.lastHadEdits = true;
    return ok;
  }

  if (IDLE_RENDER_STATE_V18_2.lastHadEdits) {
    idleDisableManagedRenderIfClean(reason);
    idleLog("info", "Entity edits cleared; normal x-viewer render can be restored", { reason }, 1500);
  }

  IDLE_RENDER_STATE_V18_2.lastHadEdits = false;
  return false;
}

function idlePatchEditorSetMode() {
  const editor = idleGetEditor();
  if (!editor || editor.__essamIdleRenderGuardPatchedV18_2) return false;
  if (typeof editor.setMode !== "function") return false;

  const originalSetMode = editor.setMode.bind(editor);
  editor.setMode = function guardedSetMode(enabled, ...args) {
    const result = originalSetMode(enabled, ...args);
    setTimeout(() => idleEnforceManagedRender(`setMode:${enabled ? "on" : "off"}`), 0);
    setTimeout(() => idleEnforceManagedRender(`setMode:${enabled ? "on" : "off"}:late`), 180);
    return result;
  };

  editor.__essamIdleRenderGuardPatchedV18_2 = true;
  return true;
}

function installIdleManagedRenderGuardV18_2() {
  if (IDLE_RENDER_STATE_V18_2.installed) return IDLE_RENDER_STATE_V18_2;
  IDLE_RENDER_STATE_V18_2.installed = true;

  const eventNames = [
    "cad:entity-registry-ready",
    "cad:entity-registry-updated",
    "cad:entity-registry-guard-restored",
    "cad:project-state-restored",
    "cad:file-loaded",
    "cad:content-recognition-ready",
    "cad:pdf-page-changed",
  ];

  eventNames.forEach((name) => {
    window.addEventListener(name, (event) => {
      if (name === "cad:pdf-page-changed") {
        IDLE_RENDER_STATE_V18_2.pdfPageChangeUntil = Date.now() + 2500;
        idleForceDisableForPageChange(name);
      }
      idlePatchEditorSetMode();
      setTimeout(() => idleEnforceManagedRender(name), 0);
      setTimeout(() => idleEnforceManagedRender(`${name}:late`), 220);
      setTimeout(() => idleEnforceManagedRender(`${name}:settled`), 2800);
    });
  });

  // Catch the exact case where the user closes Entity Management and its own code disables the bridge.
  setInterval(() => {
    idlePatchEditorSetMode();
    idleEnforceManagedRender("interval");
  }, 900);

  IDLE_RENDER_STATE_V18_2.getSummary = () => ({
    installed: IDLE_RENDER_STATE_V18_2.installed,
    debug: IDLE_RENDER_STATE_V18_2.debug,
    hasEntityEdits: idleHasEntityEdits(),
    editorEnabled: idleIsEditorEnabled(),
    stats: idleGetStats(),
    render: idleGetBridge()?.getDebugSummary?.() || null,
    lastHadEdits: IDLE_RENDER_STATE_V18_2.lastHadEdits,
    pageChanging: idleIsPdfPageChanging(),
    lastAction: IDLE_RENDER_STATE_V18_2.lastAction,
  });

  IDLE_RENDER_STATE_V18_2.setDebug = (value = true) => {
    IDLE_RENDER_STATE_V18_2.debug = value === true;
    console.info("[IdleManagedRenderGuard V18.2] debug =", IDLE_RENDER_STATE_V18_2.debug);
    return IDLE_RENDER_STATE_V18_2.debug;
  };

  window.__essamIdleManagedRenderGuardV18_2 = IDLE_RENDER_STATE_V18_2;
  window.__essamIdleManagedRenderGuardV18_3 = IDLE_RENDER_STATE_V18_2;
  console.info("[IdleManagedRenderGuard V18.3] Installed idle 2D managed render guard with PDF page awareness");

  setTimeout(() => idleEnforceManagedRender("install"), 0);
  setTimeout(() => idleEnforceManagedRender("install:late"), 700);
  return IDLE_RENDER_STATE_V18_2;
}

installIdleManagedRenderGuardV18_2();
