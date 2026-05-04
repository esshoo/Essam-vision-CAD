/**
 * CADLayerKit.js (v9 - The Missing Wall Fix)
 * - Adds support for MESHES (Thick Polylines).
 * - Extracts edges from meshes to ensure thick walls appear.
 * - Retains high limits (20M points) and loop support.
 */

console.log("✅ CADLayerKit V9 (Mesh Support) LOADED");

export const CADLayerKit = {
  extractFromViewer(viewer, opts = {}) {
    const scene = viewer?.sceneManager?.scene || viewer?.scene || null;
    if (!scene) {
        console.error("CADLayerKit: Scene not found!");
        return { layers: [], entities: [] };
    }
    return this.extractFromScene(scene, opts);
  },

  extractFromScene(scene, opts = {}) {
    const respectVisibility = opts.respectVisibility ?? true;
    
    // 1. تجميع الكائنات (خطوط + مجسمات الآن)
    const objects = collectObjects(scene, { respectVisibility });
    
    // 2. حساب الحدود
    const rangesRaw = computeGlobalRangesWorld(objects, 20_000_000); 
    const rangesAxis = toAxisRanges(rangesRaw);
    const plane = choosePlaneFromRanges(rangesRaw);

    const entities = [];
    const layerSet = new Set();
    
    const maxPoints = 20_000_000; 
    let emittedPoints = 0;

    // 3. حلقة الاستخراج الشاملة
    for (const obj of objects) {
      if (emittedPoints >= maxPoints) break;

      const geometry = obj.geometry;
      const posAttr = geometry?.attributes?.position;
      if (!posAttr || !posAttr.array) continue;

      const pos = posAttr.array;
      const layerName = resolveLayerName(obj);
      layerSet.add(layerName);

      const index = geometry.index;
      const isMesh = obj.isMesh || obj.type === 'Mesh';

      // --- معالجة المجسمات (الحوائط السميكة) ---
      if (isMesh) {
          // المجسمات تتكون من مثلثات (3 رؤوس لكل وجه)
          // سنقوم باستخراج أضلاع المثلثات كخطوط
          if (index && index.array) {
              const indices = index.array;
              for (let i = 0; i < indices.length; i += 3) {
                  // المثلث: a-b-c
                  const a = indices[i];
                  const b = indices[i+1];
                  const c = indices[i+2];
                  // نستخرج 3 خطوط من كل مثلث لضمان ظهور الحدود
                  extractSegment(obj, pos, a, b, layerName, plane, entities);
                  extractSegment(obj, pos, b, c, layerName, plane, entities);
                  extractSegment(obj, pos, c, a, layerName, plane, entities);
                  emittedPoints += 6;
              }
          } else {
              // مجسم بدون فهرس (رؤوس متتالية)
              for (let i = 0; i < pos.length / 3; i += 3) {
                  extractSegment(obj, pos, i, i+1, layerName, plane, entities);
                  extractSegment(obj, pos, i+1, i+2, layerName, plane, entities);
                  extractSegment(obj, pos, i+2, i, layerName, plane, entities);
                  emittedPoints += 6;
              }
          }
          continue; // انتهينا من هذا المجسم
      }

      // --- معالجة الخطوط العادية (كما في V8) ---
      const isLineSeg = (obj.isLineSegments || obj.type === "LineSegments");
      const isLoop = (obj.isLineLoop || obj.type === "LineLoop");
      
      if (index && index.array) {
        const indices = index.array;
        if (isLineSeg) {
            for (let i = 0; i < indices.length; i += 2) {
                if (i + 1 >= indices.length) break;
                extractSegment(obj, pos, indices[i], indices[i+1], layerName, plane, entities);
                emittedPoints += 2;
            }
        } else {
            for (let i = 0; i < indices.length - 1; i++) {
                extractSegment(obj, pos, indices[i], indices[i+1], layerName, plane, entities);
                emittedPoints += 2;
            }
            if (isLoop && indices.length > 2) {
                extractSegment(obj, pos, indices[indices.length-1], indices[0], layerName, plane, entities);
                emittedPoints += 2;
            }
        }
      } else {
        if (isLineSeg) {
            for (let k = 0; k + 5 < pos.length; k += 6) {
                const w1 = applyMatrixWorld(obj, pos[k], pos[k+1], pos[k+2]);
                const w2 = applyMatrixWorld(obj, pos[k+3], pos[k+4], pos[k+5]);
                pushValidSegment(w1, w2, layerName, plane, entities);
                emittedPoints += 2;
            }
        } else {
            const count = Math.floor(pos.length / 3);
            for (let i = 0; i < count - 1; i++) {
                const k = i * 3;
                const w1 = applyMatrixWorld(obj, pos[k], pos[k+1], pos[k+2]);
                const w2 = applyMatrixWorld(obj, pos[k+3], pos[k+4], pos[k+5]);
                pushValidSegment(w1, w2, layerName, plane, entities);
                emittedPoints += 2;
            }
            if (isLoop && count > 2) {
                const kLast = (count - 1) * 3;
                const w1 = applyMatrixWorld(obj, pos[kLast], pos[kLast+1], pos[kLast+2]);
                const w2 = applyMatrixWorld(obj, pos[0], pos[1], pos[2]);
                pushValidSegment(w1, w2, layerName, plane, entities);
                emittedPoints += 2;
            }
        }
      }
    }

    const layers = Array.from(layerSet).sort((a, b) => a.localeCompare(b));
    console.log(`[CADLayerKit V9] Extracted ${entities.length} segments (Lines + Meshes).`);

    return {
      layers,
      entities,
      planeInfo: { chosenPlane: plane, ranges: rangesAxis, rangesAxis, rangesRaw },
      stats: { entities: entities.length }
    };
  },
};

