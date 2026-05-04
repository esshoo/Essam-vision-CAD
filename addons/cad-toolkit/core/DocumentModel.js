/**
 * DocumentModel.js
 * Lightweight source-of-truth model for Essam Vision CAD.
 * This file intentionally has no dependency on the UI or x-viewer.
 */

export class DocumentModel {
  constructor({ fileId = "active", fileName = "Project", fileType = "unknown" } = {}) {
    this.fileId = fileId;
    this.fileName = fileName;
    this.fileType = fileType;
    this.layers = new Map();
    this.entities = new Map();
    this.annotations = new Map();
    this.meta = {};
  }

  upsertLayer(layer) {
    if (!layer?.id && !layer?.name) return null;
    const id = layer.id || layer.name;
    const prev = this.layers.get(id) || {};
    const next = {
      id,
      name: layer.name || id,
      type: layer.type || prev.type || "lines",
      visible: layer.visible ?? prev.visible ?? true,
      locked: layer.locked ?? prev.locked ?? false,
      source: layer.source || prev.source || "unknown",
      objectCount: layer.objectCount ?? prev.objectCount ?? 0,
      meta: { ...(prev.meta || {}), ...(layer.meta || {}) },
    };
    this.layers.set(id, next);
    return next;
  }

  addEntity(entity) {
    if (!entity?.id) return null;
    const next = {
      selected: false,
      visible: true,
      locked: false,
      deleted: false,
      ...entity,
    };
    next.layer = next.layer || next.layerId || "0";
    this.entities.set(next.id, next);
    if (next.layer) this.upsertLayer({ id: next.layer, name: next.layer, objectCount: 0 });
    return next;
  }

  getLayerEntities(layerId) {
    return Array.from(this.entities.values()).filter((entity) => entity.layer === layerId && !entity.deleted);
  }

  setLayerVisible(layerId, visible) {
    const layer = this.layers.get(layerId);
    if (!layer) return false;
    layer.visible = visible !== false;
    for (const entity of this.entities.values()) {
      if (entity.layer === layerId) entity.visible = layer.visible;
    }
    return true;
  }

  moveEntityToLayer(entityId, layerId) {
    const entity = this.entities.get(entityId);
    if (!entity || !layerId) return false;
    this.upsertLayer({ id: layerId, name: layerId });
    entity.layer = layerId;
    return true;
  }

  markEntityDeleted(entityId, deleted = true) {
    const entity = this.entities.get(entityId);
    if (!entity) return false;
    entity.deleted = deleted !== false;
    return true;
  }


  getEntity(entityId) {
    return this.entities.get(entityId) || null;
  }

  getVisibleEntities() {
    return Array.from(this.entities.values()).filter((entity) => entity.visible !== false && entity.deleted !== true);
  }

  getStats() {
    const kindCounts = {};
    const classCounts = {};
    for (const entity of this.entities.values()) {
      const kind = entity.kind || "UNKNOWN";
      const cls = entity.entityClass || "unknown";
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
      classCounts[cls] = (classCounts[cls] || 0) + 1;
    }
    return {
      layerCount: this.layers.size,
      entityCount: this.entities.size,
      annotationCount: this.annotations.size,
      kindCounts,
      classCounts,
    };
  }

  toJSON() {
    return {
      schema: "essam-document-model@1",
      fileId: this.fileId,
      fileName: this.fileName,
      fileType: this.fileType,
      layers: Array.from(this.layers.values()),
      entities: Array.from(this.entities.values()),
      annotations: Array.from(this.annotations.values()),
      meta: this.meta,
    };
  }

  static fromExtractedData(data = {}, meta = {}) {
    const doc = new DocumentModel(meta);
    const layers = Array.isArray(data.layers) ? data.layers : [];
    const entities = Array.isArray(data.entities) ? data.entities : [];

    layers.forEach((name) => doc.upsertLayer({ id: name, name, source: data.source || "extracted" }));
    entities.forEach((entity, index) => {
      doc.addEntity({
        ...entity,
        id: entity.id || `ent_${index + 1}`,
        sourceId: entity.sourceId || entity.id || null,
        layer: entity.layer || entity.layerId || "0",
        kind: entity.kind || "LINE",
        entityClass: entity.entityClass || "geometry",
        selectable: entity.selectable !== false,
        editable: entity.editable !== false,
        text: entity.text || null,
        points: entity.points || [],
        bbox: entity.bbox || null,
        source: entity.source || data.source || "extracted",
        meta: entity.meta || {},
      });
    });

    for (const layer of doc.layers.values()) {
      layer.objectCount = doc.getLayerEntities(layer.id).length;
    }
    return doc;
  }
}
