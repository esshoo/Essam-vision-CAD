/**
 * PdfGeometryRefreshBridge.js
 * V18.9 - Direct PDF scene-to-registry builder
 *
 * V18.7 fixed single-page PDFs where CADLayerKit could read model-layers.
 * Some multi-page PDFs do not trigger model-layers extraction after page changes.
 * V18.9 therefore reads the current PDF page geometry directly from THREE scene,
 * builds a lightweight EntityRegistry, then dispatches one async ready event.
 *
 * It avoids calling CADLayerKit.extractFromViewer inside the refresh path, so it
 * does not recreate the recursion from V18.4/V18.5.
 */

const VERSION = "V18.9";

const STATE = {
  installed: false,
  debug: false,
  timers: new Set(),
  runCount: 0,
  successCount: 0,
  emptyCount: 0,
  lastRun: null,
  lastGood: null,
  lastError: null,
  context: null,
  eventPage: null,
  cooldownUntil: 0,
  inDirectExtract: false,
  originalExtractFromViewer: null,
};

function log(...args) { if (STATE.debug) console.log(`[PdfGeometryRefreshBridge ${VERSION}]`, ...args); }
function info(...args) { console.info(`[PdfGeometryRefreshBridge ${VERSION}]`, ...args); }
function warn(...args) { console.warn(`[PdfGeometryRefreshBridge ${VERSION}]`, ...args); }

function getViewer() { return window.cadApp?.viewer || window.viewer || null; }
function getScene(viewer = getViewer()) { return viewer?.sceneManager?.scene || viewer?.scene || null; }
function getFileName() { return window.cadApp?.uploader?.file?.name || window.cadApp?.currentFileName || window.cadApp?.currentFile?.name || "active-file"; }
function getFileSize() { return window.cadApp?.uploader?.file?.size || window.cadApp?.currentFile?.size || 0; }
function getCurrentPage() {
  return Number(
    STATE.eventPage ||
    window.cadApp?._pdfCurrentPage ||
    window.cadApp?.pdfCurrentPage ||
    window.cadDrawingOverlay?.currentPage ||
    window.currentPdfPage ||
    1
  ) || 1;
}
function isPdfContext() { return /\.pdf$/i.test(String(getFileName() || "")); }
function getContext() { return `${getFileName()}|${getFileSize()}|page-${getCurrentPage()}`; }

function isGoodRaw(raw) {
  return !!raw && Array.isArray(raw.entities) && raw.entities.length > 0 && Array.isArray(raw.layers) && raw.layers.length > 0;
}

function installExtractViewerGuard() {
  // V18.9: do not wrap CADLayerKit.extractFromViewer.
  // The wrapper in V18.8 caused recursive loops:
  // extractFromViewer -> entity-registry-ready -> refreshLayerOptions -> extractFromViewer.
  // Direct PDF registry building is now event-based only.
  return false;
}

function clearTimers() {
  for (const id of STATE.timers) clearTimeout(id);
  STATE.timers.clear();
}

function schedule(reason = "unknown", delays = [900]) {
  if (!isPdfContext()) return;
  STATE.context = getContext();
  // V18.9 coalesces pending PDF geometry rebuilds.
  // A large PDF must not rebuild 5-8 times after file load/content recognition.
  clearTimers();
  const delay = Array.isArray(delays) && delays.length ? Number(delays[0]) || 900 : 900;
  const id = setTimeout(() => {
    STATE.timers.delete(id);
    runDirectExtract(reason, delay);
  }, delay);
  STATE.timers.add(id);
}

