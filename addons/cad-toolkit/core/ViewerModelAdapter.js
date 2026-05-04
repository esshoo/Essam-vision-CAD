/**
 * ViewerModelAdapter.js
 *
 * Purpose:
 * - Treat x-viewer as a parser/viewer, not as the source of truth.
 * - Read the richest model data available from viewer.loadedModels first.
 * - Expose model layers + objects in a clean shape that our CAD core can use.
 * - Fall back gracefully when PDF/DXF data does not expose real source layers.
 */

export class ViewerModelAdapter {
  constructor(viewer) {
    this.viewer = viewer || null;
  }

  getModels() {
    const models = this.viewer?.loadedModels;
    return Array.isArray(models) ? models.filter(Boolean) : [];
  }

  getCurrentModel() {
    const models = this.getModels();
    return models[models.length - 1] || null;
  }

  getModelObject(model) {
    if (!model) return null;
    try {
      if (typeof model.getModelObject === "function") return model.getModelObject();
    } catch (_) {}
    return model.object || model.modelObject || model.rootObject || null;
  }

  getModelSourceType(model) {
    if (!model) return "unknown";
    if (model.dxfData || model.modelData?.dxfData) return "dxf";
    if (model.pdfData || model.modelData?.pdfData) return "pdf";
    return "unknown";
  }

  getRawLayerTable(model) {
    if (!model) return null;
    try {
      if (model.layers) return model.layers;
    } catch (_) {}
    const data = model.dxfData || model.pdfData || model.modelData?.dxfData || model.modelData?.pdfData;
    return data?.tables?.LAYER?.entries || data?.layers || null;
  }

