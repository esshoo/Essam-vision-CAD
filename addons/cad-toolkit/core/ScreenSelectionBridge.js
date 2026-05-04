/**
 * ScreenSelectionBridge.js
 *
 * Connects the data-first EntityRegistry/SelectionEngine to the visible 2D viewer.
 *
 * Why this exists:
 * - EntityRegistry knows entities in model/world data.
 * - The user clicks/touches the screen.
 * - This bridge projects entities to screen pixels, finds the nearest entity,
 *   and creates a visual highlight without depending on the old object-level picker.
 *
 * V1 scope:
 * - Click/touch/pen point selection from screen coordinates.
 * - Screen rectangle selection.
 * - Yellow overlay highlight for selected line entities.
 * - Basic hide/delete reflection for LineSegments objects when a parent object can be mapped.
 */

import { THREE } from "@x-viewer/core";

const DEFAULT_SCREEN_TOLERANCE = 10;
const HIGHLIGHT_COLOR = 0xffd54f;

export class ScreenSelectionBridge {
  constructor({ viewer = null, registry = null, selectionEngine = null, container = null, renderBridge = null } = {}) {
    this.viewer = viewer || null;
    this.registry = registry || null;
    this.selectionEngine = selectionEngine || null;
    this.container = container || null;
    this.renderBridge = renderBridge || null;
    this.highlightGroup = null;
    this.objectIndex = new Map();
    this.lastIndexKey = "";
  }

  setContext({ viewer = this.viewer, registry = this.registry, selectionEngine = this.selectionEngine, container = this.container, renderBridge = this.renderBridge } = {}) {
    this.viewer = viewer || null;
    this.registry = registry || null;
    this.selectionEngine = selectionEngine || null;
    this.container = container || null;
    this.renderBridge = renderBridge || null;
    this.lastIndexKey = "";
    this.objectIndex.clear();
    return this;
  }

  getScene() {
    return this.viewer?.sceneManager?.scene || this.viewer?.scene || null;
  }

  getCamera() {
    return this.viewer?.camera || null;
  }

  getContainer() {
    return this.container || document.getElementById(window.cadApp?.containerId || "myCanvas") || null;
  }

  getDrawableEntities({ includeHidden = false, includeLocked = false } = {}) {
    const all = this.registry?.getAll?.({ includeDeleted: false }) || [];
    return all.filter((entity) => {
      if (!entity || entity.selectable === false) return false;
      if (!includeHidden && entity.visible === false) return false;
      if (!includeLocked && entity.locked === true) return false;
      return true;
    });
  }

  pickEntryAt(clientX, clientY, options = {}) {
    // V8: if EntityRenderBridge is active, use the managed per-entity render first.
    // This avoids the old problem where one layer object was picked as one huge entity.
    const managedHit = this.renderBridge?.pickManagedAt?.(clientX, clientY, {
      threshold: options.worldThreshold,
    });
    if (managedHit?.entity) return this.makeEntry(managedHit.entity, managedHit);

    const hit = this.queryAtScreenPoint(clientX, clientY, options)[0] || null;
    return hit ? this.makeEntry(hit.entity, hit) : null;
  }

  queryAtScreenPoint(clientX, clientY, options = {}) {
    const camera = this.getCamera();
    const container = this.getContainer();
    if (!camera || !container || !this.registry) return [];

    const rect = container.getBoundingClientRect();
    const point = { x: Number(clientX), y: Number(clientY) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];

    const tolerance = Number(options.tolerance ?? DEFAULT_SCREEN_TOLERANCE);
    const hits = [];

    for (const entity of this.getDrawableEntities(options)) {
      const primitive = this.entityToScreenPrimitive(entity, camera, rect);
      if (!primitive) continue;
      const hit = distanceToScreenPrimitive(point, primitive);
      if (!hit || hit.distance > tolerance) continue;
      hits.push({ entity, distance: hit.distance, reason: hit.reason, primitive });
    }

    hits.sort((a, b) => a.distance - b.distance || entityPriority(a.entity) - entityPriority(b.entity));
    return hits.slice(0, Number(options.maxCandidates ?? 80));
  }

  selectAtScreenPoint(clientX, clientY, options = {}) {
    const hit = this.queryAtScreenPoint(clientX, clientY, options)[0] || null;
    if (!hit) {
      if (!options.additive && options.clearOnMiss !== false) this.clearSelection();
      return null;
    }
    this.registry?.select?.(hit.entity.id, { additive: options.additive === true });
    this.syncSelectionHighlights();
    return this.makeEntry(hit.entity, hit);
  }

  queryInScreenRect(screenRect, options = {}) {
    const camera = this.getCamera();
    const container = this.getContainer();
    const rect = normalizeScreenRect(screenRect);
    if (!camera || !container || !this.registry || !rect) return [];

    const containerRect = container.getBoundingClientRect();
    const out = [];
    for (const entity of this.getDrawableEntities(options)) {
      const primitive = this.entityToScreenPrimitive(entity, camera, containerRect);
      if (!primitive) continue;
      if (screenPrimitiveIntersectsRect(primitive, rect)) out.push(this.makeEntry(entity, { primitive, reason: "screen-rect" }));
    }
    return out;
  }

