/**
 * ProjectPersistence.js
 * V21.3 - Delta-only persistence for heavy CAD/PDF files.
 *
 * Never stores full EntityRegistry arrays in localStorage.
 * Stores only real edits and small layer rules.
 */

const VERSION = "V21.3";
const SCHEMA = "essam-project-state@v21.3-delta-only";
const PREFIX = "essam-project-state-v10::";
const MAX_PAYLOAD_CHARS = 900_000;

const runtime = {
  lastSave: null,
  lastLoad: null,
  skipped: 0,
  saved: 0,
  lastWarningAt: 0,
};

export const ProjectPersistence = {
  version: VERSION,

  getKey(fileName = null) {
    return PREFIX + normalizeFileName(fileName || getCurrentFileName());
  },

  load(fileName = null) {
    try {
      const raw = localStorage.getItem(this.getKey(fileName));
      if (!raw) return null;
      const data = JSON.parse(raw);
      runtime.lastLoad = { fileName: fileName || getCurrentFileName(), chars: raw.length, at: new Date().toISOString() };
      return data && typeof data === "object" ? data : null;
    } catch (err) {
      warnThrottled("load failed", err);
      return null;
    }
  },

  save({ fileName = null, registry = null, edits = null, rules = null, settings = null } = {}) {
    const name = fileName || getCurrentFileName();
    const previous = this.load(name) || {};
    const registryDelta = buildRegistryDelta(registry);
    const compactRules = compactLayerRules(rules ?? previous.rules ?? null);
    const compactEdits = compactEditorEdits(edits ?? previous.edits ?? null);

    const data = {
      schema: SCHEMA,
      version: VERSION,
      fileName: name,
      savedAt: new Date().toISOString(),
      registryMode: "delta",
      registryDelta,
      edits: compactEdits,
      rules: compactRules,
      settings: compactSettings(settings ?? previous.settings ?? null),
    };

    let text = "";
    try { text = JSON.stringify(data); } catch (err) {
      runtime.skipped += 1;
      warnThrottled("stringify failed", err);
      return null;
    }

    if (text.length > MAX_PAYLOAD_CHARS) {
      // Keep rules/settings, drop deltas if something went wrong. Better to save small state than freeze the UI.
      data.registryDelta = [];
      data.edits = compactEdits ? shrinkEdits(compactEdits) : null;
      text = JSON.stringify(data);
    }

    try {
      localStorage.setItem(this.getKey(name), text);
      window.__essamProjectState = data;
      runtime.saved += 1;
      runtime.lastSave = {
        fileName: name,
        chars: text.length,
        registryDeltaCount: data.registryDelta?.length || 0,
        rulesCount: data.rules ? Object.keys(data.rules).length : 0,
        at: new Date().toISOString(),
      };
      window.dispatchEvent(new CustomEvent("cad:project-state-saved", { detail: { fileName: name, state: data } }));
      return data;
    } catch (err) {
      runtime.skipped += 1;
      warnThrottled("localStorage save skipped", {
        message: err?.message || String(err),
        fileName: name,
        chars: text.length,
        registryStats: registry?.getStats?.() || null,
        deltaCount: data.registryDelta?.length || 0,
      });
      return null;
    }
  },

  restoreRegistry(registry, { fileName = null, clearSelection = true } = {}) {
    if (!registry?.getAll) return false;
    const data = this.load(fileName);
    const delta = Array.isArray(data?.registryDelta) ? data.registryDelta : [];
    if (!delta.length) return false;

    const byId = new Map((registry.getAll({ includeDeleted: true }) || []).map((entity) => [entity.id, entity]));
    let applied = 0;
    for (const row of delta) {
      const entity = byId.get(row.id);
      if (!entity) continue;
      if (row.deleted === true) entity.deleted = true;
      if (row.visible === false) entity.visible = false;
      if (row.layer && row.layer !== entity.layer) entity.layer = row.layer;
      if (row.locked === true) entity.locked = true;
      applied += 1;
    }
    if (clearSelection) registry.clearSelection?.();
    registry.rebuildLayerStats?.();
    window.dispatchEvent(new CustomEvent("cad:project-state-restored", { detail: { fileName: fileName || getCurrentFileName(), applied } }));
    return applied > 0;
  },

  clear(fileName = null) {
    try { localStorage.removeItem(this.getKey(fileName)); return true; } catch (_) { return false; }
  },

  clearHeavyLegacy(minChars = 1_000_000) {
    const removed = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const value = localStorage.getItem(key) || "";
      if (value.length >= minChars || /exportState|entities|registry/.test(value.slice(0, 3000))) {
        localStorage.removeItem(key);
        removed.push({ key, chars: value.length });
      }
    }
    return { removedCount: removed.length, removed };
  },

  getSummary() {
    return {
      installed: true,
      version: VERSION,
      schema: SCHEMA,
      saved: runtime.saved,
      skipped: runtime.skipped,
      lastSave: runtime.lastSave,
      lastLoad: runtime.lastLoad,
    };
  },
};

