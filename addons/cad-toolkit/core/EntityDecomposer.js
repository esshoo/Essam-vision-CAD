/**
 * EntityDecomposer.js
 *
 * Turns large viewer objects into small, selectable engineering entities.
 *
 * Important distinction:
 * - Layer = a bucket/category.
 * - Viewer object = what x-viewer/three.js created for rendering. It can be huge.
 * - Entity = the unit we can select, hide, delete, move to another layer, or convert to 3D.
 *
 * This V1 focuses on reliable geometry decomposition:
 * - LineSegments -> one LINE entity per segment.
 * - Line/LineLoop -> one LINE entity per edge.
 * - Mesh -> one MESH_EDGE entity per triangle edge, with duplicate-edge filtering.
 * - PDF text/image recognition entities are normalized into selectable entities.
 */

const EPS = 0.001;
const MAX_ID_LENGTH = 180;

export class EntityDecomposer {
  static decomposeThreeObject({
    obj,
    layerName = "0",
    plane = "XY",
    objectId = null,
    source = "unknown",
    objectIndex = 0,
    maxEntities = 250000,
    userData = null,
  } = {}) {
    if (!obj?.geometry?.attributes?.position?.array) return { entities: [], stats: emptyStats() };

    const stats = emptyStats();
    const layer = cleanName(layerName);
    const stableObjectId = objectId || makeObjectId(obj, layer, objectIndex);
    const pos = obj.geometry.attributes.position.array;
    const index = obj.geometry.index;
    const isMesh = obj.isMesh || obj.type === "Mesh";
    const isLineSeg = obj.isLineSegments || obj.type === "LineSegments";
    const isLoop = obj.isLineLoop || obj.type === "LineLoop";
    const entities = [];
    const edgeSet = new Set();

    const baseMeta = {
      source,
      layer,
      objectId: stableObjectId,
      objectType: obj.type || (isMesh ? "Mesh" : isLineSeg ? "LineSegments" : obj.isLine ? "Line" : "Object3D"),
      modelId: obj.userData?.modelId || null,
      sourceType: obj.userData?.sourceType || null,
      userData: userData || shallowSafeUserData(obj.userData),
    };

    const emit = (idx1, idx2, componentIndex, primitiveKind = "line-segment") => {
      if (entities.length >= maxEntities) return;
      const entity = makeLineEntity({
        obj,
        posArray: pos,
        idx1,
        idx2,
        layer,
        plane,
        componentIndex,
        primitiveKind,
        meta: baseMeta,
      });
      if (!entity) return;

      // Avoid duplicated mesh triangle edges where possible.
      if (primitiveKind === "mesh-edge") {
        const edgeKey = normalizedEdgeKey(entity.points?.[0], entity.points?.[1]);
        if (edgeSet.has(edgeKey)) return;
        edgeSet.add(edgeKey);
      }

      entities.push(entity);
      stats.entityCount += 1;
      stats.pointCost += 2;
      if (primitiveKind === "mesh-edge") stats.meshEdges += 1;
      else stats.lineSegments += 1;
    };

    if (isMesh) {
      stats.meshObjects += 1;
      if (index?.array) {
        const indices = index.array;
        for (let i = 0, c = 0; i + 2 < indices.length && entities.length < maxEntities; i += 3, c += 3) {
          emit(indices[i], indices[i + 1], c, "mesh-edge");
          emit(indices[i + 1], indices[i + 2], c + 1, "mesh-edge");
          emit(indices[i + 2], indices[i], c + 2, "mesh-edge");
        }
      } else {
        const count = Math.floor(pos.length / 3);
        for (let i = 0, c = 0; i + 2 < count && entities.length < maxEntities; i += 3, c += 3) {
          emit(i, i + 1, c, "mesh-edge");
          emit(i + 1, i + 2, c + 1, "mesh-edge");
          emit(i + 2, i, c + 2, "mesh-edge");
        }
      }
      return { entities, stats };
    }

    if (isLineSeg) stats.lineSegmentObjects += 1;
    else stats.lineObjects += 1;

    if (index?.array) {
      const indices = index.array;
      if (isLineSeg) {
        for (let i = 0, c = 0; i + 1 < indices.length && entities.length < maxEntities; i += 2, c++) {
          emit(indices[i], indices[i + 1], c, "line-segment");
        }
      } else {
        for (let i = 0; i < indices.length - 1 && entities.length < maxEntities; i++) {
          emit(indices[i], indices[i + 1], i, isLoop ? "polyline-edge" : "line-edge");
        }
        if (isLoop && indices.length > 2) emit(indices[indices.length - 1], indices[0], indices.length - 1, "polyline-edge");
      }
    } else {
      const count = Math.floor(pos.length / 3);
      if (isLineSeg) {
        for (let i = 0, c = 0; i + 1 < count && entities.length < maxEntities; i += 2, c++) {
          emit(i, i + 1, c, "line-segment");
        }
      } else {
        for (let i = 0; i < count - 1 && entities.length < maxEntities; i++) {
          emit(i, i + 1, i, isLoop ? "polyline-edge" : "line-edge");
        }
        if (isLoop && count > 2) emit(count - 1, 0, count - 1, "polyline-edge");
      }
    }

    return { entities, stats };
  }

