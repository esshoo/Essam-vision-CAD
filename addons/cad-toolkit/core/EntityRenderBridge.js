/**
 * EntityRenderBridge.js
 *
 * V8 - per-entity managed render.
 *
 * V7 drew one LineSegments object per layer. That looked correct, but picking could still
 * behave like the entire layer was one object. V8 draws each registry entity as its own
 * managed THREE object and stores the entity id on that object.
 *
 * Result:
 * - Visual render is generated from EntityRegistry.
 * - A click can map directly to one entity id.
 * - Hide/delete/move can rebuild from data without touching the original x-viewer object.
 */

import { THREE } from "@x-viewer/core";

const DEFAULT_LAYER_COLOR = 0xd7dee8;
const COLORS = [
  0xd7dee8, 0x8ab4f8, 0x81c995, 0xfdd663, 0xf28b82,
  0xc58af9, 0x78d9ec, 0xffc48c, 0xa7ffeb, 0xffabf5,
];

export class EntityRenderBridge {
  constructor({ viewer = null, registry = null } = {}) {
    this.viewer = viewer || null;
    this.registry = registry || null;
    this.enabled = false;
    this.group = null;
    this.hiddenOriginals = new Set();
    this.layerMaterials = new Map();
    this.entityObjectMap = new Map();
    this.lastBuild = null;
    this.maxIndividualEntities = 75000;
  }

  setContext({ viewer = this.viewer, registry = this.registry } = {}) {
    this.viewer = viewer || null;
    this.registry = registry || null;
    return this;
  }

  getScene() {
    return this.viewer?.sceneManager?.scene || this.viewer?.scene || null;
  }

  getCamera() {
    return this.viewer?.camera || null;
  }

  getContainer() {
    return document.getElementById(window.cadApp?.containerId || "myCanvas") || null;
  }

  enable() {
    this.enabled = true;
    this.hideOriginalObjects();
    this.rebuild();
    return this;
  }

  disable({ restoreOriginals = true } = {}) {
    this.enabled = false;
    this.removeManagedGroup();
    if (restoreOriginals) this.restoreOriginalObjects();
    requestViewerRender(this.viewer);
    return this;
  }

  rebuild() {
    if (!this.enabled || !this.registry) {
      this.lastBuild = { enabled: this.enabled, builtLayers: 0, builtEntities: 0, reason: "disabled-or-no-registry" };
      return this.lastBuild;
    }

    const scene = this.getScene();
    if (!scene) {
      this.lastBuild = { enabled: true, builtLayers: 0, builtEntities: 0, error: "no-scene" };
      return this.lastBuild;
    }

    this.removeManagedGroup();

    const group = new THREE.Group();
    group.name = "essam-managed-entity-render";
    group.userData.__essamManagedEntityRender = true;
    group.userData.__essamManagedEntityRoot = true;
    group.renderOrder = 1000;

    const layerIndex = new Map();
    let builtEntities = 0;
    let builtLayers = 0;
    let skippedEntities = 0;

    const drawable = [];
    for (const entity of this.registry.getAll({ includeDeleted: false })) {
      if (!isDrawableEntity(entity)) continue;
      if (entity.visible === false || entity.deleted === true) continue;
      const pts = getEntityWorldPoints(entity);
      if (pts.length < 2) { skippedEntities += 1; continue; }
      drawable.push({ entity, pts });
    }

    // Correctness first: draw one object per entity. For extremely huge files we can later
    // add an instanced/batched picker, but per-entity is the right debugging baseline.
    for (const item of drawable.slice(0, this.maxIndividualEntities)) {
      const entity = item.entity;
      const pts = item.pts;
      const layerName = String(entity.layer || "0");
      if (!layerIndex.has(layerName)) layerIndex.set(layerName, layerIndex.size);

      const positions = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        positions.push(a.x, a.y, a.z || 0, b.x, b.y, b.z || 0);
      }
      if (!positions.length) { skippedEntities += 1; continue; }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const mat = this.getLayerMaterial(layerName, layerIndex.get(layerName));
      const line = new THREE.LineSegments(geo, mat);
      line.name = `essam-managed-entity-${entity.id}`;
      line.renderOrder = 1000;
      line.userData.__essamManagedEntityRender = true;
      line.userData.__essamManagedEntity = true;
      line.userData.__essamCoreEntityId = entity.id;
      line.userData.layer = layerName;
      line.userData.layerName = layerName;
      line.userData.entityKind = entity.kind || "LINE";
      line.userData.selectable = true;
      group.add(line);
      this.entityObjectMap.set(entity.id, line);
      builtEntities += 1;
    }

