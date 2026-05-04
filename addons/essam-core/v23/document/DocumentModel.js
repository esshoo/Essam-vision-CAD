/** DocumentModel.js - V23 */
import { makeEmptyPackage, normalizeLayer, normalizePage, normalizeEntity, validatePackage } from './DocumentSchema.js';
import { V23_EVENTS } from '../shared/EventBus.js';

export class DocumentModel {
  constructor({ eventBus = null, sourceFile = null, sourceType = 'unknown' } = {}) {
    this.eventBus = eventBus;
    this.package = makeEmptyPackage({ sourceFile, sourceType });
    this.entityIndex = new Map();
  }

  emit(name, payload) { this.eventBus?.emit?.(name, payload); }

  setSourceInfo(source = {}) {
    this.package.project.source = { ...this.package.project.source, ...source };
    this.touch();
  }

  touch() { this.package.project.updatedAt = new Date().toISOString(); }

  addPage(page) {
    const next = normalizePage(page);
    const exists = this.package.pages.some((p) => p.number === next.number);
    if (!exists) this.package.pages.push(next);
    this.package.pages.sort((a, b) => a.number - b.number);
    this.package.entitiesByPage[next.number] ||= [];
    this.package.textByPage[next.number] ||= [];
    this.package.imagesByPage[next.number] ||= [];
    this.touch();
    this.emit(V23_EVENTS.PAGE_ADDED, { page: next });
    return next;
  }

  upsertLayer(layer) {
    const next = normalizeLayer(layer);
    const index = this.package.layers.findIndex((l) => l.id === next.id || l.name === next.name);
    if (index >= 0) this.package.layers[index] = { ...this.package.layers[index], ...next };
    else this.package.layers.push(next);
    this.package.layers.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    this.touch();
    this.emit(V23_EVENTS.LAYER_CHANGED, { layer: next });
    return next;
  }

  addEntity(entity, { pageNumber = 1, index = 0 } = {}) {
    this.addPage({ number: pageNumber });
    this.upsertLayer({ name: entity.layer || entity.layerName || '0' });
    const next = normalizeEntity(entity, { pageNumber, index });
    this.package.entitiesByPage[next.page] ||= [];
    this.package.entitiesByPage[next.page].push(next);
    this.entityIndex.set(next.id, next);
    this.emit(V23_EVENTS.ENTITY_ADDED, { entity: next });
    return next;
  }

  addText(pageNumber, textItem) {
    this.addPage({ number: pageNumber });
    this.package.textByPage[pageNumber] ||= [];
    this.package.textByPage[pageNumber].push(textItem);
    this.touch();
  }

  addImage(pageNumber, imageItem) {
    this.addPage({ number: pageNumber });
    this.package.imagesByPage[pageNumber] ||= [];
    this.package.imagesByPage[pageNumber].push(imageItem);
    this.touch();
  }

  applyDelta(delta = {}) {
    const edits = this.package.edits;
    if (Array.isArray(delta.deleted)) edits.deleted.push(...delta.deleted);
    if (Array.isArray(delta.hidden)) edits.hidden.push(...delta.hidden);
    if (Array.isArray(delta.movedLayer)) edits.movedLayer.push(...delta.movedLayer);
    if (Array.isArray(delta.modified)) edits.modified.push(...delta.modified);
    this.touch();
    this.emit(V23_EVENTS.EDIT_APPLIED, { delta });
  }

  getEntities(pageNumber, { applyEdits = true } = {}) {
    const base = this.package.entitiesByPage[pageNumber] || [];
    if (!applyEdits) return base;
    const deleted = new Set(this.package.edits.deleted);
    const hidden = new Set(this.package.edits.hidden);
    const moved = new Map(this.package.edits.movedLayer.map((m) => [m.id, m.to]));
    return base
      .filter((e) => !deleted.has(e.id) && !hidden.has(e.id))
      .map((e) => moved.has(e.id) ? { ...e, layer: moved.get(e.id) } : e);
  }

  getStats() {
    const pageNumbers = Object.keys(this.package.entitiesByPage);
    const entityCount = pageNumbers.reduce((sum, p) => sum + (this.package.entitiesByPage[p]?.length || 0), 0);
    const textCount = Object.values(this.package.textByPage).reduce((sum, arr) => sum + (arr?.length || 0), 0);
    const imageCount = Object.values(this.package.imagesByPage).reduce((sum, arr) => sum + (arr?.length || 0), 0);
    return {
      version: this.package.project.version,
      source: this.package.project.source,
      pages: this.package.pages.length,
      layers: this.package.layers.length,
      entities: entityCount,
      texts: textCount,
      images: imageCount,
      edits: {
        deleted: this.package.edits.deleted.length,
        hidden: this.package.edits.hidden.length,
        movedLayer: this.package.edits.movedLayer.length,
        modified: this.package.edits.modified.length,
      },
      validation: validatePackage(this.package),
    };
  }
}
