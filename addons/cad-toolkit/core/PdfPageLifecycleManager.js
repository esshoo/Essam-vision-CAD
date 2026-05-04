/**
 * PdfPageLifecycleManager.js
 * V22.2.3 - Safe PDF lifecycle rollback / observer
 *
 * V22.2.2 tried to repair blank pages by touching scene objects, camera, renderer,
 * culling, materials, layer indexes and repeated timers. That made page navigation much
 * slower and could change the viewer background. This version intentionally removes the
 * aggressive visual repair pipeline.
 *
 * What it keeps:
 * - Light observation of PDF page changes.
 * - Hiding PDF page controls while the 3D overlay is active.
 * - Debug summary helpers.
 * - A manual refreshCurrentPage() that calls the app's native page loader only once.
 *
 * What it does NOT do:
 * - It does not wrap/replace app._loadPdfPage.
 * - It does not emit extra cad:pdf-page-changed events.
 * - It does not change scene object visibility/materials/frustumCulled.
 * - It does not call _fitPdfViewport/_tryFlattenCamera/_forceNoCulling.
 * - It does not reset layer indexes automatically.
 */

const VERSION = "V22.2.3";

const STATE = {
  installed: false,
  debug: false,
  appPatched: false,
  cad3dPatched: false,
  observedPageEvents: 0,
  visualReadyEvents: 0,
  nativeRefreshCount: 0,
  hidden3DCount: 0,
  lastPage: 1,
  lastContext: "",
  lastEvent: null,
  lastRefresh: null,
  lastError: null,
  removedLegacyOverlay: false,
};

function log(...args) { if (STATE.debug) console.log(`[PdfPageLifecycleManager ${VERSION}]`, ...args); }
function info(...args) { console.info(`[PdfPageLifecycleManager ${VERSION}]`, ...args); }
function warn(...args) { console.warn(`[PdfPageLifecycleManager ${VERSION}]`, ...args); }

function getApp() { return window.cadApp || null; }
function getFile() { return getApp()?.uploader?.file || getApp()?.currentFile || null; }
function getFileName() { return getFile()?.name || getApp()?.currentFileName || "active-file"; }
function getFileSize() { return getFile()?.size || 0; }
function isPdfFile() { return /\.pdf$/i.test(String(getFileName() || "")); }
function getPage() {
  return Number(getApp()?._pdfCurrentPage || window.currentPdfPage || window.cadDrawingOverlay?.currentPage || 1) || 1;
}
function getContext(page = getPage()) {
  return `${getFileName()}|${getFileSize()}|page-${Number(page) || 1}`;
}

function cleanupLegacyVisualArtifacts() {
  try {
    const el = document.getElementById("essam-pdf-page-loading-v22-2");
    if (el) {
      el.remove();
      STATE.removedLegacyOverlay = true;
    }
  } catch (_) {}

  // Do not force body/canvas background. Just remove temporary classes if any old script left them behind.
  try {
    document.body.classList.remove("essam-pdf-page-transitioning", "essam-pdf-visual-repairing");
  } catch (_) {}

  try { window.__essamPdfPageTransitionActive = false; } catch (_) {}
}

function injectCss() {
  if (document.getElementById("essam-pdf-lifecycle-v22-2-3-style")) return;
  const style = document.createElement("style");
  style.id = "essam-pdf-lifecycle-v22-2-3-style";
  style.textContent = `
    body.essam-3d-active #pdf-pager,
    body.essam-3d-active .pdf-pager,
    body.essam-3d-active [data-role="pdf-pager"] {
      display: none !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }
  `;
  document.head.appendChild(style);
}