function runDirectExtract(reason = "manual", delay = 0) {
  if (!isPdfContext()) return getSummary();
  const scene = getScene();
  const context = getContext();
  STATE.runCount += 1;
  STATE.context = context;

  if (!scene) {
    STATE.lastRun = { ok: false, reason, delay, context, message: "scene-not-ready", at: new Date().toISOString() };
    return getSummary();
  }

  const currentStats = window.__essamEntityRegistry?.getStats?.() || null;
  const currentContext = window.__essamEntityRegistry?.context || window.__essamDocumentModel?.context || null;
  const isManual = reason === "manual" || /manual/i.test(String(reason));
  const hasGoodRegistryForContext = currentStats?.entityCount > 0 && currentStats?.layerCount > 0 && currentContext === context;
  if (!isManual && hasGoodRegistryForContext) {
    STATE.lastRun = { ok: true, skipped: true, reason, delay, context, message: "registry-already-ready-for-context", stats: currentStats, at: new Date().toISOString() };
    log("Skipped direct PDF extraction because registry is already good for this context", STATE.lastRun);
    return getSummary();
  }

  STATE.inDirectExtract = true;
  window.__essamPdfGeometryDirectExtractInProgress = true;
  try {
    const raw = legacyExtractFromScene(scene, {
      respectVisibility: false,
      maxSegments: 1_000_000,
      reason,
    });

    const ok = isGoodRaw(raw);
    STATE.lastRun = {
      ok,
      reason,
      delay,
      context,
      source: raw?.source,
      layerCount: raw?.layers?.length || 0,
      entityCount: raw?.entities?.length || 0,
      objectCount: raw?.stats?.objectCount || 0,
      at: new Date().toISOString(),
    };

    if (!ok) {
      STATE.emptyCount += 1;
      log("Direct PDF geometry extraction returned empty data", STATE.lastRun);
      return getSummary();
    }

    raw.__context = context;
    installRawAsRegistry(raw, reason);
    STATE.lastGood = raw;
    STATE.successCount += 1;
    STATE.cooldownUntil = Date.now() + 1600;
    info("Direct PDF geometry registry ready", STATE.lastRun);
  } catch (err) {
    STATE.lastError = { reason, delay, context, message: err?.message || String(err), stack: err?.stack || null, at: new Date().toISOString() };
    warn("Direct PDF geometry extraction failed", STATE.lastError);
  } finally {
    STATE.inDirectExtract = false;
    window.__essamPdfGeometryDirectExtractInProgress = false;
  }

  return getSummary();
}

function installRawAsRegistry(raw, reason) {
  const registry = createSimpleRegistry(raw, getContext());
  const documentModel = createSimpleDocumentModel(raw, registry, getContext());

  raw.entityRegistry = registry;
  raw.documentModel = documentModel;

  window.__essamEntityRegistry = registry;
  window.__essamDocumentModel = documentModel;

  const detail = {
    registry,
    entityRegistry: registry,
    documentModel,
    rawData: raw,
    source: raw.source || `pdf-direct-scene-${VERSION}`,
    reason,
    bridgeVersion: VERSION,
  };

  // Async dispatch avoids same-stack recursion.
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("cad:document-model-ready", { detail }));
    window.dispatchEvent(new CustomEvent("cad:entity-registry-ready", { detail }));
    window.dispatchEvent(new CustomEvent("cad:entity-registry-updated", { detail }));
  }, 0);
}

function createSimpleDocumentModel(raw, registry, context) {
  const layers = raw.layers.map((name) => ({ id: name, name, visible: true, locked: false, type: "lines" }));
  return {
    source: raw.source,
    context,
    layers,
    entities: raw.entities,
    registry,
    getStats() {
      return {
        layerCount: layers.length,
        entityCount: raw.entities.length,
        annotationCount: 0,
        source: raw.source,
        context,
      };
    },
  };
}

