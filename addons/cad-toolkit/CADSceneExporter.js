/**
 * CADSceneExporter.js
 * V31 Manual Dropdown Restore + Light Fix
 *
 * Goal:
 * - Keep the source reading / EntityRegistry untouched.
 * - Reduce the time spent when moving from 2D to 3D.
 * - Avoid O(n²) strict merge on huge PDF/CAD layers.
 * - Cache repeated 3D exports for the same file/page/rules/edit state.
 * - Remove exact duplicate segments in the 3D ViewModel only.
 *
 * This file only changes the 3D export/view model stage.
 */
console.log("✅ CADSceneExporter V31 (Manual Dropdown Restore + Light Fix) LOADED");

const VERSION = "V31";
const DEFAULTS = {
  fastMergeThreshold: 1800,
  massiveLayerThreshold: 8000,
  cacheMaxEntries: 3,
  simplifyTolerance: 0.00005,
  endpointPrecision: 10000,
  enableDuplicateRemoval: true,
  enableCache: true,
  // Huge PDF files often contain thousands of plain drafting lines that SceneBuilder does not render in 3D.
  // Skipping them here reduces the transfer from 2D registry to 3D view model without touching source data.
  skipPlainLineLayersIn3D: false,
  // Plain/drafting/text/image layers are hidden by default in 3D, but not removed forever.
  // Set rule.visible3D = true from Layer3DVisibilityPatch/UI to include them in 3D export.
  enableManualVisible3DOverride: false,
  mergeAllMassiveBuildableLayers: true,
  plainLineLayerTypes: ["lines", "line", "default", "annotation", "text", "image"],
  debug: false,
};

const runtime = {
  cache: new Map(),
  lastExport: null,
  lastCacheHit: null,
  counters: {
    exports: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rawIn: 0,
    filteredIn: 0,
    processedOut: 0,
    sceneEntities: 0,
    duplicateSegmentsRemoved: 0,
    fastMergeLayers: 0,
    strictMergeLayers: 0,
    noMergeLayers: 0,
  },
  timings: {
    lastTotalMs: 0,
    lastFilterMs: 0,
    lastProcessMs: 0,
    lastBuildMs: 0,
    lastMergeMs: 0,
  },
  config: { ...DEFAULTS },
};

function now() { return performance?.now?.() || Date.now(); }
function rnd5(n) { return Math.round(n * 100000) / 100000; }
function roundBy(n, precision = runtime.config.endpointPrecision) { return Math.round(Number(n || 0) * precision) / precision; }
function pointKey(p) { return `${roundBy(p.x)},${roundBy(p.y)}`; }
function segmentKey(a, b) {
  const ka = pointKey(a), kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
function cloneSmall(obj) { try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; } }

