/**
 * RegistryToDocumentPackageConverter.js - V23
 * Temporary bridge from the current EntityRegistry to the new DocumentModel. V23.1 adds source stats and safer diagnostics.
 * This lets us build the new system beside the current project without breaking it.
 */
import { DocumentModel } from '../document/DocumentModel.js';
import { makeEntityId } from '../shared/IdFactory.js';

export function convertRegistryToDocumentPackage({ registry = window.__essamEntityRegistry, sourceFile = null, eventBus = null } = {}) {
  const model = new DocumentModel({ eventBus, sourceFile, sourceType: inferSourceType(sourceFile) });
  const stats = registry?.getStats?.() || null;
  const all = registry?.getAll?.({ includeDeleted: true }) || [];
  const layerNames = registry?.getLayerNames?.() || [];

  model.addPage({ number: getCurrentPage(), width: 0, height: 0 });
  for (const name of layerNames) model.upsertLayer({ name, source: 'current-registry' });

  let index = 0;
  for (const entity of all) {
    const pageNumber = Number(entity.page || entity.pageNumber || getCurrentPage()) || 1;
    const type = normalizeKind(entity.kind || entity.type || entity.className);
    const layer = entity.layer || entity.layerName || '0';
    const points = normalizePoints(entity.points || entity.vertices || []);
    const id = entity.id || makeEntityId({ source: sourceFile?.name || 'registry', page: pageNumber, layer, type, index, points });
    model.addEntity({
      id,
      type,
      page: pageNumber,
      layer,
      points,
      bbox: entity.bbox || entity.bounds || null,
      style: extractStyle(entity),
      source: 'current-registry',
      rawRef: entity.id || null,
    }, { pageNumber, index });
    index += 1;
  }

  model.package.warnings.push({
    code: 'V23_BRIDGE_MODE',
    message: 'Package generated from current EntityRegistry bridge, not from final parser adapter.',
    registryStats: stats,
    sourceCounts: {
      registryGetAll: all.length,
      registryLayerNames: layerNames.length,
      packageLayers: model.package.layers.length,
      packageEntities: Object.values(model.package.entitiesByPage || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0),
    },
  });

  return { model, package: model.package, stats: model.getStats() };
}

function getCurrentPage() {
  return Number(window.cadApp?._pdfCurrentPage || window.currentPdfPage || window.cadDrawingOverlay?.currentPage || 1) || 1;
}

function inferSourceType(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.dxf')) return 'dxf';
  if (name.endsWith('.dwg')) return 'dwg';
  return 'unknown';
}

function normalizeKind(kind = '') {
  const k = String(kind).toLowerCase();
  if (k.includes('poly')) return 'polyline';
  if (k.includes('circle')) return 'circle';
  if (k.includes('arc')) return 'arc';
  if (k.includes('text')) return 'text';
  if (k.includes('image')) return 'image';
  if (k.includes('line')) return 'line';
  return k || 'unknown';
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.map((p) => {
    if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0];
    return [Number(p.x) || 0, Number(p.y) || 0];
  });
}

function extractStyle(entity) {
  return {
    stroke: entity.color || entity.stroke || entity.meta?.color || '#000000',
    width: Number(entity.lineWidth || entity.strokeWidth || entity.meta?.lineWidth || 1) || 1,
  };
}
