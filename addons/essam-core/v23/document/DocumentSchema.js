/**
 * DocumentSchema.js - V23
 * Stable contracts for Essam Document Package.
 */
import { makeLayerId, makePageId } from '../shared/IdFactory.js';

export const V23_DOCUMENT_VERSION = '1.0.0-draft';

export const ENTITY_TYPES = Object.freeze({
  LINE: 'line',
  POLYLINE: 'polyline',
  CIRCLE: 'circle',
  ARC: 'arc',
  RECT: 'rect',
  TEXT: 'text',
  IMAGE: 'image',
  UNKNOWN: 'unknown',
});

export const LAYER_3D_TYPES = Object.freeze({
  HIDE: 'hide',
  LINES: 'lines',
  WALLS: 'walls',
  FLOOR: 'floor',
  CEILING: 'ceiling',
  GLASS: 'glass',
  BEAMS: 'beams',
  DOOR: 'door',
  LIGHTS: 'lights',
  FURNITURE: 'furniture',
});

export function makeProjectMeta({ sourceFile = null, sourceType = 'unknown' } = {}) {
  return {
    version: V23_DOCUMENT_VERSION,
    app: 'Essam Vision CAD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: 'unknown',
    source: {
      type: sourceType,
      name: sourceFile?.name || 'active-file',
      size: sourceFile?.size || 0,
      mime: sourceFile?.type || '',
      hash: null,
    },
  };
}

export function makeEmptyPackage({ sourceFile = null, sourceType = 'unknown' } = {}) {
  return {
    project: makeProjectMeta({ sourceFile, sourceType }),
    pages: [],
    layers: [],
    entitiesByPage: {},
    textByPage: {},
    imagesByPage: {},
    annotations: [],
    edits: {
      deleted: [],
      hidden: [],
      movedLayer: [],
      modified: [],
    },
    warnings: [],
  };
}

export function normalizeLayer(layer = {}) {
  const name = String(layer.name || layer.id || '0').trim() || '0';
  return {
    id: layer.id || makeLayerId(name),
    name,
    visible2D: layer.visible2D !== false,
    locked: layer.locked === true,
    type3D: layer.type3D || layer.type || LAYER_3D_TYPES.LINES,
    color: layer.color || '#cccccc',
    order: Number.isFinite(Number(layer.order)) ? Number(layer.order) : 0,
    source: layer.source || 'parser',
  };
}

export function normalizePage(page = {}) {
  const number = Number(page.number || page.pageNumber || 1) || 1;
  return {
    id: page.id || makePageId(number),
    number,
    width: Number(page.width || 0),
    height: Number(page.height || 0),
    rotation: Number(page.rotation || 0),
  };
}

export function normalizeEntity(entity = {}, { pageNumber = 1, index = 0 } = {}) {
  const type = String(entity.type || entity.kind || ENTITY_TYPES.UNKNOWN).toLowerCase();
  const layer = String(entity.layer || entity.layerName || '0');
  return {
    id: entity.id || `e_missing_${pageNumber}_${index}`,
    type,
    page: Number(entity.page || entity.pageNumber || pageNumber) || pageNumber,
    layer,
    points: Array.isArray(entity.points) ? entity.points : [],
    bbox: entity.bbox || null,
    style: entity.style || {},
    source: entity.source || 'parser',
    rawRef: entity.rawRef || null,
  };
}

export function validatePackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object') errors.push('Package must be an object.');
  if (!pkg?.project?.version) errors.push('project.version is required.');
  if (!Array.isArray(pkg?.pages)) errors.push('pages must be an array.');
  if (!Array.isArray(pkg?.layers)) errors.push('layers must be an array.');
  if (!pkg?.entitiesByPage || typeof pkg.entitiesByPage !== 'object') errors.push('entitiesByPage must be an object.');
  return { ok: errors.length === 0, errors };
}