  selectInScreenRect(screenRect, options = {}) {
    const entries = this.queryInScreenRect(screenRect, options);
    const ids = entries.map((entry) => entry.id);
    this.registry?.selectMany?.(ids, { additive: options.additive === true });
    this.syncSelectionHighlights();
    return { count: ids.length, entries };
  }

  clearSelection() {
    this.registry?.clearSelection?.();
    this.clearHighlights();
  }

  makeEntry(entity, hit = {}) {
    return {
      id: entity.id,
      kind: "coreEntity",
      entity,
      layerName: entity.layer || "0",
      hit,
    };
  }

  entityToScreenPrimitive(entity, camera, containerRect) {
    if (!entity) return null;
    const kind = String(entity.kind || "").toUpperCase();
    const worldPoints = getEntityWorldPoints(entity);

    if (worldPoints.length >= 2 && (kind === "LINE" || kind === "MESH_EDGE" || entity.entityClass === "geometry")) {
      const points = worldPoints.map((p) => this.projectWorldPoint(p, camera, containerRect)).filter(Boolean);
      if (points.length >= 2) return { type: "polyline", points };
    }

    // Fallback for semantic text/images where world points may not exist yet.
    const modelPoints = Array.isArray(entity.points) ? entity.points.map((p) => ({ x: Number(p.x), y: Number(p.y), z: 0 })).filter(isFinitePoint3) : [];
    if (modelPoints.length >= 2) {
      const points = modelPoints.map((p) => this.projectWorldPoint(p, camera, containerRect)).filter(Boolean);
      if (points.length >= 2) return { type: "polyline", points };
    }

    return null;
  }

  projectWorldPoint(point, camera, containerRect) {
    if (!point || !camera || !containerRect) return null;
    const v = new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z || 0));
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
    v.project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
    return {
      x: ((v.x + 1) * 0.5) * containerRect.width + containerRect.left,
      y: ((-v.y + 1) * 0.5) * containerRect.height + containerRect.top,
      z: v.z,
    };
  }

  syncSelectionHighlights() {
    this.clearHighlights();
    const selected = this.registry?.getSelected?.() || [];
    if (!selected.length) return;

    const scene = this.getScene();
    if (!scene) return;

    const positions = [];
    for (const entity of selected) {
      const pts = getEntityWorldPoints(entity);
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        positions.push(Number(a.x), Number(a.y), Number(a.z || 0), Number(b.x), Number(b.y), Number(b.z || 0));
      }
    }
    if (!positions.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOR, transparent: true, opacity: 0.98, depthTest: false });
    const overlay = new THREE.LineSegments(geo, mat);
    overlay.name = "essam-core-selection-highlight";
    overlay.renderOrder = 999999;
    overlay.userData.__entityEditorIgnore = true;
    overlay.userData.__essamCoreSelectionOverlay = true;
    scene.add(overlay);
    this.highlightGroup = overlay;
  }

  clearHighlights() {
    const scene = this.getScene();
    if (this.highlightGroup) {
      this.highlightGroup.geometry?.dispose?.();
      this.highlightGroup.material?.dispose?.();
      this.highlightGroup.parent?.remove?.(this.highlightGroup);
      this.highlightGroup = null;
    }
    // Safety cleanup if a previous instance was recreated.
    scene?.traverse?.((obj) => {
      if (obj?.userData?.__essamCoreSelectionOverlay) {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
        obj.parent?.remove?.(obj);
      }
    });
  }

  applyVisibilityToScene() {
    // Best-effort V1: reflect hidden/deleted registry entities into original LineSegments objects.
    // It is intentionally conservative: unsupported objects remain visible until the deeper renderer bridge.
    if (!this.registry) return { updatedObjects: 0, missingParents: 0 };
    this.rebuildObjectIndex();

    const byParent = new Map();
    for (const entity of this.registry.getAll({ includeDeleted: true })) {
      const parentId = entity?.meta?.parentObjectId;
      if (!parentId) continue;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(entity);
    }

    let updatedObjects = 0;
    let missingParents = 0;
    for (const [parentId, entities] of byParent.entries()) {
      const obj = this.objectIndex.get(parentId);
      if (!obj) { missingParents += 1; continue; }
      if (!rebuildLineSegmentsObjectFromEntities(obj, entities)) continue;
      updatedObjects += 1;
    }
    return { updatedObjects, missingParents };
  }

  rebuildObjectIndex() {
    const scene = this.getScene();
    const layerIds = this.registry?.getLayerIds?.() || [];
    const key = `${layerIds.join("|")}::${this.registry?.entities?.size || 0}`;
    if (this.lastIndexKey === key && this.objectIndex.size) return this.objectIndex;

    this.objectIndex.clear();
    scene?.traverse?.((obj) => {
      if (!obj || !(obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh)) return;
      if (!obj.geometry?.attributes?.position) return;
      const raw = getRawObjectSourceId(obj);
      for (const layer of layerIds) {
        const candidate = `${safeId(layer)}__obj_${safeId(raw)}`;
        if (!this.objectIndex.has(candidate)) this.objectIndex.set(candidate, obj);
      }
    });
    this.lastIndexKey = key;
    return this.objectIndex;
  }

  getDebugSummary() {
    return {
      ready: !!(this.viewer && this.registry),
      entityCount: this.registry?.entities?.size || 0,
      selectedCount: this.registry?.selectedIds?.size || 0,
      objectIndexSize: this.objectIndex.size,
      managedRenderEnabled: this.renderBridge?.enabled === true,
      managedRenderChildren: this.renderBridge?.group?.children?.length || 0,
    };
  }
}

