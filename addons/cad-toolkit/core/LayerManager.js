/**
 * LayerManager.js
 * Thin data-layer manager for the new core.
 * UI panels should talk to this layer later instead of editing viewer objects directly.
 */

export class LayerManager {
  constructor(documentModel = null, entityRegistry = null) {
    this.documentModel = documentModel || null;
    this.entityRegistry = entityRegistry || null;
  }

  createLayer(id, options = {}) {
    if (!this.documentModel?.upsertLayer || !id) return null;
    return this.documentModel.upsertLayer({ id, name: options.name || id, ...options });
  }

  setLayerVisible(layerId, visible) {
    if (!this.documentModel?.setLayerVisible) return false;
    const ok = this.documentModel.setLayerVisible(layerId, visible);
    if (ok && this.entityRegistry) {
      for (const entity of this.entityRegistry.getByLayer(layerId, { includeDeleted: true })) {
        entity.visible = visible !== false;
      }
      this.entityRegistry.rebuildLayerStats();
    }
    return ok;
  }

  moveEntitiesToLayer(entityIds = [], targetLayerId) {
    if (!targetLayerId || !Array.isArray(entityIds)) return 0;
    this.createLayer(targetLayerId);
    let count = 0;
    for (const id of entityIds) {
      const ok = this.entityRegistry?.moveToLayer ? this.entityRegistry.moveToLayer(id, targetLayerId) : this.documentModel?.moveEntityToLayer?.(id, targetLayerId);
      if (ok) count++;
    }
    return count;
  }

  getLayerSummary() {
    const layers = this.entityRegistry?.getStats?.().layers || Array.from(this.documentModel?.layers?.values?.() || []);
    return layers.map((layer) => ({
      id: layer.id,
      name: layer.name || layer.id,
      type: layer.type || "lines",
      visible: layer.visible !== false,
      locked: layer.locked === true,
      entityCount: layer.entityCount ?? this.documentModel?.getLayerEntities?.(layer.id)?.length ?? 0,
      visibleEntityCount: layer.visibleEntityCount ?? 0,
    }));
  }
}