// --- Helpers ---

function extractSegment(obj, posArray, idx1, idx2, layer, plane, entities) {
    const a = idx1 * 3;
    const b = idx2 * 3;
    if (a + 2 >= posArray.length || b + 2 >= posArray.length) return;

    const w1 = applyMatrixWorld(obj, posArray[a], posArray[a+1], posArray[a+2]);
    const w2 = applyMatrixWorld(obj, posArray[b], posArray[b+1], posArray[b+2]);
    pushValidSegment(w1, w2, layer, plane, entities);
}

function pushValidSegment(w1, w2, layer, plane, entities) {
    if (isNaN(w1.x) || isNaN(w1.y) || isNaN(w2.x) || isNaN(w2.y)) return;
    const dist = Math.hypot(w1.x - w2.x, w1.y - w2.y, w1.z - w2.z);
    if (dist < 0.001) return; 
    
    entities.push({
        layer: layer,
        kind: "LINE", 
        points: [map3To2(w1, plane), map3To2(w2, plane)],
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
      if (!out[name]) out[name] = { type: "lines", thickness: 0.2, height: 3.0, elevation: 0.0 };
      else if (!out[name].type) out[name].type = "lines";
    }
    return out;
  },
};

// --- Modified Collector: Include Meshes ---
function collectObjects(scene, { respectVisibility }) {
  const out = [];
  const stack = [scene];
  const visited = new Set();
  while (stack.length) {
    const obj = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    if (visited.has(obj)) continue;
    visited.add(obj);
    if (respectVisibility && obj.visible === false) continue;
    if (obj.children) stack.push(...obj.children);
    
    // التعديل الرئيسي هنا: قبول الميش (Mesh) أيضاً
    if (
        obj.isLine || obj.type === "Line" || 
        obj.isLineSegments || obj.type === "LineSegments" || 
        obj.isLineLoop || obj.type === "LineLoop" ||
        obj.isMesh || obj.type === "Mesh" // <--- إضافة دعم الميش
    ) {
      if (obj.geometry?.attributes?.position?.array) out.push(obj);
    }
  }
  return out;
}

function resolveLayerName(obj) {
  const ud = obj?.userData;
  const n = ud?.layer ?? ud?.layerName ?? ud?.dxfLayer ?? ud?.name ?? obj?.name;
  return (typeof n === "string" && n.trim()) ? n.trim() : "0";
}

function toAxisRanges(r) { return { x: { min: r.minX, max: r.maxX, range: r.maxX - r.minX }, y: { min: r.minY, max: r.maxY, range: r.maxY - r.minY }, z: { min: r.minZ, max: r.maxZ, range: r.maxZ - r.minZ } }; }
function choosePlaneFromRanges(r) { const rx = Math.abs(r.maxX - r.minX), ry = Math.abs(r.maxY - r.minY), rz = Math.abs(r.maxZ - r.minZ); return (rz <= rx && rz <= ry) ? "XY" : (ry <= rx && ry <= rz) ? "XZ" : "YZ"; }
function map3To2(v, plane) { return (plane === "XY") ? { x: v.x, y: v.y } : (plane === "XZ") ? { x: v.x, y: v.z } : { x: v.y, y: v.z }; }
function computeGlobalRangesWorld(lineObjs, maxPoints) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, count = 0;
  for (const obj of lineObjs) {
    const pos = obj?.geometry?.attributes?.position?.array;
    if (!pos) continue;
    const step = Math.max(3, Math.floor(pos.length / 1000) * 3);
    for (let k = 0; k + 2 < pos.length; k += step) {
      const w = applyMatrixWorld(obj, pos[k], pos[k + 1], pos[k + 2]);
      if(isNaN(w.x)) continue;
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x); minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y); minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
      if (++count > maxPoints) break;
    }
  }
  return isFinite(minX) ? { minX, minY, minZ, maxX, maxY, maxZ } : { minX:0, minY:0, minZ:0, maxX:0, maxY:0, maxZ:0 };
}
function applyMatrixWorld(obj, x, y, z) {
  const m = obj?.matrixWorld?.elements;
  if (!m || m.length !== 16) return { x, y, z };
  return { x: m[0]*x + m[4]*y + m[8]*z + m[12], y: m[1]*x + m[5]*y + m[9]*z + m[13], z: m[2]*x + m[6]*y + m[10]*z + m[14] };
}