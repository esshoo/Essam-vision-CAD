/**
 * EntityRegistry.js
 *
 * Runtime index for DocumentModel entities.
 * It gives the next UI tools a clean API for select/hide/delete/move without touching Three.js directly.
 */

export class EntityRegistry {
  constructor(documentModel = null) {
    this.documentModel = documentModel || null;
    this.entities = new Map();
    this.layers = new Map();
    this.selectedIds = new Set();
    if (documentModel) this.loadFromDocumentModel(documentModel);
  }

  loadFromDocumentModel(documentModel) {
    this.documentModel = documentModel;
    this.entities.clear();
    this.layers.clear();
    this.selectedIds.clear();

    for (const layer of documentModel?.layers?.values?.() || []) {
      this.layers.set(layer.id, { ...layer, entityCount: 0, visibleEntityCount: 0 });
    }

    for (const entity of documentModel?.entities?.values?.() || []) {
      this.register(entity);
    }

    return this;
  }

  register(entity) {
    if (!entity?.id) return null;
    const next = {
      selected: false,
      visible: true,
      locked: false,
      deleted: false,
      selectable: true,
      editable: true,
      ...entity,
    };
    this.entities.set(next.id, next);

    const layerId = next.layer || "0";
    if (!this.layers.has(layerId)) this.layers.set(layerId, { id: layerId, name: layerId, visible: true, locked: false, entityCount: 0, visibleEntityCount: 0 });
    const layer = this.layers.get(layerId);
    layer.entityCount = (layer.entityCount || 0) + 1;
    if (next.visible !== false && next.deleted !== true) layer.visibleEntityCount = (layer.visibleEntityCount || 0) + 1;

    return next;
  }

  get(id) {
    return this.entities.get(id) || null;
  }

  getAll({ includeDeleted = false } = {}) {
    return Array.from(this.entities.values()).filter((entity) => includeDeleted || entity.deleted !== true);
  }

  getByLayer(layerId, { includeDeleted = false } = {}) {
    return this.getAll({ includeDeleted }).filter((entity) => entity.layer === layerId);
  }

  getSelected() {
    this.normalizeSelection();
    return Array.from(this.selectedIds).map((id) => this.entities.get(id)).filter(Boolean);
  }

  getLayerIds() {
    return Array.from(this.layers.keys()).sort((a, b) => String(a).localeCompare(String(b)));
  }

  getLayerNames() {
    return this.getLayerIds();
  }

  listLayers() {
    return this.getStats().layers.map((layer) => ({
      id: layer.id,
      name: layer.name || layer.id,
      entityCount: layer.entityCount || 0,
      visibleEntityCount: layer.visibleEntityCount || 0,
      visible: layer.visible !== false,
      locked: layer.locked === true,
      type: layer.type || "lines",
    }));
  }

  findLayerId(query) {
    if (query === null || query === undefined) return null;
    const q = String(query).trim();
    if (!q) return null;
    if (this.layers.has(q)) return q;

    const lower = q.toLowerCase();
    for (const layer of this.layers.values()) {
      if (String(layer.id || "").toLowerCase() === lower) return layer.id;
      if (String(layer.name || "").toLowerCase() === lower) return layer.id;
    }

    for (const layer of this.layers.values()) {
      const id = String(layer.id || "").toLowerCase();
      const name = String(layer.name || "").toLowerCase();
      if (id.includes(lower) || name.includes(lower)) return layer.id;
    }

    return null;
  }

  getByLayerSmart(query, options = {}) {
    const id = this.findLayerId(query);
    return id ? this.getByLayer(id, options) : [];
  }

  normalizeSelection() {
    const valid = new Set();
    for (const id of this.selectedIds) {
      const entity = this.entities.get(id);
      if (!entity || entity.deleted === true || entity.visible === false || entity.selectable === false || entity.locked === true) continue;
      entity.selected = true;
      valid.add(id);
    }
    for (const entity of this.entities.values()) {
      if (!valid.has(entity.id) && entity.selected === true) entity.selected = false;
    }
    this.selectedIds = valid;
    return this.selectedIds.size;
  }

  getSelectedLayerIds() {
    this.normalizeSelection();
    return Array.from(new Set(this.getSelected().map((entity) => entity.layer || "0"))).filter(Boolean);
  }

  selectLayer(layerId, { additive = false, includeHidden = false } = {}) {
    if (!layerId) return 0;
    if (!additive) this.clearSelection();
    const ids = this.getByLayer(layerId, { includeDeleted: false })
      .filter((entity) => includeHidden || entity.visible !== false)
      .map((entity) => entity.id);
    return this.selectMany(ids, { additive: true });
  }

  selectLayers(layerIds = [], options = {}) {
    const ids = Array.from(new Set(layerIds.filter(Boolean)));
    if (!options.additive) this.clearSelection();
    let count = 0;
    for (const layerId of ids) count += this.selectLayer(layerId, { ...options, additive: true });
    return count;
  }

  hideLayer(layerId, hidden = true) {
    if (!layerId) return 0;
    let count = 0;
    for (const entity of this.getByLayer(layerId, { includeDeleted: false })) {
      if (this.hide(entity.id, hidden)) count += 1;
    }
    this.rebuildLayerStats();
    return count;
  }

  deleteLayer(layerId, deleted = true) {
    if (!layerId) return 0;
    let count = 0;
    for (const entity of this.getByLayer(layerId, { includeDeleted: true })) {
      if (this.delete(entity.id, deleted)) count += 1;
    }
    this.rebuildLayerStats();
    return count;
  }