function createSimpleRegistry(raw, context) {
  let idCounter = 0;
  const entities = new Map();
  const layers = new Map();
  const selected = new Set();

  for (const name of raw.layers || []) {
    const layerName = String(name || "PDF_Geometry");
    layers.set(layerName, { id: layerName, name: layerName, entityCount: 0, visibleEntityCount: 0, visible: true, locked: false, type: "lines" });
  }

  for (const entity of raw.entities || []) {
    const layerName = String(entity.layer || "PDF_Geometry");
    if (!layers.has(layerName)) layers.set(layerName, { id: layerName, name: layerName, entityCount: 0, visibleEntityCount: 0, visible: true, locked: false, type: "lines" });
    const id = entity.id || `${layerName}__pdf_v18_8__${++idCounter}`;
    const next = {
      selected: false,
      visible: true,
      locked: false,
      deleted: false,
      selectable: true,
      editable: true,
      originalLayer: layerName,
      ...entity,
      id,
      layer: layerName,
      meta: { ...(entity.meta || {}), context, source: entity.meta?.source || raw.source },
    };
    entities.set(id, next);
  }

  rebuildLayerStats();

  function rebuildLayerStats() {
    for (const layer of layers.values()) {
      layer.entityCount = 0;
      layer.visibleEntityCount = 0;
    }
    for (const e of entities.values()) {
      const layerName = e.layer || "PDF_Geometry";
      if (!layers.has(layerName)) layers.set(layerName, { id: layerName, name: layerName, entityCount: 0, visibleEntityCount: 0, visible: true, locked: false, type: "lines" });
      const layer = layers.get(layerName);
      layer.entityCount += 1;
      if (e.deleted !== true && e.visible !== false) layer.visibleEntityCount += 1;
    }
  }

  const api = {
    source: raw.source,
    context,
    entities,
    layers,
    rebuildLayerStats,
    getAll({ includeDeleted = false } = {}) {
      return Array.from(entities.values()).filter((e) => includeDeleted || e.deleted !== true);
    },
    getById(id) { return entities.get(id) || null; },
    getByLayer(layerName, opts = {}) {
      return this.getAll(opts).filter((e) => String(e.layer || "") === String(layerName || ""));
    },
    getLayerNames() { return Array.from(layers.keys()); },
    findLayerId(name) { return layers.has(name) ? name : null; },
    listLayers() { return Array.from(layers.values()); },
    printLayerSummary() { const out = this.listLayers(); console.table(out); return out; },
    getFirstLayerEntities(limit = 5) { return this.getAll().slice(0, limit); },
    getSelected() { return Array.from(selected).map((id) => entities.get(id)).filter(Boolean); },
    clearSelection() { for (const id of selected) { const e = entities.get(id); if (e) e.selected = false; } selected.clear(); },
    select(id, value = true) { const e = entities.get(id); if (!e) return false; e.selected = value !== false; if (e.selected) selected.add(id); else selected.delete(id); return true; },
    toggleSelect(id) { const e = entities.get(id); if (!e) return false; return this.select(id, !e.selected); },
    hideEntity(id, hidden = true) { const e = entities.get(id); if (!e) return false; e.visible = hidden ? false : true; rebuildLayerStats(); return true; },
    deleteEntity(id, deleted = true) { const e = entities.get(id); if (!e) return false; e.deleted = deleted !== false; e.visible = deleted ? false : e.visible; selected.delete(id); e.selected = false; rebuildLayerStats(); return true; },
    moveEntityToLayer(id, layerName) { const e = entities.get(id); if (!e || !layerName) return false; e.layer = String(layerName); if (!layers.has(e.layer)) layers.set(e.layer, { id: e.layer, name: e.layer, entityCount: 0, visibleEntityCount: 0, visible: true, locked: false, type: "lines" }); rebuildLayerStats(); return true; },
    hideLayer(layerName, hidden = true) { for (const e of entities.values()) if (e.layer === layerName) e.visible = hidden ? false : true; rebuildLayerStats(); return true; },
    restoreAll() { for (const e of entities.values()) { e.layer = e.originalLayer || e.layer; e.visible = true; e.deleted = false; e.selected = false; } selected.clear(); rebuildLayerStats(); },
    exportState() { return { schema: `simple-pdf-registry-${VERSION}`, context, entities: this.getAll({ includeDeleted: true }).map((e) => ({ id: e.id, layer: e.layer, originalLayer: e.originalLayer, visible: e.visible !== false, deleted: e.deleted === true, selected: e.selected === true, locked: e.locked === true })) }; },
    restoreState(state) { if (!state?.entities) return false; for (const row of state.entities) { const e = entities.get(row.id); if (!e) continue; if (row.originalLayer) e.originalLayer = row.originalLayer; if (row.layer) e.layer = row.layer; e.visible = row.visible !== false; e.deleted = row.deleted === true; e.selected = row.selected === true; if (e.selected) selected.add(e.id); else selected.delete(e.id); } rebuildLayerStats(); return true; },
    getStats() {
      const all = Array.from(entities.values());
      const kindCounts = {};
      const classCounts = {};
      for (const e of all) {
        const kind = e.kind || "UNKNOWN";
        kindCounts[kind] = (kindCounts[kind] || 0) + 1;
        const cls = e.meta?.objectType || e.meta?.className || "PDF";
        classCounts[cls] = (classCounts[cls] || 0) + 1;
      }
      return {
        layerCount: layers.size,
        entityCount: all.filter((e) => e.deleted !== true).length,
        selectedCount: selected.size,
        kindCounts,
        classCounts,
        context,
        source: raw.source,
      };
    },
  };
  return api;
}

