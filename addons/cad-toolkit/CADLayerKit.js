/**
 * CADLayerKit.js (v12 - Entity Decomposer + Registry)
 *
 * New principle:
 * 1) Use x-viewer's loaded model data first: model.layers + getObjectsByLayer().
 * 2) Only fall back to scene traversal when the model does not expose layer objects.
 * 3) Emit stable-ish entity ids and source metadata for the upcoming DocumentModel / SelectionEngine.
 */

import { ViewerModelAdapter } from "./core/ViewerModelAdapter.js";
import { DocumentModel } from "./core/DocumentModel.js";
import { ContentRecognition } from "./core/ContentRecognition.js";
import { EntityDecomposer } from "./core/EntityDecomposer.js";
import { EntityRegistry } from "./core/EntityRegistry.js";
import { LayerManager } from "./core/LayerManager.js";
import { SelectionEngine } from "./core/SelectionEngine.js";
import { ProjectState } from "./core/ProjectState.js";

console.log("✅ CADLayerKit V12 (Entity Decomposer + Registry) LOADED");

export const CADLayerKit = {
  extractFromViewer(viewer, opts = {}) {
    const respectVisibility = opts.respectVisibility ?? false;
    const adapter = new ViewerModelAdapter(viewer);
    const modelLayerData = adapter.collectLayerObjects({ respectVisibility });

    if (modelLayerData.stats.layerObjectCount > 0) {
      const result = this.extractFromLayerObjectMap(modelLayerData, opts);
      result.report = adapter.getModelReport();
      result.extractionSource = "model-layers";
      console.log(`[CADLayerKit V11] Source=model-layers | layers=${result.layers.length} | entities=${result.entities.length}`);
      return result;
    }

    const scene = viewer?.sceneManager?.scene || viewer?.scene || null;
    if (!scene) {
      console.error("CADLayerKit: no model layer objects and scene not found.");
      return emptyExtraction("none", adapter.getModelReport());
    }

    const result = this.extractFromScene(scene, opts);
    result.report = adapter.getModelReport();
    result.extractionSource = "scene-fallback";
    console.warn(`[CADLayerKit V11] Source=scene-fallback | layers=${result.layers.length} | entities=${result.entities.length}`);
    return result;
  },

  extractFromLayerObjectMap(modelLayerData, opts = {}) {
    const descriptors = [];
    const seen = new Set();

    for (const [layerName, objects] of modelLayerData.layerObjects.entries()) {
      const cleanLayer = cleanName(layerName);
      for (const obj of objects) {
        const key = `${cleanLayer}:${obj?.uuid || obj?.id || descriptors.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        descriptors.push({ obj, forcedLayer: cleanLayer, source: "model-layers" });
      }
    }

    const result = this.extractFromObjectDescriptors(descriptors, {
      ...opts,
      knownLayers: modelLayerData.layers,
      source: "model-layers",
      layerMeta: modelLayerData.layerMeta,
      modelCount: modelLayerData.stats.modelCount,
    });

    return result;
  },

  extractFromScene(scene, opts = {}) {
    const respectVisibility = opts.respectVisibility ?? true;
    const descriptors = collectObjects(scene, { respectVisibility }).map((obj) => ({
      obj,
      forcedLayer: null,
      source: "scene",
    }));

    return this.extractFromObjectDescriptors(descriptors, {
      ...opts,
      knownLayers: [],
      source: "scene",
      modelCount: 0,
    });
  },

  extractFromObjectDescriptors(descriptors, opts = {}) {
    const maxPoints = opts.maxPoints || 20_000_000;
    const source = opts.source || "unknown";
    const layerSet = new Set(Array.isArray(opts.knownLayers) ? opts.knownLayers.map(cleanName).filter(Boolean) : []);

    const objects = descriptors.map((d) => d.obj).filter(Boolean);
    const rangesRaw = computeGlobalRangesWorld(objects, maxPoints);
    const rangesAxis = toAxisRanges(rangesRaw);
    const plane = choosePlaneFromRanges(rangesRaw);

    const entities = [];
    const decompositionStats = {
      drawableObjects: descriptors.length,
      decomposedObjects: 0,
      pointCost: 0,
      lineObjects: 0,
      lineSegmentObjects: 0,
      meshObjects: 0,
      lineSegments: 0,
      meshEdges: 0,
      skippedObjects: 0,
    };
    let emittedPoints = 0;
    let objectIndex = 0;

    for (const descriptor of descriptors) {
      if (emittedPoints >= maxPoints) break;

      const obj = descriptor.obj;
      if (!obj?.geometry?.attributes?.position?.array) {
        decompositionStats.skippedObjects += 1;
        continue;
      }

      const layerName = cleanName(descriptor.forcedLayer || resolveLayerName(obj));
      layerSet.add(layerName);

      const objectId = getStableObjectId(obj, layerName, objectIndex++);
      const { entities: decomposed, stats } = EntityDecomposer.decomposeThreeObject({
        obj,
        layerName,
        plane,
        objectId,
        source,
        objectIndex,
        maxEntities: Math.max(0, Math.floor((maxPoints - emittedPoints) / 2)),
        userData: shallowSafeUserData(obj.userData),
      });

      if (!decomposed.length) {
        decompositionStats.skippedObjects += 1;
        continue;
      }

      entities.push(...decomposed);
      decompositionStats.decomposedObjects += 1;
      decompositionStats.pointCost += stats.pointCost || decomposed.length * 2;
      decompositionStats.lineObjects += stats.lineObjects || 0;
      decompositionStats.lineSegmentObjects += stats.lineSegmentObjects || 0;
      decompositionStats.meshObjects += stats.meshObjects || 0;
      decompositionStats.lineSegments += stats.lineSegments || 0;
      decompositionStats.meshEdges += stats.meshEdges || 0;
      emittedPoints += stats.pointCost || decomposed.length * 2;
    }

    // Merge secondary content recognition layers/entities.
    // This is especially useful when a PDF is exposed as one generic layer by the viewer.
    const recognition = getCachedContentRecognition();
    const recognizedEntities = EntityDecomposer.normalizeSemanticEntities(recognition.entities);
    if (recognizedEntities.length) {
      recognition.layers.forEach((name) => layerSet.add(cleanName(name)));
      entities.push(...recognizedEntities);
    }

    const layers = Array.from(layerSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const documentModel = DocumentModel.fromExtractedData(
      { layers, entities, source },
      {
        fileId: "active",
        fileName: window?.cadApp?.uploader?.file?.name || "Project",
        fileType: inferFileType(window?.cadApp?.uploader?.file?.name, source),
      }
    );

    const entityRegistry = new EntityRegistry(documentModel);
    // Apply autosaved edits before any UI/3D layer reads the model.
    // This keeps hidden/deleted/moved entities visible across LayerRulesPanel, 3D preview, and reloads.
    try { ProjectState.applyToRuntime({ registry: entityRegistry, documentModel, fileName: window?.cadApp?.uploader?.file?.name || window?.cadApp?.currentFileName || null }); } catch (_) {}
    const layerManager = new LayerManager(documentModel, entityRegistry);
    const selectionEngine = new SelectionEngine(entityRegistry);
    const registryStats = entityRegistry.getStats();

    const result = {
      layers,
      entities,
      documentModel,
      entityRegistry,
      layerManager,
      selectionEngine,
      planeInfo: { chosenPlane: plane, ranges: rangesAxis, rangesAxis, rangesRaw },
      stats: {
        source,
        models: opts.modelCount || 0,
        objects: descriptors.length,
        layers: layers.length,
        entities: entities.length,
        emittedPoints,
        decomposer: decompositionStats,
        registry: registryStats,
        recognizedText: recognition.report?.textCount || 0,
        recognizedImages: recognition.report?.imageCount || 0,
      },
    };

    try {
      window.__essamDocumentModel = documentModel;
      window.__essamEntityRegistry = entityRegistry;
      window.__essamLayerManager = layerManager;
      window.__essamSelectionEngine = selectionEngine;
      window.dispatchEvent(new CustomEvent("cad:document-model-ready", { detail: { documentModel, extraction: result } }));
      window.dispatchEvent(new CustomEvent("cad:entity-registry-ready", { detail: { entityRegistry, layerManager, selectionEngine, stats: registryStats, extraction: result } }));
      console.log(`[CADLayerKit V12] EntityRegistry ready | layers=${registryStats.layerCount} | entities=${registryStats.entityCount}`, registryStats);
    } catch (_) {}

    return result;
  },
};

function getCachedContentRecognition() {
  try {
    const layers = ContentRecognition.getCachedLayers?.() || [];
    const entities = ContentRecognition.getCachedEntities?.() || [];
    const report = ContentRecognition.getCached?.()?.report || {};
    return { layers, entities, report };
  } catch (_) {
    return { layers: [], entities: [], report: {} };
  }
}


function emptyExtraction(source = "none", report = null) {
  return {
    layers: [],
    entities: [],
    documentModel: new DocumentModel(),
    planeInfo: { chosenPlane: "XY", ranges: {}, rangesAxis: {}, rangesRaw: {} },
    stats: { source, models: 0, objects: 0, layers: 0, entities: 0, emittedPoints: 0 },
    report,
    extractionSource: source,
  };
}

function extractSegment(obj, posArray, idx1, idx2, layer, plane, entities, meta = {}) {
  const a = idx1 * 3;
  const b = idx2 * 3;
  if (a + 2 >= posArray.length || b + 2 >= posArray.length) return;

  const w1 = applyMatrixWorld(obj, posArray[a], posArray[a + 1], posArray[a + 2]);
  const w2 = applyMatrixWorld(obj, posArray[b], posArray[b + 1], posArray[b + 2]);
  pushValidSegment(w1, w2, layer, plane, entities, meta);
}

function pushValidSegment(w1, w2, layer, plane, entities, meta = {}) {
  if (!isFinite(w1.x) || !isFinite(w1.y) || !isFinite(w2.x) || !isFinite(w2.y)) return;
  const dist = Math.hypot(w1.x - w2.x, w1.y - w2.y, w1.z - w2.z);
  if (dist < 0.001) return;

  const p1 = map3To2(w1, plane);
  const p2 = map3To2(w2, plane);
  const segmentIndex = meta.segmentIndex ?? entities.length;
  const id = makeEntityId(layer, meta.objectId, segmentIndex, p1, p2);

  entities.push({
    id,
    sourceId: meta.objectId || id,
    layer,
    kind: "LINE",
    points: [p1, p2],
    bbox: {
      minX: Math.min(p1.x, p2.x),
      minY: Math.min(p1.y, p2.y),
      maxX: Math.max(p1.x, p2.x),
      maxY: Math.max(p1.y, p2.y),
    },
    source: meta.source || "unknown",
    meta: {
      objectId: meta.objectId || null,
      segmentIndex,
      objectType: meta.objectType || null,
      modelId: meta.modelId || null,
      sourceType: meta.sourceType || null,
      userData: meta.userData || {},
    },
  });
}

// --- Store ---
export const LayerRulesStore = {
  key(projectId) { return `cad-layer-rules:${projectId || "active"}`; },
  load(projectId = "active") { try { return JSON.parse(localStorage.getItem(this.key(projectId)) || "{}"); } catch { return {}; } },
  save(projectId = "active", rules = {}) { try { localStorage.setItem(this.key(projectId), JSON.stringify(rules || {})); } catch {} },
  ensureDefaults(layers = [], existing = {}) {
    const out = { ...(existing || {}) };
    for (const name of layers) {
      if (!out[name]) out[name] = { type: "lines", thickness: 0.2, height: 3.0, elevation: 0.0, visible: true };
      else {
        if (!out[name].type) out[name].type = "lines";
        if (out[name].visible === undefined) out[name].visible = true;
      }
    }
    return out;
  },
};

function collectObjects(scene, { respectVisibility }) {
  const out = [];
  const stack = [scene];
  const visited = new Set();
  while (stack.length) {
    const obj = stack.pop();
    if (!obj || typeof obj !== "object" || visited.has(obj)) continue;
    visited.add(obj);
    if (respectVisibility && obj.visible === false) continue;
    if (obj.children) stack.push(...obj.children);

    if (
      obj.isLine || obj.type === "Line" ||
      obj.isLineSegments || obj.type === "LineSegments" ||
      obj.isLineLoop || obj.type === "LineLoop" ||
      obj.isMesh || obj.type === "Mesh"
    ) {
      if (obj.geometry?.attributes?.position?.array) out.push(obj);
    }
  }
  return out;
}

function resolveLayerName(obj) {
  const ud = obj?.userData;
  const n = ud?.layer ?? ud?.layerName ?? ud?.dxfLayer ?? ud?.name ?? obj?.name;
  return cleanName(n || "0");
}

function cleanName(value) {
  const out = String(value ?? "0").trim();
  return out || "0";
}

function getStableObjectId(obj, layerName, index) {
  const ud = obj?.userData || {};
  const raw = ud.UniqueId ?? ud.uniqueId ?? ud.handle ?? ud.id ?? ud.sourceId ?? obj.uuid ?? obj.id ?? index;
  return `${safeId(layerName)}__obj_${safeId(raw)}`;
}

function makeEntityId(layerName, objectId, segmentIndex, p1, p2) {
  const a = `${roundId(p1.x)}_${roundId(p1.y)}_${roundId(p2.x)}_${roundId(p2.y)}`;
  return `${safeId(layerName)}__${safeId(objectId || "obj")}__s${segmentIndex}_${safeId(a)}`;
}

function roundId(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function safeId(value) {
  return String(value ?? "x").replace(/[^a-zA-Z0-9_\u0600-\u06FF-]+/g, "_").slice(0, 120);
}

function shallowSafeUserData(userData = {}) {
  const out = {};
  const keys = ["layer", "layerName", "dxfLayer", "name", "modelId", "UniqueId", "uniqueId", "handle", "type", "sourceType"];
  for (const key of keys) {
    const value = userData?.[key];
    if (value === null || value === undefined) continue;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") out[key] = value;
  }
  return out;
}

function inferFileType(fileName = "", source = "") {
  const n = String(fileName || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".dxf")) return "dxf";
  if (n.endsWith(".dwg")) return "dwg";
  return source || "unknown";
}

function toAxisRanges(r) {
  return {
    x: { min: r.minX, max: r.maxX, range: r.maxX - r.minX },
    y: { min: r.minY, max: r.maxY, range: r.maxY - r.minY },
    z: { min: r.minZ, max: r.maxZ, range: r.maxZ - r.minZ },
  };
}

function choosePlaneFromRanges(r) {
  const rx = Math.abs(r.maxX - r.minX);
  const ry = Math.abs(r.maxY - r.minY);
  const rz = Math.abs(r.maxZ - r.minZ);
  return (rz <= rx && rz <= ry) ? "XY" : (ry <= rx && ry <= rz) ? "XZ" : "YZ";
}

function map3To2(v, plane) {
  return plane === "XY" ? { x: v.x, y: v.y } : plane === "XZ" ? { x: v.x, y: v.z } : { x: v.y, y: v.z };
}

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
      if (!isFinite(w.x) || !isFinite(w.y) || !isFinite(w.z)) continue;
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
      if (++count > maxPoints) break;
    }
  }

  return isFinite(minX) ? { minX, minY, minZ, maxX, maxY, maxZ } : { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
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
