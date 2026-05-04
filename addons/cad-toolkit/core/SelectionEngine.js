/**
 * SelectionEngine.js
 *
 * Data-first selection for Essam Vision CAD.
 * It works on EntityRegistry/DocumentModel entities instead of directly editing Three.js objects.
 *
 * V1 scope:
 * - Select by entity id.
 * - Select nearest entity by model-space point.
 * - Box select by model-space rectangle.
 * - Query entities in a point/box.
 *
 * Later UI bridges will convert mouse/touch/pen/VR input into model-space points,
 * then call this engine.
 */

const DEFAULT_POINT_TOLERANCE = 8;

export class SelectionEngine {
  constructor(entityRegistry = null, options = {}) {
    this.registry = entityRegistry || null;
    this.options = {
      pointTolerance: options.pointTolerance ?? DEFAULT_POINT_TOLERANCE,
      maxCandidates: options.maxCandidates ?? 80,
    };
  }

  setRegistry(entityRegistry) {
    this.registry = entityRegistry || null;
    return this;
  }

  selectById(id, { additive = false } = {}) {
    if (!this.registry?.select) return false;
    return this.registry.select(id, { additive });
  }

  clear() {
    this.registry?.clearSelection?.();
  }

  getSelected() {
    return this.registry?.getSelected?.() || [];
  }

  queryAtPoint(point, options = {}) {
    const p = normalizePoint(point);
    if (!p || !this.registry?.getAll) return [];

    const tolerance = Number(options.tolerance ?? this.options.pointTolerance);
    const includeHidden = options.includeHidden === true;
    const includeLocked = options.includeLocked === true;
    const maxCandidates = Number(options.maxCandidates ?? this.options.maxCandidates);

    const candidates = [];
    for (const entity of this.registry.getAll({ includeDeleted: false })) {
      if (!isSelectableEntity(entity, { includeHidden, includeLocked })) continue;
      const hit = distanceToEntity(p, entity);
      if (!hit || hit.distance > tolerance) continue;
      candidates.push({ entity, distance: hit.distance, reason: hit.reason });
    }

    candidates.sort((a, b) => a.distance - b.distance || entityPriority(a.entity) - entityPriority(b.entity));
    return candidates.slice(0, maxCandidates);
  }

  selectAtPoint(point, options = {}) {
    const hits = this.queryAtPoint(point, options);
    const best = hits[0]?.entity || null;
    if (!best) {
      if (!options.additive && options.clearOnMiss !== false) this.clear();
      return null;
    }
    this.registry.select(best.id, { additive: options.additive === true });
    return best;
  }

  queryInBox(box, options = {}) {
    const b = normalizeBox(box);
    if (!b || !this.registry?.getAll) return [];

    const includeHidden = options.includeHidden === true;
    const includeLocked = options.includeLocked === true;
    const requireFullInside = options.requireFullInside === true;
    const out = [];

    for (const entity of this.registry.getAll({ includeDeleted: false })) {
      if (!isSelectableEntity(entity, { includeHidden, includeLocked })) continue;
      const eb = normalizeBox(entity.bbox || boxFromPoints(entity.points));
      if (!eb) continue;
      const ok = requireFullInside ? boxContainsBox(b, eb) : boxesIntersect(b, eb);
      if (ok) out.push(entity);
    }

    out.sort((a, b) => String(a.layer || "").localeCompare(String(b.layer || "")) || String(a.id).localeCompare(String(b.id)));
    return out;
  }

  selectInBox(box, options = {}) {
    const entities = this.queryInBox(box, options);
    const ids = entities.map((entity) => entity.id);
    const count = this.registry?.selectMany?.(ids, { additive: options.additive === true }) || 0;
    return { count, entities };
  }

  getDebugSummary() {
    return {
      ready: !!this.registry,
      selectedCount: this.registry?.selectedIds?.size || 0,
      pointTolerance: this.options.pointTolerance,
      registryStats: this.registry?.getStats?.() || null,
    };
  }
}

function isSelectableEntity(entity, { includeHidden = false, includeLocked = false } = {}) {
  if (!entity || entity.deleted === true || entity.selectable === false) return false;
  if (!includeHidden && entity.visible === false) return false;
  if (!includeLocked && entity.locked === true) return false;
  return true;
}

function distanceToEntity(point, entity) {
  if (!point || !entity) return null;

  const kind = String(entity.kind || "").toUpperCase();
  const points = Array.isArray(entity.points) ? entity.points.map(normalizePoint).filter(Boolean) : [];

  if ((kind === "LINE" || kind === "MESH_EDGE") && points.length >= 2) {
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      best = Math.min(best, distancePointToSegment(point, points[i], points[i + 1]));
    }
    return Number.isFinite(best) ? { distance: best, reason: "segment" } : null;
  }

  const bbox = normalizeBox(entity.bbox || boxFromPoints(points));
  if (bbox) {
    if (pointInBox(point, bbox)) return { distance: 0, reason: "bbox-inside" };
    return { distance: distancePointToBox(point, bbox), reason: "bbox" };
  }

  if (points.length) {
    let best = Infinity;
    for (const p of points) best = Math.min(best, Math.hypot(point.x - p.x, point.y - p.y));
    return Number.isFinite(best) ? { distance: best, reason: "points" } : null;
  }

  return null;
}

function entityPriority(entity) {
  const kind = String(entity?.kind || "").toUpperCase();
  if (kind === "TEXT") return 0;
  if (kind === "IMAGE") return 1;
  if (kind === "LINE") return 2;
  if (kind === "MESH_EDGE") return 3;
  return 10;
}

function distancePointToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return Math.hypot(p.x - px, p.y - py);
}

function distancePointToBox(p, b) {
  const dx = p.x < b.minX ? b.minX - p.x : p.x > b.maxX ? p.x - b.maxX : 0;
  const dy = p.y < b.minY ? b.minY - p.y : p.y > b.maxY ? p.y - b.maxY : 0;
  return Math.hypot(dx, dy);
}

function pointInBox(p, b) {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function boxesIntersect(a, b) {
  return !(b.minX > a.maxX || b.maxX < a.minX || b.minY > a.maxY || b.maxY < a.minY);
}

function boxContainsBox(a, b) {
  return b.minX >= a.minX && b.maxX <= a.maxX && b.minY >= a.minY && b.maxY <= a.maxY;
}

function normalizePoint(point) {
  if (!point) return null;
  const x = Number(point.x ?? point[0]);
  const y = Number(point.y ?? point[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizeBox(box) {
  if (!box) return null;
  const minX = Number(box.minX ?? box.x1 ?? box.left ?? box[0]);
  const minY = Number(box.minY ?? box.y1 ?? box.top ?? box[1]);
  const maxX = Number(box.maxX ?? box.x2 ?? box.right ?? box[2]);
  const maxY = Number(box.maxY ?? box.y2 ?? box.bottom ?? box[3]);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
}

function boxFromPoints(points = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p0 of points) {
    const p = normalizePoint(p0);
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