try {
  window.ProjectPersistence = ProjectPersistence;
  window.__essamProjectPersistence = ProjectPersistence;
} catch (_) {}

function buildRegistryDelta(registry) {
  if (!registry?.getAll) return [];
  let all = [];
  try { all = registry.getAll({ includeDeleted: true }) || []; } catch (_) { return []; }

  const out = [];
  for (const entity of all) {
    if (!entity?.id) continue;
    const row = { id: entity.id };
    let changed = false;

    if (entity.deleted === true) { row.deleted = true; changed = true; }

    // visible=false is a real entity edit only if it is NOT just a LayerRulesPanel view toggle.
    if (entity.visible === false && entity.__essamLayerRuleViewHidden !== true) {
      row.visible = false;
      changed = true;
    }

    // Treat as moved only when originalLayer is explicit. Do not infer originalLayer from meta for huge PDF reads.
    if (entity.originalLayer && entity.layer && entity.layer !== entity.originalLayer) {
      row.layer = entity.layer;
      row.originalLayer = entity.originalLayer;
      changed = true;
    }

    if (entity.locked === true) { row.locked = true; changed = true; }
    if (changed) out.push(row);
  }
  return out.slice(0, 50000);
}

function compactLayerRules(rules) {
  if (!rules || typeof rules !== "object") return null;
  const out = {};
  for (const [name, rule] of Object.entries(rules)) {
    if (!rule || typeof rule !== "object") continue;
    out[name] = {
      type: rule.type || "lines",
      visible: rule.visible !== false,
      color: typeof rule.color === "string" ? rule.color : undefined,
      height: num(rule.height),
      thickness: num(rule.thickness),
      elevation: num(rule.elevation),
      intensity: num(rule.intensity),
      range: num(rule.range),
      lightSpacing: num(rule.lightSpacing),
      hasCeiling: rule.hasCeiling === true ? true : undefined,
    };
    Object.keys(out[name]).forEach((k) => out[name][k] === undefined && delete out[name][k]);
  }
  return out;
}

function compactEditorEdits(edits) {
  if (!edits || typeof edits !== "object") return null;
  const copyArray = (v) => Array.isArray(v) ? v.slice(0, 20000) : [];
  const copyObj = (v) => v && typeof v === "object" ? Object.fromEntries(Object.entries(v).slice(0, 20000)) : {};
  return {
    hiddenIds: copyArray(edits.hiddenIds),
    deletedIds: copyArray(edits.deletedIds),
    hiddenComponentIds: copyArray(edits.hiddenComponentIds),
    deletedComponentIds: copyArray(edits.deletedComponentIds),
    layerById: copyObj(edits.layerById),
    layerByComponentId: copyObj(edits.layerByComponentId),
  };
}

function shrinkEdits(edits) {
  if (!edits) return null;
  return {
    hiddenIds: (edits.hiddenIds || []).slice(0, 5000),
    deletedIds: (edits.deletedIds || []).slice(0, 5000),
    hiddenComponentIds: [],
    deletedComponentIds: [],
    layerById: {},
    layerByComponentId: {},
  };
}

function compactSettings(settings) {
  if (!settings || typeof settings !== "object") return null;
  return {
    scale: num(settings.scale),
    sunIntensity: num(settings.sunIntensity),
  };
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function getCurrentFileName() { return window.cadApp?.uploader?.file?.name || window.cadEntityLayerEditor?.fileName || "active-file"; }
function normalizeFileName(name) { return String(name || "active-file").trim().replace(/[^a-zA-Z0-9_.\-\u0600-\u06FF]+/g, "_").slice(0, 180) || "active-file"; }
function warnThrottled(message, payload) {
  const now = Date.now();
  if (now - runtime.lastWarningAt < 5000) return;
  runtime.lastWarningAt = now;
  console.warn(`[ProjectPersistence ${VERSION}] ${message}`, payload || "");
}