  static normalizeSemanticEntities(entities = []) {
    return (Array.isArray(entities) ? entities : [])
      .map((entity, index) => normalizeSemanticEntity(entity, index))
      .filter(Boolean);
  }
}

function makeLineEntity({ obj, posArray, idx1, idx2, layer, plane, componentIndex, primitiveKind, meta }) {
  const a = idx1 * 3;
  const b = idx2 * 3;
  if (a + 2 >= posArray.length || b + 2 >= posArray.length) return null;

  const w1 = applyMatrixWorld(obj, posArray[a], posArray[a + 1], posArray[a + 2]);
  const w2 = applyMatrixWorld(obj, posArray[b], posArray[b + 1], posArray[b + 2]);
  if (!isFinite(w1.x) || !isFinite(w1.y) || !isFinite(w2.x) || !isFinite(w2.y)) return null;

  const length3d = Math.hypot(w1.x - w2.x, w1.y - w2.y, w1.z - w2.z);
  if (length3d < EPS) return null;

  const p1 = map3To2(w1, plane);
  const p2 = map3To2(w2, plane);
  const length2d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  if (length2d < EPS) return null;

  const id = makeEntityId(layer, meta.objectId, componentIndex, p1, p2, primitiveKind);
  return {
    id,
    sourceId: `${meta.objectId}:component:${componentIndex}`,
    layer,
    kind: primitiveKind === "mesh-edge" ? "MESH_EDGE" : "LINE",
    entityClass: "geometry",
    selectable: true,
    editable: true,
    points: [p1, p2],
    bbox: boxFromPoints([p1, p2]),
    source: meta.source || "unknown",
    meta: {
      parentObjectId: meta.objectId || null,
      componentIndex,
      primitiveKind,
      objectType: meta.objectType || null,
      modelId: meta.modelId || null,
      sourceType: meta.sourceType || null,
      length2d,
      length3d,
      worldPoints: [roundPoint3(w1), roundPoint3(w2)],
      userData: meta.userData || {},
    },
  };
}

function normalizeSemanticEntity(entity, index) {
  if (!entity) return null;
  const layer = cleanName(entity.layer || entity.layerId || "0");
  const kind = String(entity.kind || entity.type || "ENTITY").toUpperCase();
  const id = entity.id || makeEntityId(layer, entity.sourceId || kind, index, entity.points?.[0], entity.points?.[1], kind);
  const points = Array.isArray(entity.points) ? entity.points.map(toPoint2).filter(Boolean) : [];
  const bbox = entity.bbox || (points.length ? boxFromPoints(points) : null);
  return {
    selected: false,
    visible: true,
    locked: false,
    deleted: false,
    ...entity,
    id,
    sourceId: entity.sourceId || id,
    layer,
    kind,
    entityClass: kind === "TEXT" ? "text" : kind === "IMAGE" ? "image" : entity.entityClass || "semantic",
    selectable: entity.selectable !== false,
    editable: entity.editable !== false,
    points,
    bbox,
    meta: {
      ...(entity.meta || {}),
      normalizedBy: "EntityDecomposer.normalizeSemanticEntities",
    },
  };
}

function emptyStats() {
  return {
    entityCount: 0,
    pointCost: 0,
    lineObjects: 0,
    lineSegmentObjects: 0,
    meshObjects: 0,
    lineSegments: 0,
    meshEdges: 0,
  };
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

function map3To2(v, plane) {
  return plane === "XY" ? { x: v.x, y: v.y } : plane === "XZ" ? { x: v.x, y: v.z } : { x: v.y, y: v.z };
}

function boxFromPoints(points = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
    minX = Math.min(minX, Number(p.x));
    minY = Math.min(minY, Number(p.y));
    maxX = Math.max(maxX, Number(p.x));
    maxY = Math.max(maxY, Number(p.y));
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function toPoint2(p) {
  if (!p) return null;
  const x = Number(p.x);
  const y = Number(p.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function roundPoint3(p) {
  return { x: roundId(p.x), y: roundId(p.y), z: roundId(p.z) };
}

function normalizedEdgeKey(p1, p2) {
  const a = `${roundId(p1?.x)}:${roundId(p1?.y)}`;
  const b = `${roundId(p2?.x)}:${roundId(p2?.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function makeObjectId(obj, layerName, index) {
  const ud = obj?.userData || {};
  const raw = ud.UniqueId ?? ud.uniqueId ?? ud.handle ?? ud.id ?? ud.sourceId ?? obj.uuid ?? obj.id ?? index;
  return `${safeId(layerName)}__obj_${safeId(raw)}`;
}

function makeEntityId(layerName, objectId, componentIndex, p1 = {}, p2 = {}, primitiveKind = "entity") {
  const a = `${roundId(p1?.x)}_${roundId(p1?.y)}_${roundId(p2?.x)}_${roundId(p2?.y)}`;
  return `${safeId(layerName)}__${safeId(objectId || "obj")}__${safeId(primitiveKind)}_${componentIndex}_${safeId(a)}`.slice(0, MAX_ID_LENGTH);
}

function cleanName(value) {
  const out = String(value ?? "0").trim();
  return out || "0";
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