function legacyExtractFromScene(scene, opts = {}) {
  if (!scene) return { source: "pdf-direct-scene-empty", layers: [], entities: [] };
  const respectVisibility = opts.respectVisibility ?? false;
  const objects = collectDrawableObjects(scene, { respectVisibility });
  const rangesRaw = computeGlobalRangesWorld(objects, 20_000_000);
  const rangesAxis = toAxisRanges(rangesRaw);
  const plane = choosePlaneFromRanges(rangesRaw);
  const entities = [];
  const layerSet = new Set();
  const maxSegments = Number(opts.maxSegments || 1_000_000);

  for (const obj of objects) {
    if (entities.length >= maxSegments) break;
    const geometry = obj.geometry;
    const posAttr = geometry?.attributes?.position;
    const pos = posAttr?.array;
    if (!pos) continue;

    const layerName = resolveLayerName(obj);
    layerSet.add(layerName);
    const index = geometry.index;
    const isMesh = obj.isMesh || obj.type === "Mesh";
    const isLineSeg = obj.isLineSegments || obj.type === "LineSegments";
    const isLoop = obj.isLineLoop || obj.type === "LineLoop";

    if (isMesh) {
      if (index?.array) {
        const indices = index.array;
        for (let i = 0; i + 2 < indices.length && entities.length < maxSegments; i += 3) {
          extractSegment(obj, pos, indices[i], indices[i + 1], layerName, plane, entities);
          extractSegment(obj, pos, indices[i + 1], indices[i + 2], layerName, plane, entities);
          extractSegment(obj, pos, indices[i + 2], indices[i], layerName, plane, entities);
        }
      } else {
        const count = Math.floor(pos.length / 3);
        for (let i = 0; i + 2 < count && entities.length < maxSegments; i += 3) {
          extractSegment(obj, pos, i, i + 1, layerName, plane, entities);
          extractSegment(obj, pos, i + 1, i + 2, layerName, plane, entities);
          extractSegment(obj, pos, i + 2, i, layerName, plane, entities);
        }
      }
      continue;
    }

    if (index?.array) {
      const indices = index.array;
      if (isLineSeg) {
        for (let i = 0; i + 1 < indices.length && entities.length < maxSegments; i += 2) extractSegment(obj, pos, indices[i], indices[i + 1], layerName, plane, entities);
      } else {
        for (let i = 0; i + 1 < indices.length && entities.length < maxSegments; i++) extractSegment(obj, pos, indices[i], indices[i + 1], layerName, plane, entities);
        if (isLoop && indices.length > 2) extractSegment(obj, pos, indices[indices.length - 1], indices[0], layerName, plane, entities);
      }
    } else {
      const count = Math.floor(pos.length / 3);
      if (isLineSeg) {
        for (let i = 0; i + 1 < count && entities.length < maxSegments; i += 2) extractSegment(obj, pos, i, i + 1, layerName, plane, entities);
      } else {
        for (let i = 0; i + 1 < count && entities.length < maxSegments; i++) extractSegment(obj, pos, i, i + 1, layerName, plane, entities);
        if (isLoop && count > 2) extractSegment(obj, pos, count - 1, 0, layerName, plane, entities);
      }
    }
  }

  const layers = Array.from(layerSet).sort((a, b) => String(a).localeCompare(String(b)));
  return {
    source: `pdf-direct-scene-${VERSION}`,
    layers,
    entities,
    planeInfo: { chosenPlane: plane, ranges: rangesAxis, rangesAxis, rangesRaw },
    stats: { entities: entities.length, objectCount: objects.length, maxSegments },
  };
}