function getCurrentFile() {
  return window.cadApp?.uploader?.file || window.cadApp?.currentFile || window.cadApp?.file || null;
}
function getPdfPage() {
  const candidates = [window.cadApp?.pdfPage, window.cadApp?.currentPage, window.cadApp?.currentPdfPage, window.cadDrawingOverlay?.currentPage, window.cadDrawingOverlay?.pageNumber];
  for (const value of candidates) { const n = Number(value); if (Number.isFinite(n) && n > 0) return n; }
  return 1;
}
function getContextKey(metaData = {}) {
  const f = getCurrentFile();
  const name = metaData.fileName || f?.name || window.cadApp?.fileName || "Project";
  const size = f?.size || 0;
  return `${name}|${size}|page-${getPdfPage()}`;
}
function compactRulesFingerprint(layerRules = {}) {
  const entries = Object.entries(layerRules || {}).map(([layer, r]) => [
    layer,
    r?.type || "lines",
    r?.visible !== false,
    Number(r?.height || 0),
    Number(r?.thickness || 0),
    Number(r?.elevation || 0),
    !!r?.hasCeiling,
    Number(r?.intensity || 0),
    Number(r?.range || 0),
    Number(r?.lightSpacing || 0),
  ]);
  entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify(entries);
}
function registryEditFingerprint() {
  const registry = window.__essamEntityRegistry;
  const all = registry?.getAll?.({ includeDeleted: true }) || [];
  let deleted = 0, hidden = 0, moved = 0, locked = 0;
  for (const e of all) {
    if (!e) continue;
    if (e.deleted === true) deleted += 1;
    if (e.visible === false) hidden += 1;
    const originalLayer = e.originalLayer || e.meta?.originalLayer || e.meta?.layer || null;
    if (originalLayer && e.layer && String(originalLayer) !== String(e.layer)) moved += 1;
    if (e.locked === true) locked += 1;
  }
  return `${all.length}|d${deleted}|h${hidden}|m${moved}|l${locked}`;
}
function makeCacheKey(rawEntities, layerRules, metaData) {
  return [
    getContextKey(metaData),
    rawEntities?.length || 0,
    metaData?.scale || 0.001,
    registryEditFingerprint(),
    compactRulesFingerprint(layerRules),
  ].join("::");
}
function rememberCache(key, scene) {
  if (!runtime.config.enableCache) return;
  runtime.cache.set(key, { scene, at: Date.now(), summary: { entities: scene?.entities?.length || 0 } });
  while (runtime.cache.size > runtime.config.cacheMaxEntries) {
    const first = runtime.cache.keys().next().value;
    runtime.cache.delete(first);
  }
}
function getCached(key) {
  if (!runtime.config.enableCache) return null;
  const item = runtime.cache.get(key);
  if (!item) return null;
  runtime.counters.cacheHits += 1;
  runtime.lastCacheHit = { key, at: new Date().toISOString(), summary: item.summary };
  return item.scene;
}
function ruleAllows3D(rule) {
  if (!rule) return true;
  if (rule.visible === false || rule.type === "hide") return false;
  return true;
}
function normalizeRuleType(rule) {
  const t = String(rule?.type || "lines").toLowerCase();
  if (t === "light") return "lights";
  if (t === "beam") return "beams";
  if (t === "wall") return "walls";
  if (t === "column") return "columns";
  return t;
}
function isLightRule(rule) { return normalizeRuleType(rule) === "lights" || rule?.isLight === true; }
function ruleBuilds3D(rule) {
  // V30: 3D visibility is controlled by the existing layer type dropdown.
  // If the dropdown value is Hide, the layer is skipped.
  // If the user changes it to Lines / Walls / Glass / etc, it is included.
  return ruleAllows3D(rule);
}
function isMassiveBuildableMergeType(rule) {
  const type = normalizeRuleType(rule);
  if (type === "door" || type === "opening" || type === "lights") return false;
  return true;
}
function ruleNeedsSmartMerge(rule) {
  if (!rule) return false;
  const type = normalizeRuleType(rule);
  return type === "walls" || type === "floor" || type === "ceiling" || type === "glass" || type === "beams";
}
function simplifyPolyline(points, tolerance = runtime.config.simplifyTolerance) {
  if (!Array.isArray(points) || points.length <= 2 || tolerance <= 0) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    if (area / len > tolerance) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export const CADSceneExporter = {
  version: VERSION,

  export(rawEntities, layerRules, metaData = {}) {
    const tTotal = now();
    runtime.counters.exports += 1;
    runtime.counters.rawIn = Array.isArray(rawEntities) ? rawEntities.length : 0;

    const cacheKey = makeCacheKey(rawEntities || [], layerRules || {}, metaData || {});
    const cached = getCached(cacheKey);
    if (cached) {
      runtime.lastExport = {
        version: VERSION,
        cacheHit: true,
        rawIn: rawEntities?.length || 0,
        sceneEntities: cached.entities?.length || 0,
        totalMs: 0,
        at: new Date().toISOString(),
      };
      console.log(`⚡ CADSceneExporter ${VERSION} cache hit: ${cached.entities?.length || 0} entities`);
      return cached;
    }
    runtime.counters.cacheMisses += 1;

    console.log(`🚀 Starting Export ${VERSION}...`);
    const scale = metaData.scale || 0.001;
    const rnd = (n) => rnd5(n);

    const tProcess = now();
    const { processedEntities, centerOffset, stats: processStats } = this.processAndMerge(rawEntities || [], layerRules || {}, scale, rnd);
    runtime.timings.lastProcessMs = Math.round(now() - tProcess);

    const tBuild = now();
    const sceneJson = {
      schema: "cad3d-scene@1",
      meta: {
        name: metaData.fileName || "Project",
        exporterVersion: VERSION,
        context: getContextKey(metaData),
        performance: processStats,
      },
      settings: {
        sunIntensity: metaData.sunIntensity !== undefined ? metaData.sunIntensity : 1.0,
        scale,
        fast3d: true,
      },
      units: { metersPerCadUnit: scale, originShift: centerOffset },
      materials: this.getDefaultMaterials(),
      rulesByLayer: {},
      entities: [],
    };

    for (const [k, v] of Object.entries(layerRules || {})) {
      sceneJson.rulesByLayer[k] = { type: normalizeRuleType(v), overrides: { ...v, type: normalizeRuleType(v) } };
    }

    let idCounter = 1;
    for (const item of processedEntities) {
      const rule = layerRules?.[item.layer] || { type: "lines" };
      const type = normalizeRuleType(rule);
      if (!ruleBuilds3D(rule)) continue;

      const common = {
        id: `E_${idCounter++}`,
        layer: item.layer,
        points: item.points,
        closed: item.closed,
      };

      if (type === "lights") {
        sceneJson.entities.push({ ...common, kind: "POLYLINE", isLightShape: true });
      } else if (type === "door" || type === "opening") {
        if (item.points.length >= 2) {
          const pFirst = item.points[0];
          const pLast = item.points[item.points.length - 1];
          sceneJson.entities.push({
            id: `OP_${idCounter++}`,
            layer: item.layer,
            kind: "OPENING",
            openingKind: "door",
            p0: pFirst,
            p1: pLast,
            sill: rule.elevation || 0,
            height: rule.height || 2.1,
          });
        }
      } else {
        sceneJson.entities.push({ ...common, kind: "POLYLINE" });
        if (type === "walls" && item.closed && item.points.length > 2 && rule.hasCeiling) {
          sceneJson.entities.push({
            id: `AC_${idCounter++}`,
            layer: "AUTO_CEIL",
            kind: "DERIVED_FROM",
            sourceEntityId: common.id,
            derivedKind: "ceilingFromLoop",
            overrides: { elevation: rule.height, thickness: 0.1, material: "ceiling" },
          });
        }
      }
    }

    runtime.timings.lastBuildMs = Math.round(now() - tBuild);
    runtime.timings.lastTotalMs = Math.round(now() - tTotal);
    runtime.counters.processedOut = processedEntities.length;
    runtime.counters.sceneEntities = sceneJson.entities.length;
    runtime.lastExport = {
      version: VERSION,
      cacheHit: false,
      rawIn: rawEntities?.length || 0,
      filteredIn: processStats.filteredIn,
      processedOut: processedEntities.length,
      sceneEntities: sceneJson.entities.length,
      timings: { ...runtime.timings },
      processStats,
      at: new Date().toISOString(),
    };

    rememberCache(cacheKey, sceneJson);
    console.log(`✅ Exported ${sceneJson.entities.length} entities with Sun: ${sceneJson.settings.sunIntensity} | ${runtime.timings.lastTotalMs}ms`, processStats);
    return sceneJson;
  },

  processAndMerge(rawEntities, layerRules, scale, rnd) {
    const tFilter = now();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const layerGroups = {};
    const stats = {
      rawIn: rawEntities.length,
      filteredIn: 0,
      skippedNoPoints: 0,
      skippedRules: 0,
      duplicateSegmentsRemoved: 0,
      fastMergeLayers: 0,
      strictMergeLayers: 0,
      noMergeLayers: 0,
      massiveLayers: [],
    };

    // First pass: filter early and compute bounds. This avoids building huge allPoints arrays.
    for (const e of rawEntities) {
      if (!e || !Array.isArray(e.points) || e.points.length < 2) { stats.skippedNoPoints += 1; continue; }
      const layer = e.layer || "0";
      const rule = layerRules?.[layer] || { type: "lines" };
      if (!ruleBuilds3D(rule)) { stats.skippedRules += 1; continue; }

      let pts = [];
      for (const p of e.points) {
        const x = Number(p.x) * scale;
        const y = Number(p.y) * scale;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pts.push({ x, y });
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (pts.length < 2) { stats.skippedNoPoints += 1; continue; }
      if (!layerGroups[layer]) layerGroups[layer] = [];
      layerGroups[layer].push(pts);
      stats.filteredIn += 1;
    }

    runtime.timings.lastFilterMs = Math.round(now() - tFilter);
    runtime.counters.filteredIn = stats.filteredIn;

    if (!Number.isFinite(minX)) return { processedEntities: [], centerOffset: { x: 0, y: 0 }, stats };

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const finalEntities = [];
    const tMerge = now();

    for (const [layer, segments] of Object.entries(layerGroups)) {
      const rule = layerRules?.[layer] || { type: "lines" };
      const type = normalizeRuleType(rule);
      const shiftedSegments = [];
      const seen = new Set();
      let dupRemoved = 0;

      for (const seg of segments) {
        const shifted = seg.map((p) => ({ x: rnd(p.x - cx), y: rnd(p.y - cy) }));
        const compact = simplifyPolyline(shifted);
        if (runtime.config.enableDuplicateRemoval && compact.length === 2) {
          const key = segmentKey(compact[0], compact[1]);
          if (seen.has(key)) { dupRemoved += 1; continue; }
          seen.add(key);
        }
        shiftedSegments.push(compact);
      }

      stats.duplicateSegmentsRemoved += dupRemoved;
      runtime.counters.duplicateSegmentsRemoved += dupRemoved;
      if (shiftedSegments.length > runtime.config.massiveLayerThreshold) {
        stats.massiveLayers.push({ layer, count: shiftedSegments.length, type: rule.type || "lines" });
      }

      if (ruleNeedsSmartMerge(rule) || (runtime.config.mergeAllMassiveBuildableLayers && isMassiveBuildableMergeType(rule) && shiftedSegments.length > runtime.config.fastMergeThreshold)) {
        if (shiftedSegments.length > runtime.config.fastMergeThreshold) {
          stats.fastMergeLayers += 1;
          runtime.counters.fastMergeLayers += 1;
          const merged = this.mergeSegmentsFast(shiftedSegments, 0.001);
          for (const m of merged) finalEntities.push({ layer, points: m.points, closed: m.closed });
        } else {
          stats.strictMergeLayers += 1;
          runtime.counters.strictMergeLayers += 1;
          const merged = this.mergeSegmentsStrict(shiftedSegments, 0.001);
          for (const m of merged) finalEntities.push({ layer, points: m.points, closed: m.closed });
        }
      } else {
        stats.noMergeLayers += 1;
        runtime.counters.noMergeLayers += 1;
        for (const s of shiftedSegments) finalEntities.push({ layer, points: s, closed: false });
      }
    }

    runtime.timings.lastMergeMs = Math.round(now() - tMerge);
    return { processedEntities: finalEntities, centerOffset: { x: cx, y: cy }, stats };
  },

  mergeSegmentsFast(segments, tolerance = 0.001) {
    if (!segments.length) return [];
    const precision = Math.max(10, Math.round(1 / Math.max(tolerance, 0.00001)));
    const keyOf = (p) => `${Math.round(p.x * precision) / precision},${Math.round(p.y * precision) / precision}`;
    const pool = segments.map((pts) => ({ pts: [...pts], used: false }));
    const endpointMap = new Map();

    const addEndpoint = (key, index) => {
      let list = endpointMap.get(key);
      if (!list) { list = []; endpointMap.set(key, list); }
      list.push(index);
    };

    for (let i = 0; i < pool.length; i++) {
      const pts = pool[i].pts;
      addEndpoint(keyOf(pts[0]), i);
      addEndpoint(keyOf(pts[pts.length - 1]), i);
    }

    const findNext = (endpointKey, currentIndex) => {
      const list = endpointMap.get(endpointKey) || [];
      for (const idx of list) {
        if (idx !== currentIndex && !pool[idx].used) return idx;
      }
      return -1;
    };

    const results = [];
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].used) continue;
      pool[i].used = true;
      let polyline = [...pool[i].pts];

      // Extend tail.
      let guard = 0;
      while (guard++ < pool.length) {
        const tail = polyline[polyline.length - 1];
        const idx = findNext(keyOf(tail), i);
        if (idx < 0) break;
        const s = pool[idx];
        const hKey = keyOf(s.pts[0]);
        const tKey = keyOf(s.pts[s.pts.length - 1]);
        const tailKey = keyOf(tail);
        pool[idx].used = true;
        if (hKey === tailKey) polyline.push(...s.pts.slice(1));
        else if (tKey === tailKey) polyline.push(...[...s.pts].reverse().slice(1));
        else break;
      }

      // Extend head.
      guard = 0;
      while (guard++ < pool.length) {
        const head = polyline[0];
        const idx = findNext(keyOf(head), i);
        if (idx < 0) break;
        const s = pool[idx];
        const hKey = keyOf(s.pts[0]);
        const tKey = keyOf(s.pts[s.pts.length - 1]);
        const headKey = keyOf(head);
        pool[idx].used = true;
        if (tKey === headKey) polyline.unshift(...s.pts.slice(0, -1));
        else if (hKey === headKey) polyline.unshift(...[...s.pts].reverse().slice(0, -1));
        else break;
      }

      let closed = this.dist(polyline[0], polyline[polyline.length - 1]) < tolerance;
      if (closed) polyline[polyline.length - 1] = { ...polyline[0] };
      results.push({ points: simplifyPolyline(polyline), closed });
    }
    return results;
  },

  mergeSegmentsStrict(segments, tolerance) {
    if (segments.length === 0) return [];
    let pool = segments.map((pts) => ({ pts: [...pts], used: false }));
    const results = [];
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].used) continue;
      pool[i].used = true;
      let polyline = [...pool[i].pts];
      let modified = true;
      while (modified) {
        modified = false;
        const head = polyline[0];
        const tail = polyline[polyline.length - 1];
        for (let j = 0; j < pool.length; j++) {
          if (pool[j].used) continue;
          const s = pool[j];
          const sHead = s.pts[0];
          const sTail = s.pts[s.pts.length - 1];
          if (this.dist(tail, sHead) < tolerance) {
            polyline.push(...s.pts.slice(1)); s.used = true; modified = true; break;
          } else if (this.dist(tail, sTail) < tolerance) {
            polyline.push(...s.pts.reverse().slice(1)); s.used = true; modified = true; break;
          } else if (this.dist(head, sTail) < tolerance) {
            polyline.unshift(...s.pts.slice(0, -1)); s.used = true; modified = true; break;
          } else if (this.dist(head, sHead) < tolerance) {
            polyline.unshift(...s.pts.reverse().slice(0, -1)); s.used = true; modified = true; break;
          }
        }
      }
      let closed = this.dist(polyline[0], polyline[polyline.length - 1]) < tolerance;
      if (closed) polyline[polyline.length - 1] = { ...polyline[0] };
      results.push({ points: simplifyPolyline(polyline), closed });
    }
    return results;
  },

  dist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); },

  getDefaultMaterials() {
    return {
      wall: { color: "#eeeeee", roughness: 0.8 },
      floor: { color: "#cccccc", roughness: 0.9 },
      ceiling: { color: "#ffffff", roughness: 0.9 },
      beam: { color: "#aaaaaa", roughness: 0.7 },
      glass: { color: "#88ccff", alpha: 0.35, roughness: 0.1 },
      light: { color: "#ffffdd", emissive: 1.5 },
      lines: { color: "#333333" },
    };
  },

  groupByLayer(arr) {
    const g = {};
    arr.forEach((i) => { if (!g[i.layer]) g[i.layer] = []; g[i.layer].push(i); });
    return g;
  },

  clearCache() {
    runtime.cache.clear();
    return this.getPerformanceSummary();
  },

  setPerformanceConfig(next = {}) {
    Object.assign(runtime.config, next || {});
    runtime.cache.clear();
    return this.getPerformanceSummary();
  },

  getPerformanceSummary() {
    return {
      installed: true,
      version: VERSION,
      config: { ...runtime.config },
      cacheSize: runtime.cache.size,
      counters: { ...runtime.counters },
      timings: { ...runtime.timings },
      lastExport: runtime.lastExport,
      lastCacheHit: runtime.lastCacheHit,
    };
  },
};

try {
  window.CADSceneExporter = CADSceneExporter;
  window.__essamCADSceneExporterV31 = CADSceneExporter;
  window.__essamCADSceneExporterV30 = CADSceneExporter; // backward alias
  window.__essamCADSceneExporterV29 = CADSceneExporter; // backward alias
  window.__essamCADSceneExporterV28 = CADSceneExporter; // backward alias
} catch (_) {}