    builtLayers = layerIndex.size;
    scene.add(group);
    this.group = group;
    this.lastBuild = {
      enabled: true,
      renderMode: "per-entity",
      builtLayers,
      builtEntities,
      skippedEntities,
      totalRegistryEntities: this.registry?.entities?.size || 0,
      hiddenOriginals: this.hiddenOriginals.size,
      managedChildren: group.children.length,
      timestamp: Date.now(),
    };
    requestViewerRender(this.viewer);
    return this.lastBuild;
  }

  getManagedObjects() {
    return this.group?.children?.filter((obj) => obj?.userData?.__essamManagedEntity) || [];
  }

  getEntityIdFromObject(obj) {
    let cur = obj;
    while (cur) {
      const id = cur.userData?.__essamCoreEntityId;
      if (id) return id;
      cur = cur.parent;
    }
    return null;
  }

  pickManagedAt(clientX, clientY, { threshold = null } = {}) {
    if (!this.enabled || !this.group || !this.registry) return null;
    const camera = this.getCamera();
    const container = this.getContainer();
    if (!camera || !container) return null;

    const rect = container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    );

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Line.threshold = Number.isFinite(Number(threshold)) ? Number(threshold) : estimateWorldThreshold(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(this.getManagedObjects(), false) || [];
    for (const hit of hits) {
      const entityId = this.getEntityIdFromObject(hit.object);
      const entity = entityId ? this.registry.get(entityId) : null;
      if (!entity || entity.deleted || entity.visible === false || entity.selectable === false || entity.locked === true) continue;
      return { entity, hit, distance: hit.distance, reason: "managed-render-raycast" };
    }
    return null;
  }

  getLayerMaterial(layerName, index = 0) {
    if (this.layerMaterials.has(layerName)) return this.layerMaterials.get(layerName);
    const mat = new THREE.LineBasicMaterial({
      color: COLORS[index % COLORS.length] || DEFAULT_LAYER_COLOR,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
    });
    this.layerMaterials.set(layerName, mat);
    return mat;
  }

  hideOriginalObjects() {
    const scene = this.getScene();
    if (!scene || !this.registry) return 0;

    const layerIds = new Set((this.registry.getLayerIds?.() || []).map((x) => String(x)));
    let count = 0;

    scene.traverse?.((obj) => {
      if (!isSourceDrawableObject(obj)) return;
      const layerName = resolveLayerName(obj);
      if (layerIds.size && layerName && !layerIds.has(String(layerName))) return;
      if (obj.userData.__essamManagedOriginalVisible === undefined) {
        obj.userData.__essamManagedOriginalVisible = obj.visible !== false;
      }
      if (obj.visible !== false) count += 1;
      obj.visible = false;
      this.hiddenOriginals.add(obj);
    });

    requestViewerRender(this.viewer);
    return count;
  }

  restoreOriginalObjects() {
    for (const obj of this.hiddenOriginals) {
      if (!obj) continue;
      const originalVisible = obj.userData?.__essamManagedOriginalVisible;
      obj.visible = originalVisible !== false;
      if (obj.userData) delete obj.userData.__essamManagedOriginalVisible;
    }
    this.hiddenOriginals.clear();
    requestViewerRender(this.viewer);
  }

  removeManagedGroup() {
    const scene = this.getScene();
    this.entityObjectMap.clear();

    if (this.group) {
      disposeObjectTree(this.group);
      this.group.parent?.remove?.(this.group);
      this.group = null;
    }

    const stale = [];
    scene?.traverse?.((obj) => {
      if (obj?.userData?.__essamManagedEntityRoot) stale.push(obj);
    });
    for (const obj of stale) {
      disposeObjectTree(obj);
      obj.parent?.remove?.(obj);
    }
  }

  getDebugSummary() {
    return {
      ready: !!(this.viewer && this.registry),
      enabled: this.enabled,
      hiddenOriginals: this.hiddenOriginals.size,
      managedChildren: this.group?.children?.length || 0,
      entityObjectMapSize: this.entityObjectMap.size,
      lastBuild: this.lastBuild,
    };
  }
}

function isDrawableEntity(entity) {
  const kind = String(entity?.kind || "").toUpperCase();
  return kind === "LINE" || kind === "MESH_EDGE" || entity?.entityClass === "geometry";
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

function isSourceDrawableObject(obj) {
  if (!obj || obj.visible === false) return false;
  if (obj.userData?.__essamManagedEntityRender || obj.userData?.__essamCoreSelectionOverlay) return false;
  if (!(obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isMesh)) return false;
  if (!obj.geometry?.attributes?.position) return false;
  const name = `${obj.name || ""} ${obj.userData?.name || ""}`.toLowerCase();
  if (/(paper|background|sheet|canvas|overlay|grid|helper|measure|markup|annotation|teleport|controller|gizmo|axis-helper)/.test(name)) return false;
  return !!resolveLayerName(obj);
}

function resolveLayerName(obj) {
  const ud = obj?.userData || {};
  const n = ud.__sourceOriginalLayer ?? ud.layer ?? ud.layerName ?? ud.dxfLayer ?? ud.name ?? null;
  return (typeof n === "string" && n.trim()) ? n.trim() : null;
}

function disposeObjectTree(obj) {
  obj?.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((m) => m?.dispose?.());
    else child.material?.dispose?.();
  });
}

function requestViewerRender(viewer) {
  try {
    viewer?.render?.();
    viewer?.requestRender?.();
    viewer?.sceneManager?.requestRender?.();
  } catch (_) {}
}

function estimateWorldThreshold(clientX, clientY) {
  try {
    const ov = window.cadDrawingOverlay;
    const val = ov?.pixelSizeToWorldSize?.(10, clientX, clientY, ov.getDrawingPlaneZ?.()) || ov?.pixelSizeToWorldSize?.(10, clientX, clientY) || 0.6;
    return Math.max(0.12, Number.isFinite(val) ? val : 0.6);
  } catch (_) {
    return 0.6;
  }
}
