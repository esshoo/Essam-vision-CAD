/**
 * ProjectState.js
 *
 * Central autosave/state layer for Essam Vision CAD.
 * This is the bridge that makes entity edits visible to:
 * - Entity editor
 * - Layer rules panel
 * - 3D exporter/preview
 * - Project export tools
 */

const STORAGE_PREFIX = "essam-project-state-v1";

function safeParse(raw, fallback = null) {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

function safeClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function cleanFileName(name) {
  return String(name || "active-file").trim() || "active-file";
}

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const ProjectState = {
  getFileName(fileName = null) {
    return cleanFileName(
      fileName ||
      window?.cadApp?.currentFileName ||
      window?.cadApp?.uploader?.file?.name ||
      window?.cadEntityLayerEditor?.fileName ||
      "active-file"
    );
  },

  getProjectName(fileName = null) {
    return this.getFileName(fileName).replace(/\.(pdf|dxf|dwg)$/i, "");
  },

  key(fileName = null) {
    return `${STORAGE_PREFIX}::${this.getFileName(fileName)}`;
  },

  load(fileName = null) {
    return safeParse(localStorage.getItem(this.key(fileName)), null);
  },

  remove(fileName = null) {
    try { localStorage.removeItem(this.key(fileName)); } catch (_) {}
  },

  collectRuntime(extra = {}) {
    const fileName = this.getFileName(extra.fileName);
    const registry = extra.registry || window.__essamEntityRegistry || null;
    const documentModel = extra.documentModel || window.__essamDocumentModel || null;
    const layerRules = extra.layerRules || window.layerRulesUI?.getRules?.() || safeParse(localStorage.getItem("cad-layer-rules:active"), {}) || {};
    const globalSettings = extra.globalSettings || window.layerRulesUI?.getGlobalSettings?.() || {};

    return {
      schema: "essam-project-state@1",
      savedAt: new Date().toISOString(),
      reason: extra.reason || "autosave",
      fileName,
      projectName: this.getProjectName(fileName),
      registry: registry?.exportState?.() || null,
      documentModel: documentModel?.toJSON?.() || null,
      layerRules: safeClone(layerRules || {}),
      globalSettings: safeClone(globalSettings || {}),
    };
  },

  saveRuntime(extra = {}) {
    const state = this.collectRuntime(extra);
    try {
      localStorage.setItem(this.key(state.fileName), JSON.stringify(state));
      window.__essamProjectState = state;
      window.dispatchEvent(new CustomEvent("cad:project-state-saved", { detail: { state, reason: state.reason } }));
    } catch (err) {
      console.warn("[ProjectState] autosave failed", err);
    }
    return state;
  },

  applyToRuntime({ registry = null, documentModel = null, fileName = null } = {}) {
    const state = this.load(fileName);
    if (!state) return null;

    try {
      if (registry && state.registry) registry.restoreState?.(state.registry);
      // DocumentModel is synced by registry.restoreState(). Keep direct layer meta best-effort only.
      if (documentModel && state.documentModel?.layers) {
        for (const savedLayer of state.documentModel.layers) {
          const layer = documentModel.layers?.get?.(savedLayer.id);
          if (!layer) continue;
          if (savedLayer.type) layer.type = savedLayer.type;
          if (savedLayer.visible !== undefined) layer.visible = savedLayer.visible !== false;
          if (savedLayer.locked !== undefined) layer.locked = savedLayer.locked === true;
        }
      }
      window.__essamProjectState = state;
      window.dispatchEvent(new CustomEvent("cad:project-state-restored", { detail: { state, registry, documentModel } }));
      return state;
    } catch (err) {
      console.warn("[ProjectState] restore failed", err);
      return null;
    }
  },

  getLayerRules(fallback = {}) {
    const state = this.load();
    return safeClone(state?.layerRules || fallback || {});
  },

  getGlobalSettings(fallback = {}) {
    const state = this.load();
    return safeClone(state?.globalSettings || fallback || {});
  },

  getRuntimeRawData({ includeHidden = false, includeDeleted = false, includeAnnotations = true } = {}) {
    const registry = window.__essamEntityRegistry || null;
    const layerSet = new Set();
    const entities = [];

    if (registry?.listLayers) {
      registry.listLayers().forEach((layer) => layerSet.add(layer.id || layer.name));
    }

    if (registry?.getAll) {
      registry.getAll({ includeDeleted: true }).forEach((entity) => {
        const layer = entity.layer || "0";
        layerSet.add(layer);
        if (!includeDeleted && entity.deleted === true) return;
        if (!includeHidden && entity.visible === false) return;
        entities.push({
          id: entity.id,
          sourceId: entity.sourceId || entity.id,
          layer,
          kind: entity.kind || "LINE",
          entityClass: entity.entityClass || "geometry",
          points: safeClone(entity.points || []),
          bbox: safeClone(entity.bbox || null),
          text: entity.text || null,
          image: entity.image || null,
          meta: safeClone(entity.meta || {}),
          visible: entity.visible !== false,
          deleted: entity.deleted === true,
        });
      });
    }

    if (includeAnnotations) {
      try {
        const annotationLayers = window.cadDrawingOverlay?.getAnnotationLayerNames?.() || [];
        annotationLayers.forEach((name) => layerSet.add(name));
        const annotationEntities = window.cadDrawingOverlay?.get3DEntities?.() || [];
        annotationEntities.forEach((entity) => {
          if (entity?.layer) layerSet.add(entity.layer);
          entities.push(entity);
        });
      } catch (err) {
        console.warn("[ProjectState] failed to merge annotations", err);
      }
    }

    return {
      source: registry ? "project-state-runtime" : "none",
      layers: Array.from(layerSet).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
      entities,
      documentModel: window.__essamDocumentModel || null,
      entityRegistry: registry,
    };
  },

  downloadProjectJSON() {
    const state = this.saveRuntime({ reason: "manual-project-export" });
    const name = `${this.getProjectName(state.fileName)}.essam-project.json`;
    downloadText(name, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    return state;
  },

  _downloadText: downloadText,
};

try { window.ProjectState = ProjectState; } catch (_) {}