function getEntityWorldPoints(entity) {
  const pts = entity?.meta?.worldPoints;
  if (Array.isArray(pts)) return pts.map(toPoint3).filter(Boolean);
  return [];
}

function toPoint3(p) {
  if (!p) return null;
  const x = Number(p.x ?? p[0]);
  const y = Number(p.y ?? p[1]);
  const z = Number(p.z ?? p[2] ?? 0);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function isFinitePoint3(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function distanceToScreenPrimitive(point, primitive) {
  if (!primitive?.points?.length) return null;
  if (primitive.type === "polyline" && primitive.points.length >= 2) {
    let best = Infinity;
    for (let i = 0; i < primitive.points.length - 1; i++) {
      best = Math.min(best, distancePointToSegment2(point, primitive.points[i], primitive.points[i + 1]));
    }
    return Number.isFinite(best) ? { distance: best, reason: "screen-segment" } : null;
  }
  return null;
}

function screenPrimitiveIntersectsRect(primitive, rect) {
  if (!primitive?.points?.length) return false;
  const b = boxFromScreenPoints(primitive.points);
  if (!b) return false;
  return !(b.maxX < rect.left || b.minX > rect.right || b.maxY < rect.top || b.minY > rect.bottom);
}

function distancePointToSegment2(p, a, b) {
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

function boxFromScreenPoints(points = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function normalizeScreenRect(rect) {
  if (!rect) return null;
  const left = Number(rect.left ?? rect.x1 ?? rect[0]);
  const top = Number(rect.top ?? rect.y1 ?? rect[1]);
  const right = Number(rect.right ?? rect.x2 ?? rect[2]);
  const bottom = Number(rect.bottom ?? rect.y2 ?? rect[3]);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
  };
}

function entityPriority(entity) {
  const kind = String(entity?.kind || "").toUpperCase();
  if (kind === "TEXT") return 0;
  if (kind === "IMAGE") return 1;
  if (kind === "LINE") return 2;
  if (kind === "MESH_EDGE") return 3;
  return 10;
}

function getRawObjectSourceId(obj) {
  const ud = obj?.userData || {};
  return ud.UniqueId ?? ud.uniqueId ?? ud.handle ?? ud.id ?? ud.sourceId ?? obj.uuid ?? obj.id ?? "x";
}

function rebuildLineSegmentsObjectFromEntities(obj, entities = []) {
  if (!obj?.geometry?.attributes?.position) return false;
  if (!(obj.isLineSegments || obj.type === "LineSegments")) return false;

  if (!obj.userData.__essamOriginalGeometry) obj.userData.__essamOriginalGeometry = obj.geometry.clone();
  const original = obj.userData.__essamOriginalGeometry;
  const pos = original?.attributes?.position?.array;
  if (!pos) return false;

  const visibleComponentIndices = new Set(
    entities
      .filter((entity) => entity && entity.deleted !== true && entity.visible !== false)
      .map((entity) => Number(entity?.meta?.componentIndex))
      .filter(Number.isInteger)
  );

  const index = original.index?.array || null;
  const positions = [];
  const pushSegmentByPair = (ia, ib) => {
    const a = ia * 3;
    const b = ib * 3;
    if (a + 2 >= pos.length || b + 2 >= pos.length) return;
    positions.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
  };

  if (index) {
    for (let i = 0, c = 0; i + 1 < index.length; i += 2, c++) {
      if (!visibleComponentIndices.has(c)) continue;
      pushSegmentByPair(index[i], index[i + 1]);
    }
  } else {
    const vertexCount = Math.floor(pos.length / 3);
    for (let i = 0, c = 0; i + 1 < vertexCount; i += 2, c++) {
      if (!visibleComponentIndices.has(c)) continue;
      pushSegmentByPair(i, i + 1);
    }
  }

  if (obj.geometry && obj.geometry !== original) obj.geometry.dispose?.();
  const next = new THREE.BufferGeometry();
  next.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  obj.geometry = next;
  obj.visible = positions.length > 0;
  return true;
}

function safeId(value) {
  return String(value ?? "x").replace(/[^a-zA-Z0-9_\u0600-\u06FF-]+/g, "_").slice(0, 120);
}