function collectDrawableObjects(scene, { respectVisibility }) {
  const out = [];
  const stack = [scene];
  const visited = new Set();
  while (stack.length) {
    const obj = stack.pop();
    if (!obj || typeof obj !== "object" || visited.has(obj)) continue;
    visited.add(obj);
    if (obj.children) stack.push(...obj.children);
    if (respectVisibility && obj.visible === false) continue;
    if (obj.userData?.__essamManagedEntityRender || obj.userData?.__essamCoreSelectionOverlay) continue;

    const hasPositions = !!obj.geometry?.attributes?.position?.array;
    const isDrawable = obj.isLine || obj.type === "Line" ||
      obj.isLineSegments || obj.type === "LineSegments" ||
      obj.isLineLoop || obj.type === "LineLoop" ||
      obj.isMesh || obj.type === "Mesh";

    if (hasPositions && isDrawable) out.push(obj);
  }
  return out;
}

function extractSegment(obj, posArray, idx1, idx2, layer, plane, entities) {
  const a = idx1 * 3;
  const b = idx2 * 3;
  if (a + 2 >= posArray.length || b + 2 >= posArray.length) return;
  const w1 = applyMatrixWorld(obj, posArray[a], posArray[a + 1], posArray[a + 2]);
  const w2 = applyMatrixWorld(obj, posArray[b], posArray[b + 1], posArray[b + 2]);
  pushValidSegment(w1, w2, layer, plane, entities, obj);
}

function pushValidSegment(w1, w2, layer, plane, entities, obj = null) {
  if (!isFinitePoint(w1) || !isFinitePoint(w2)) return;
  const dist = Math.hypot(w1.x - w2.x, w1.y - w2.y, w1.z - w2.z);
  if (dist < 0.001) return;
  const id = `${layer}__pdf_seg_${entities.length}_${roundKey(w1.x)}_${roundKey(w1.y)}_${roundKey(w2.x)}_${roundKey(w2.y)}`;
  entities.push({
    id,
    layer,
    kind: "LINE",
    points: [map3To2(w1, plane), map3To2(w2, plane)],
    meta: {
      source: `pdf-direct-scene-${VERSION}`,
      objectName: obj?.name || "",
      objectType: obj?.type || "",
      worldPoints: [w1, w2],
    },
  });
}

function resolveLayerName(obj) {
  const ud = obj?.userData || {};
  const n = ud.layer ?? ud.layerName ?? ud.dxfLayer ?? ud.name ?? obj?.name;
  return (typeof n === "string" && n.trim()) ? n.trim() : "PDF_Geometry";
}

function isFinitePoint(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z); }
function toAxisRanges(r) { return { x: { min: r.minX, max: r.maxX, range: r.maxX - r.minX }, y: { min: r.minY, max: r.maxY, range: r.maxY - r.minY }, z: { min: r.minZ, max: r.maxZ, range: r.maxZ - r.minZ } }; }
function choosePlaneFromRanges(r) { const rx = Math.abs(r.maxX - r.minX), ry = Math.abs(r.maxY - r.minY), rz = Math.abs(r.maxZ - r.minZ); return (rz <= rx && rz <= ry) ? "XY" : (ry <= rx && ry <= rz) ? "XZ" : "YZ"; }
function map3To2(v, plane) { return plane === "XY" ? { x: v.x, y: v.y } : plane === "XZ" ? { x: v.x, y: v.z } : { x: v.y, y: v.z }; }
function roundKey(n) { return (Math.round(Number(n || 0) * 1000) / 1000).toFixed(3).replace(/[^0-9\-]/g, "_"); }