  moveLayerToLayer(sourceLayerId, targetLayerId) {
    if (!sourceLayerId || !targetLayerId || sourceLayerId === targetLayerId) return 0;
    let count = 0;
    for (const entity of this.getByLayer(sourceLayerId, { includeDeleted: true })) {
      if (this.moveToLayer(entity.id, targetLayerId)) count += 1;
    }
    this.rebuildLayerStats();
    return count;
  }

  exportState() {
    return {
      schema: "essam-entity-registry-state@1",
      entities: this.getAll({ includeDeleted: true }).map((entity) => ({
        id: entity.id,
        layer: entity.layer || "0",
        visible: entity.visible !== false,
        deleted: entity.deleted === true,
        selected: entity.selected === true,
        locked: entity.locked === true,
      })),
    };
  }

  restoreState(state = {}) {
    const rows = Array.isArray(state?.entities) ? state.entities : [];
    this.clearSelection();
    for (const row of rows) {
      const entity = this.entities.get(row.id);
      if (!entity) continue;
      if (row.layer) entity.layer = row.layer;
      entity.visible = row.visible !== false;
      entity.deleted = row.deleted === true;
      entity.locked = row.locked === true;
      entity.selected = row.selected === true && entity.deleted !== true && entity.visible !== false;
      this.syncDocumentEntity(entity.id, {
        layer: entity.layer,
        visible: entity.visible,
        deleted: entity.deleted,
        locked: entity.locked,
        selected: entity.selected,
      });
      if (entity.selected) this.selectedIds.add(entity.id);
    }
    this.rebuildLayerStats();
    this.normalizeSelection();
    return true;
  }

  getFirstLayerEntities(limit = 5, options = {}) {
    const first = this.listLayers().find((layer) => (layer.entityCount || 0) > 0);
    return first ? this.getByLayer(first.id, options).slice(0, limit) : [];
  }

  getSampleEntities(limit = 10, options = {}) {
    return this.getAll(options).slice(0, limit);
  }

  printLayerSummary() {
    const rows = this.listLayers();
    try { console.table(rows); } catch (_) { console.log(rows); }
    return rows;
  }

  select(id, { additive = false } = {}) {
    const entity = this.entities.get(id);
    if (!entity || entity.deleted || entity.visible === false || entity.selectable === false || entity.locked === true) return false;
    if (!additive) this.clearSelection();
    entity.selected = true;
    this.selectedIds.add(id);
    this.syncDocumentEntity(id, { selected: true });
    return true;
  }

  selectMany(ids = [], { additive = false } = {}) {
    if (!additive) this.clearSelection();
    let count = 0;
    for (const id of ids) if (this.select(id, { additive: true })) count++;
    return count;
  }

  clearSelection() {
    for (const id of this.selectedIds) {
      const entity = this.entities.get(id);
      if (entity) entity.selected = false;
      this.syncDocumentEntity(id, { selected: false });
    }
    this.selectedIds.clear();
  }

  hide(id, hidden = true) {
    const entity = this.entities.get(id);
    if (!entity || entity.locked) return false;
    entity.visible = hidden ? false : true;
    if (entity.visible === false) {
      entity.selected = false;
      this.selectedIds.delete(id);
    }
    this.syncDocumentEntity(id, { visible: entity.visible, selected: entity.selected });
    this.rebuildLayerStats();
    return true;
  }

  delete(id, deleted = true) {
    const entity = this.entities.get(id);
    if (!entity || entity.locked) return false;
    entity.deleted = deleted !== false;
    if (entity.deleted) {
      entity.selected = false;
      this.selectedIds.delete(id);
    }
    this.syncDocumentEntity(id, { deleted: entity.deleted, selected: entity.selected });
    this.rebuildLayerStats();
    return true;
  }

  moveToLayer(id, layerId) {
    const entity = this.entities.get(id);
    if (!entity || !layerId || entity.locked) return false;
    entity.layer = layerId;
    if (!this.layers.has(layerId)) this.layers.set(layerId, { id: layerId, name: layerId, visible: true, locked: false, entityCount: 0, visibleEntityCount: 0 });
    if (this.documentModel?.moveEntityToLayer) this.documentModel.moveEntityToLayer(id, layerId);
    else this.syncDocumentEntity(id, { layer: layerId });
    this.rebuildLayerStats();
    return true;
  }

  rebuildLayerStats() {
    for (const layer of this.layers.values()) {
      layer.entityCount = 0;
      layer.visibleEntityCount = 0;
    }
    for (const entity of this.entities.values()) {
      const layerId = entity.layer || "0";
      if (!this.layers.has(layerId)) this.layers.set(layerId, { id: layerId, name: layerId, visible: true, locked: false, entityCount: 0, visibleEntityCount: 0 });
      const layer = this.layers.get(layerId);
      layer.entityCount += 1;
      if (entity.visible !== false && entity.deleted !== true) layer.visibleEntityCount += 1;
    }
  }

  restoreAll() {
    for (const entity of this.entities.values()) {
      entity.visible = true;
      entity.deleted = false;
      entity.selected = false;
      this.syncDocumentEntity(entity.id, { visible: true, deleted: false, selected: false });
    }
    this.selectedIds.clear();
    this.rebuildLayerStats();
    return true;
  }

  getSelectedIds() {
    return Array.from(this.selectedIds);
  }

  getStats() {
    this.normalizeSelection();
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
      selectedCount: this.selectedIds.size,
      kindCounts,
      classCounts,
      layers: Array.from(this.layers.values()).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))),
    };
  }

  syncDocumentEntity(id, patch = {}) {
    const docEntity = this.documentModel?.entities?.get?.(id);
    if (docEntity) Object.assign(docEntity, patch);
  }
}