function patch3DControls() {
  if (window.__essamPdfLifecycle3DControlsPatchedV22_2_3) return false;
  window.__essamPdfLifecycle3DControlsPatchedV22_2_3 = true;
  STATE.cad3dPatched = true;

  function mark3DActive(active, reason = "unknown") {
    try {
      document.body.classList.toggle("essam-3d-active", !!active);
      STATE.hidden3DCount += active ? 1 : 0;
      log("3D active changed", { active, reason });
    } catch (_) {}
  }

  // Patch common CAD3DBridge entry points if they exist now or later.
  const patchBridge = () => {
    const bridge = window.CAD3DBridge || window.cad3DBridge || window.cad3dBridge;
    if (!bridge || bridge.__essamPdfLifecyclePatchedV22_2_3) return;
    bridge.__essamPdfLifecyclePatchedV22_2_3 = true;

    for (const method of ["createOverlay", "loadJSON", "open", "show"]) {
      if (typeof bridge[method] !== "function") continue;
      const original = bridge[method].bind(bridge);
      bridge[method] = function patched3DOpen(...args) {
        mark3DActive(true, `CAD3DBridge.${method}`);
        return original(...args);
      };
    }

    for (const method of ["close", "hide", "destroy"]) {
      if (typeof bridge[method] !== "function") continue;
      const original = bridge[method].bind(bridge);
      bridge[method] = function patched3DClose(...args) {
        const res = original(...args);
        mark3DActive(false, `CAD3DBridge.${method}`);
        return res;
      };
    }
  };

  patchBridge();
  setTimeout(patchBridge, 700);
  setTimeout(patchBridge, 2000);

  // Also observe the DOM for likely 3D overlay removal/creation.
  try {
    const mo = new MutationObserver(() => {
      const active = !!document.querySelector("#cad3d-overlay, .cad3d-overlay, #essam-3d-overlay, .essam-3d-overlay");
      if (!active && document.body.classList.contains("essam-3d-active")) mark3DActive(false, "overlay-removed");
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}

  return true;
}

function onPdfPageChanged(event) {
  const detail = event?.detail || {};
  const page = Number(detail.page || detail.pageNumber || getPage()) || 1;
  STATE.observedPageEvents += 1;
  STATE.lastPage = page;
  STATE.lastContext = getContext(page);
  STATE.lastEvent = {
    type: "cad:pdf-page-changed",
    page,
    detailPage: detail.page,
    context: STATE.lastContext,
    at: new Date().toISOString(),
  };
  // Do not dispatch any extra page-changed event. This avoids duplicated geometry rebuilds.
  log("Observed native PDF page change", STATE.lastEvent);
}

function onVisualReady(event) {
  const detail = event?.detail || {};
  STATE.visualReadyEvents += 1;
  STATE.lastEvent = {
    type: "cad:pdf-page-visual-ready",
    page: Number(detail.page || detail.pageNumber || getPage()) || 1,
    context: getContext(),
    at: new Date().toISOString(),
  };
}

async function refreshCurrentPage() {
  const app = getApp();
  const page = getPage();
  if (!isPdfFile()) return api.getSummary();
  if (!app || typeof app._loadPdfPage !== "function") {
    STATE.lastError = { phase: "refreshCurrentPage", message: "cadApp._loadPdfPage not available", at: new Date().toISOString() };
    warn("Native PDF page refresh unavailable", STATE.lastError);
    return api.getSummary();
  }

  try {
    STATE.nativeRefreshCount += 1;
    STATE.lastRefresh = { page, context: getContext(page), at: new Date().toISOString(), mode: "native-only" };
    await app._loadPdfPage(page);
  } catch (err) {
    STATE.lastError = { phase: "refreshCurrentPage", message: err?.message || String(err), stack: err?.stack || null, at: new Date().toISOString() };
    warn("Native page refresh failed", STATE.lastError);
  }
  return api.getSummary();
}

function getSummary() {
  const registryStats = window.__essamEntityRegistry?.getStats?.() || null;
  const bridgeSummary = window.__essamPdfGeometryRefreshBridgeV18_9?.getSummary?.() || null;
  return {
    installed: STATE.installed,
    version: VERSION,
    debug: STATE.debug,
    appPatched: STATE.appPatched,
    cad3dPatched: STATE.cad3dPatched,
    mode: "observer-only-native-refresh",
    isPdfContext: isPdfFile(),
    page: getPage(),
    context: getContext(),
    observedPageEvents: STATE.observedPageEvents,
    visualReadyEvents: STATE.visualReadyEvents,
    nativeRefreshCount: STATE.nativeRefreshCount,
    hidden3DCount: STATE.hidden3DCount,
    removedLegacyOverlay: STATE.removedLegacyOverlay,
    registryStats,
    bridgeSummary: bridgeSummary ? {
      version: bridgeSummary.version,
      context: bridgeSummary.context,
      successCount: bridgeSummary.successCount,
      runCount: bridgeSummary.runCount,
      lastGood: bridgeSummary.lastGood,
      lastRun: bridgeSummary.lastRun,
    } : null,
    lastPage: STATE.lastPage,
    lastContext: STATE.lastContext,
    lastEvent: STATE.lastEvent,
    lastRefresh: STATE.lastRefresh,
    lastError: STATE.lastError,
  };
}

function setDebug(value = true) { STATE.debug = !!value; return getSummary(); }

function install() {
  if (STATE.installed) return api;
  cleanupLegacyVisualArtifacts();
  injectCss();
  patch3DControls();

  // Observation only. No wrapper around _loadPdfPage.
  window.addEventListener("cad:pdf-page-changed", onPdfPageChanged, true);
  window.addEventListener("cad:pdf-page-visual-ready", onVisualReady, true);

  STATE.installed = true;
  STATE.appPatched = false;
  info("Installed safe observer PDF lifecycle manager");
  return api;
}

const api = {
  install,
  getSummary,
  setDebug,
  refreshCurrentPage,
  cleanupLegacyVisualArtifacts,
  version: VERSION,
};

try {
  window.__essamPdfPageLifecycleV22_2_3 = api;
  // Keep old aliases so the user's console commands keep working.
  window.__essamPdfPageLifecycleV22_2_2 = api;
  window.__essamPdfPageLifecycleV22_2_1 = api;
  window.__essamPdfPageLifecycleV22_2 = api;
} catch (_) {}

install();

export default api;