function computeGlobalRangesWorld(objects, maxPoints) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let count = 0;
  for (const obj of objects) {
    const pos = obj?.geometry?.attributes?.position?.array;
    if (!pos) continue;
    const step = Math.max(3, Math.floor(pos.length / 1000) * 3);
    for (let k = 0; k + 2 < pos.length; k += step) {
      const w = applyMatrixWorld(obj, pos[k], pos[k + 1], pos[k + 2]);
      if (!isFinitePoint(w)) continue;
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
      if (++count > maxPoints) break;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, minZ, maxX, maxY, maxZ } : { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

function applyMatrixWorld(obj, x, y, z) {
  const m = obj?.matrixWorld?.elements;
  if (!m || m.length !== 16) return { x, y, z };
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

function onFileLoaded() {
  clearTimers();
  STATE.eventPage = 1;
  schedule("cad:file-loaded", [1200]);
}

function onPdfPageChanged(event) {
  const page = Number(event?.detail?.page || event?.detail?.pageNumber || 0);
  if (page) STATE.eventPage = page;
  clearTimers();
  // Give the PDF plugin and ContentRecognition time to swap page objects.
  schedule(`cad:pdf-page-changed:${page || getCurrentPage()}`, [1200]);
}

function onContentRecognitionReady(event) {
  const page = Number(event?.detail?.page || event?.detail?.pageNumber || 0);
  if (page) STATE.eventPage = page;
  schedule(`cad:content-recognition-ready:${page || getCurrentPage()}`, [800]);
}

function refreshNow() { return runDirectExtract("manual", 0); }
function setDebug(value = true) { STATE.debug = value === true; return getSummary(); }

function getSummary() {
  return {
    installed: STATE.installed,
    version: VERSION,
    debug: STATE.debug,
    context: getContext(),
    isPdfContext: isPdfContext(),
    runCount: STATE.runCount,
    successCount: STATE.successCount,
    emptyCount: STATE.emptyCount,
    cooldownMsLeft: Math.max(0, STATE.cooldownUntil - Date.now()),
    lastRun: STATE.lastRun,
    lastGood: STATE.lastGood ? {
      source: STATE.lastGood.source,
      context: STATE.lastGood.__context,
      layerCount: STATE.lastGood.layers?.length || 0,
      entityCount: STATE.lastGood.entities?.length || 0,
      stats: STATE.lastGood.stats || null,
    } : null,
    lastError: STATE.lastError,
    registryStats: window.__essamEntityRegistry?.getStats?.() || null,
  };
}

function install() {
  if (STATE.installed) return;
  STATE.installed = true;
  installExtractViewerGuard();
  window.addEventListener("cad:file-loaded", onFileLoaded);
  window.addEventListener("cad:pdf-page-changed", onPdfPageChanged);
  window.addEventListener("cad:content-recognition-ready", onContentRecognitionReady);

  const api = { getSummary, refreshNow, setDebug, scheduleNow: () => schedule("manual-schedule", [0]) };
  window.__essamPdfGeometryRefreshBridgeV18_9 = api;
  window.__essamPdfGeometryRefreshBridgeV18_8 = api;
  window.__essamPdfGeometryRefreshBridgeV18_7 = api;
  window.__essamPdfGeometryRefreshBridgeV18_6 = api;
  window.__essamPdfGeometryRefreshBridgeV18_5 = api;
  info("Installed direct PDF scene registry builder without extractFromViewer wrapper");
}

install();