  getLayerNames(model) {
    const raw = this.getRawLayerTable(model);
    const names = new Set();

    if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        const name = normalizeLayerName(item?.name ?? item?.layerName ?? item?.Name ?? item ?? String(index));
        if (name) names.add(name);
      });
    } else if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, value]) => {
        const name = normalizeLayerName(value?.name ?? value?.layerName ?? value?.Name ?? key);
        if (name) names.add(name);
      });
    }

    const layeredObjects = this.getLayeredObjectMap(model);
    Object.keys(layeredObjects || {}).forEach((name) => names.add(normalizeLayerName(name)));

    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  getLayerMeta(model, layerName) {
    const raw = this.getRawLayerTable(model);
    if (!raw || !layerName) return {};
    if (Array.isArray(raw)) {
      return raw.find((item) => normalizeLayerName(item?.name ?? item?.layerName ?? item?.Name) === layerName) || {};
    }
    if (raw && typeof raw === "object") return raw[layerName] || {};
    return {};
  }

  getLayeredObjectMap(model) {
    if (!model) return {};
    const data = model.dxfData || model.pdfData || model.modelData?.dxfData || model.modelData?.pdfData;
    return data?.layersAndThreejsObjects || {};
  }

  getObjectsByLayer(model, layerName) {
    if (!model || !layerName) return [];
    try {
      if (typeof model.getObjectsByLayer === "function") {
        const list = model.getObjectsByLayer(layerName);
        if (Array.isArray(list)) return list.filter(Boolean);
      }
    } catch (_) {}
    const map = this.getLayeredObjectMap(model);
    const list = map?.[layerName];
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  collectLayerObjects({ respectVisibility = true } = {}) {
    const models = this.getModels();
    const layerObjects = new Map();
    const layerMeta = new Map();
    let directLayerObjectCount = 0;

    for (const model of models) {
      const modelId = model?.modelId || model?.id || "model";
      const sourceType = this.getModelSourceType(model);
      const names = this.getLayerNames(model);

      for (const layerName of names) {
        const cleanLayer = normalizeLayerName(layerName);
        if (!cleanLayer) continue;

        const rawObjects = this.getObjectsByLayer(model, cleanLayer);
        const objects = flattenDrawableObjects(rawObjects)
          .filter((obj) => !respectVisibility || isObjectVisibleInTree(obj));

        if (objects.length) {
          if (!layerObjects.has(cleanLayer)) layerObjects.set(cleanLayer, []);
          objects.forEach((obj) => {
            stampSourceMetadata(obj, { modelId, sourceType, layerName: cleanLayer });
            layerObjects.get(cleanLayer).push(obj);
          });
          directLayerObjectCount += objects.length;
        }

        if (!layerMeta.has(cleanLayer)) {
          layerMeta.set(cleanLayer, {
            name: cleanLayer,
            modelId,
            sourceType,
            raw: this.getLayerMeta(model, cleanLayer),
            objectCount: objects.length,
          });
        } else {
          layerMeta.get(cleanLayer).objectCount += objects.length;
        }
      }
    }

    return {
      source: directLayerObjectCount > 0 ? "model-layers" : "none",
      models,
      layerObjects,
      layerMeta,
      layers: Array.from(layerMeta.keys()).sort((a, b) => a.localeCompare(b)),
      stats: {
        modelCount: models.length,
        layerCount: layerMeta.size,
        layerObjectCount: directLayerObjectCount,
      },
    };
  }

  getModelReport() {
    const models = this.getModels();
    const layerObjects = this.collectLayerObjects({ respectVisibility: false });
    return {
      modelCount: models.length,
      currentModelId: this.getCurrentModel()?.modelId || null,
      models: models.map((model) => ({
        id: model?.modelId || model?.id || null,
        sourceType: this.getModelSourceType(model),
        loadedEntityCount: Number(model?.loadedEntityCount || 0),
        layerCount: this.getLayerNames(model).length,
        hasDxfData: !!(model?.dxfData || model?.modelData?.dxfData),
        hasPdfData: !!(model?.pdfData || model?.modelData?.pdfData),
        hasGetObjectsByLayer: typeof model?.getObjectsByLayer === "function",
        hasModelObject: !!this.getModelObject(model),
      })),
      layerCount: layerObjects.stats.layerCount,
      layerObjectCount: layerObjects.stats.layerObjectCount,
      bestSource: layerObjects.stats.layerObjectCount > 0 ? "model.getObjectsByLayer" : "scene-fallback-needed",
    };
  }
}

export function normalizeLayerName(value) {
  if (value === null || value === undefined) return "";
  const name = String(value).trim();
  return name || "0";
}

function stampSourceMetadata(obj, { modelId, sourceType, layerName }) {
  try {
    obj.userData = obj.userData || {};
    if (!obj.userData.modelId) obj.userData.modelId = modelId;
    if (!obj.userData.sourceType) obj.userData.sourceType = sourceType;
    if (!obj.userData.layer && !obj.userData.layerName && !obj.userData.dxfLayer) obj.userData.layer = layerName;
  } catch (_) {}
}

function flattenDrawableObjects(input) {
  const roots = Array.isArray(input) ? input : [input];
  const out = [];
  const stack = [...roots.filter(Boolean)];
  const visited = new Set();

  while (stack.length) {
    const obj = stack.pop();
    if (!obj || visited.has(obj)) continue;
    visited.add(obj);

    if (isDrawableObject(obj)) out.push(obj);
    if (Array.isArray(obj.children) && obj.children.length) stack.push(...obj.children);
  }

  return out;
}

function isDrawableObject(obj) {
  return !!(
    obj &&
    (obj.isLine || obj.type === "Line" ||
      obj.isLineSegments || obj.type === "LineSegments" ||
      obj.isLineLoop || obj.type === "LineLoop" ||
      obj.isMesh || obj.type === "Mesh") &&
    obj.geometry?.attributes?.position?.array
  );
}

function isObjectVisibleInTree(obj) {
  let cur = obj;
  while (cur) {
    if (cur.visible === false) return false;
    cur = cur.parent;
  }
  return true;
}
