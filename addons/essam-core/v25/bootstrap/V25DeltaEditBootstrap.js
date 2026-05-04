/**
 * V25DeltaEditBootstrap.js
 * V25.6 - Delta Edit System + Layer Dropdown Polish + Persistence Reports
 *
 * Safe edit layer for the new V23/V24 architecture.
 * Does not modify original registry or source files.
 */
import { DeltaEditStore, createEmptyEdits, normalizeIds } from '../core/DeltaEditStore.js';

const VERSION = 'V25.6-layer-dropdown-persistence-report';
const DB_NAME = 'essam_v25_delta_edits';
const STORE_NAME = 'edits';

const state = {
  installedAt: new Date().toISOString(),
  store: new DeltaEditStore(createEmptyEdits()),
  lastApply: null,
  lastSave: null,
  lastLoad: null,
  debug: false,
  autoApply: true,
  autoLoad: true,
  wrappedV24: false,
  loadedKeys: new Set(),
  lastAutoApply: null,
  lastMoveReport: null,
  applyCount: 0,
  panel: null,
  panelVisible: false,
  panelAutoRefresh: true,
  svgToolbar: null,
  svgToolbarVisible: true,
  lastPersistenceReport: null,
  lastToolbarLayerOptions: null,
};

function getProjectKey() {
  const file = window.__essamV23?.getSummary?.()?.currentFile || null;
  return `${file?.name || 'active-file'}|${file?.size || 0}`;
}

function getSelectedIdsFromV24() {
  const rows = window.__essamV24?.getSelectedSvgEntities?.()?.entities || [];
  return normalizeIds(rows.map((e) => e.id));
}

function getActiveSvg() {
  return document.querySelector('#essam-v24-svg-preview svg[data-essam-svg]') || null;
}

function getEntityElementById(entityId) {
  const svg = getActiveSvg();
  if (!svg || !entityId) return null;
  const id = String(entityId);
  return Array.from(svg.querySelectorAll('[data-entity-id]')).find((el) => String(el.getAttribute('data-entity-id') || '') === id) || null;
}

function makeLayerDomId(layerName) {
  return `layer-${String(layerName || '0').replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]+/g, '-')}`;
}

function ensureSvgLayerGroup(layerName) {
  const svg = getActiveSvg();
  if (!svg) return null;
  const layer = String(layerName || '0');
  let group = Array.from(svg.querySelectorAll('g.essam-layer[data-layer]')).find((g) => String(g.getAttribute('data-layer') || '') === layer);
  if (group) return group;
  const pageGroup = svg.querySelector('g.essam-page') || svg;
  group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'essam-layer');
  group.setAttribute('id', makeLayerDomId(layer));
  group.setAttribute('data-layer', layer);
  group.setAttribute('data-visible2d', 'true');
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = layer;
  group.appendChild(title);
  pageGroup.appendChild(group);
  return group;
}

function resetMovedEntitiesToOriginalLayers(svg) {
  let movedBack = 0;
  svg.querySelectorAll('[data-entity-id]').forEach((el) => {
    if (!el.hasAttribute('data-original-layer')) {
      el.setAttribute('data-original-layer', el.getAttribute('data-layer') || '0');
    }
    const original = el.getAttribute('data-original-layer') || el.getAttribute('data-layer') || '0';
    if (String(el.getAttribute('data-layer') || '') !== original) {
      const group = ensureSvgLayerGroup(original);
      if (group) {
        group.appendChild(el);
        el.setAttribute('data-layer', original);
        el.removeAttribute('data-edit-moved-layer');
        movedBack += 1;
      }
    }
  });
  return movedBack;
}

function buildMovesFromSelected(targetLayer) {
  const to = String(targetLayer || '').trim();
  if (!to) return [];
  const rows = window.__essamV24?.getSelectedSvgEntities?.()?.entities || [];
  return rows.map((row) => {
    const el = getEntityElementById(row.id);
    const from = el?.getAttribute?.('data-layer') || row.layer || el?.getAttribute?.('data-original-layer') || '0';
    return { id: row.id, from, to };
  }).filter((move) => move.id && move.to && move.from !== move.to);
}

function applyEditsToSvg() {
  const svg = getActiveSvg();
  if (!svg) return { ok: false, reason: 'no-active-v24-svg' };
  let touched = 0;
  const edits = state.store.toJSON();
  const hidden = new Set(edits.hidden || []);
  const deleted = new Set(edits.deleted || []);
  const movedLayer = Array.isArray(edits.movedLayer) ? edits.movedLayer : [];

  resetMovedEntitiesToOriginalLayers(svg);

  let movedApplied = 0;
  let movedMissing = 0;
  const movedByTarget = {};
  for (const move of movedLayer) {
    const id = String(move?.id || '');
    const to = String(move?.to || move?.toLayer || '');
    if (!id || !to) continue;
    const el = getEntityElementById(id);
    const targetGroup = ensureSvgLayerGroup(to);
    if (el && targetGroup) {
      if (!el.hasAttribute('data-original-layer')) el.setAttribute('data-original-layer', el.getAttribute('data-layer') || move.from || '0');
      targetGroup.appendChild(el);
      el.setAttribute('data-layer', to);
      el.setAttribute('data-edit-moved-layer', to);
      el.setAttribute('data-edit-from-layer', move.from || el.getAttribute('data-original-layer') || '0');
      movedApplied += 1;
      movedByTarget[to] = (movedByTarget[to] || 0) + 1;
    } else {
      movedMissing += 1;
    }
  }

  svg.querySelectorAll('[data-entity-id]').forEach((el) => {
    const id = String(el.getAttribute('data-entity-id') || '');
    const isDeleted = deleted.has(id);
    const isHidden = hidden.has(id);
    el.style.display = isDeleted || isHidden ? 'none' : '';
    if (isDeleted) el.setAttribute('data-edit-deleted', 'true'); else el.removeAttribute('data-edit-deleted');
    if (isHidden) el.setAttribute('data-edit-hidden', 'true'); else el.removeAttribute('data-edit-hidden');
    touched += 1;
  });

  const layerPanel = window.__essamV24?.refreshSvgLayerPanel?.({ preserveScroll: true }) || null;
  state.applyCount += 1;
  state.lastMoveReport = { movedApplied, movedMissing, movedByTarget, totalMoves: movedLayer.length };
  state.lastApply = { at: new Date().toISOString(), touched, movedApplied, movedMissing, movedByTarget, stats: state.store.getStats(), layerPanel };
  window.dispatchEvent(new CustomEvent('essam:v25:edits-applied', { detail: { version: VERSION, touched, movedApplied, movedMissing, stats: state.store.getStats() } }));
  refreshEditPanel();
  refreshSvgEditToolbar();
  return { ok: true, touched, movedApplied, movedMissing, movedByTarget, edits, stats: state.store.getStats(), layerPanel };
}

async function ensureEditsLoadedForCurrentProject(options = {}) {
  const projectKey = options.key || getProjectKey();
  if (!options.force && state.loadedKeys.has(projectKey)) {
    return { ok: true, skipped: true, reason: 'already-loaded', key: projectKey, stats: getStats() };
  }
  const db = await openDb();
  const payload = await idbGet(db, STORE_NAME, projectKey);
  state.loadedKeys.add(projectKey);
  if (!payload?.edits) return { ok: false, reason: 'not-found', key: projectKey };
  state.store = new DeltaEditStore(payload.edits);
  state.lastLoad = { ok: true, key: projectKey, loadedAt: new Date().toISOString(), stats: getStats(), source: 'auto-load' };
  return state.lastLoad;
}

async function loadAndApplyEditsFromIndexedDb(key = null, options = {}) {
  const result = await ensureEditsLoadedForCurrentProject({ key: key || getProjectKey(), force: true });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

async function autoLoadAndApplyEdits(reason = 'auto') {
  if (!state.autoApply) return { ok: false, skipped: true, reason: 'auto-apply-disabled' };
  let load = null;
  if (state.autoLoad) {
    try { load = await ensureEditsLoadedForCurrentProject(); }
    catch (err) { load = { ok: false, reason: 'auto-load-error', message: err?.message || String(err) }; }
  }
  const apply = applyEditsToSvg();
  state.lastAutoApply = { at: new Date().toISOString(), reason, load, apply };
  return state.lastAutoApply;
}

function wrapV24PreviewFunctions() {
  const v24 = window.__essamV24;
  if (!v24 || state.wrappedV24) return { ok: false, reason: v24 ? 'already-wrapped' : 'v24-not-found' };
  const names = [
    'showSvgPreview',
    'showSvgPreviewNormal',
    'showSvgPreviewFlipped',
    'showSvgFullCoveragePreview',
    'showSvgProgressivePreview',
    'showSvgProgressivePreviewNormal',
    'showSvgProgressivePreviewFlipped',
  ];
  const wrapped = [];
  for (const name of names) {
    if (typeof v24[name] !== 'function' || v24[name].__essamV25Wrapped) continue;
    const original = v24[name].bind(v24);
    const fn = function v25WrappedV24Preview(...args) {
      const out = original(...args);
      if (out && typeof out.then === 'function') {
        return out.then(async (result) => {
          await autoLoadAndApplyEdits(`v24:${name}`);
          ensureSvgEditToolbar();
          refreshSvgEditToolbar();
          return result;
        });
      }
      // Synchronous preview render.
      autoLoadAndApplyEdits(`v24:${name}`).finally?.(() => { ensureSvgEditToolbar(); refreshSvgEditToolbar(); });
      ensureSvgEditToolbar();
      refreshSvgEditToolbar();
      return out;
    };
    fn.__essamV25Wrapped = true;
    fn.__essamV25Original = original;
    v24[name] = fn;
    wrapped.push(name);
  }
  state.wrappedV24 = true;
  return { ok: true, wrapped };
}

function setAutoApply(value = true) {
  state.autoApply = value !== false;
  return getSummary();
}

function setAutoLoad(value = true) {
  state.autoLoad = value !== false;
  return getSummary();
}

function resetLoadedEditCache() {
  state.loadedKeys.clear();
  return getSummary();
}

function hideSelectedAsEdit() {
  const ids = getSelectedIdsFromV24();
  const result = state.store.hide(ids, { source: 'v24-selection' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function unhideSelectedAsEdit() {
  const ids = getSelectedIdsFromV24();
  const result = state.store.unhide(ids, { source: 'v24-selection' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function deleteSelectedAsEdit() {
  const ids = getSelectedIdsFromV24();
  const result = state.store.delete(ids, { source: 'v24-selection' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function restoreSelectedAsEdit() {
  const ids = getSelectedIdsFromV24();
  const result = state.store.restore(ids, { source: 'v24-selection' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function moveSelectedToLayerAsEdit(targetLayer) {
  const moves = buildMovesFromSelected(targetLayer);
  const result = state.store.moveLayer(moves, { source: 'v24-selection', targetLayer });
  const apply = applyEditsToSvg();
  return { ...result, moves, apply };
}

function moveIdsToLayerAsEdit(ids, targetLayer, fromLayer = null) {
  const to = String(targetLayer || '').trim();
  const moves = normalizeIds(ids).map((id) => {
    const el = getEntityElementById(id);
    return { id, from: fromLayer || el?.getAttribute?.('data-layer') || el?.getAttribute?.('data-original-layer') || '0', to };
  }).filter((move) => move.id && move.to && move.from !== move.to);
  const result = state.store.moveLayer(moves, { source: 'manual-ids', targetLayer });
  const apply = applyEditsToSvg();
  return { ...result, moves, apply };
}

function getAvailableSvgLayers() {
  const rows = window.__essamV24?.getSvgDomLayerStats?.()?.layers || [];
  return { ok: true, layers: rows.map((row) => row.layer), rows };
}

function getMovedLayerReport() {
  const edits = state.store.toJSON();
  const moves = Array.isArray(edits.movedLayer) ? edits.movedLayer : [];
  const byTarget = {};
  const bySource = {};
  for (const move of moves) {
    const to = String(move?.to || move?.toLayer || '');
    const from = String(move?.from || move?.fromLayer || '');
    if (to) byTarget[to] = (byTarget[to] || 0) + 1;
    if (from) bySource[from] = (bySource[from] || 0) + 1;
  }
  return { ok: true, version: VERSION, totalMoves: moves.length, byTarget, bySource, moves, lastMoveReport: state.lastMoveReport };
}

function verifyLayerMoveApplication() {
  const moves = state.store.toJSON().movedLayer || [];
  const rows = moves.map((move) => {
    const el = getEntityElementById(move.id);
    return {
      id: move.id,
      expectedLayer: move.to,
      currentLayer: el?.getAttribute?.('data-layer') || null,
      existsInDom: !!el,
      ok: !!el && String(el.getAttribute('data-layer') || '') === String(move.to || ''),
    };
  });
  return { ok: rows.every((row) => row.ok), version: VERSION, checked: rows.length, failed: rows.filter((row) => !row.ok).length, rows };
}

function hideIdsAsEdit(ids) {
  const result = state.store.hide(ids, { source: 'manual-ids' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function deleteIdsAsEdit(ids) {
  const result = state.store.delete(ids, { source: 'manual-ids' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function undo() {
  const result = state.store.undo();
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function redo() {
  const result = state.store.redo();
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function clearEdits() {
  const result = state.store.clearAll({ source: 'clearEdits' });
  const apply = applyEditsToSvg();
  return { ...result, apply };
}

function getEdits() {
  return state.store.toJSON();
}

function getStats() {
  return state.store.getStats();
}

function exportEditsJson(fileName = null) {
  const edits = getEdits();
  const name = sanitizeFileName(fileName || `${getProjectKey()}_v25_edits.json`);
  const blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, fileName: name, size: blob.size, stats: getStats() };
}

async function saveEditsToIndexedDb(key = null) {
  const db = await openDb();
  const projectKey = key || getProjectKey();
  const payload = { key: projectKey, savedAt: new Date().toISOString(), edits: getEdits(), stats: getStats() };
  await idbPut(db, STORE_NAME, payload);
  state.loadedKeys.add(projectKey);
  state.lastSave = { ok: true, key: projectKey, savedAt: payload.savedAt, stats: payload.stats };
  return state.lastSave;
}

async function loadEditsFromIndexedDb(key = null) {
  return loadAndApplyEditsFromIndexedDb(key, { source: 'manual-load' });
}

async function getEditPersistenceReport(options = {}) {
  const key = options.key || getProjectKey();
  const db = await openDb();
  const payload = await idbGet(db, STORE_NAME, key);
  const verify = verifyLayerMoveApplication();
  const svgLayers = window.__essamV24?.getSvgDomLayerStats?.() || null;
  const report = {
    ok: true,
    version: VERSION,
    key,
    savedExists: !!payload,
    savedAt: payload?.savedAt || null,
    savedStats: payload?.stats || null,
    currentStats: getStats(),
    currentEdits: getEdits(),
    lastSave: state.lastSave,
    lastLoad: state.lastLoad,
    autoApply: state.autoApply,
    autoLoad: state.autoLoad,
    verifyLayerMoves: verify,
    svgLayerCount: svgLayers?.layerCount ?? null,
    svgVisibleLayers: svgLayers?.visibleCount ?? null,
    toolbarLayerOptions: state.lastToolbarLayerOptions || getLayerMoveOptions(),
    generatedAt: new Date().toISOString(),
  };
  state.lastPersistenceReport = report;
  return report;
}

async function saveEditsAndGetReport(key = null) {
  const save = await saveEditsToIndexedDb(key);
  const report = await getEditPersistenceReport({ key: key || getProjectKey() });
  return { ok: true, save, report };
}

async function loadEditsAndGetReport(key = null) {
  const load = await loadEditsFromIndexedDb(key);
  const report = await getEditPersistenceReport({ key: key || getProjectKey() });
  return { ok: true, load, report };
}

async function exportEditPersistenceReport(fileName = null) {
  const report = await getEditPersistenceReport();
  const name = sanitizeFileName(fileName || `${getProjectKey()}_v25_6_edit_persistence_report.json`);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, fileName: name, size: blob.size, report };
}



function getV24Overlay() {
  return document.getElementById('essam-v24-svg-preview');
}

function getV24Actions() {
  return getV24Overlay()?.querySelector?.('.essam-v24-actions') || null;
}

function getSelectedCountFromV24() {
  return Number(window.__essamV24?.getSelectedSvgEntities?.()?.selectedCount || 0);
}

function getLayerMoveOptions(options = {}) {
  const selected = window.__essamV24?.getSelectedSvgEntities?.() || { entities: [] };
  const selectedLayers = new Set((selected.entities || []).map((row) => String(row.layer || '')).filter(Boolean));
  const movedReport = getMovedLayerReport();
  const rows = (window.__essamV24?.getSvgDomLayerStats?.()?.layers || []).map((row) => {
    const layer = String(row.layer || '0');
    const movedToCount = Number(movedReport.byTarget?.[layer] || 0);
    const movedFromCount = Number(movedReport.bySource?.[layer] || 0);
    const isSelectedSource = selectedLayers.has(layer);
    return {
      layer,
      entityCount: Number(row.entityCount || 0),
      visible: row.visible !== false,
      selectedSource: isSelectedSource,
      movedToCount,
      movedFromCount,
      label: `${layer} (${Number(row.entityCount || 0)}${movedToCount ? ` · moved ${movedToCount}` : ''}${isSelectedSource ? ' · current' : ''})`,
    };
  }).sort((a, b) => {
    if (a.selectedSource !== b.selectedSource) return a.selectedSource ? 1 : -1;
    if (b.movedToCount !== a.movedToCount) return b.movedToCount - a.movedToCount;
    return b.entityCount - a.entityCount || a.layer.localeCompare(b.layer);
  });
  const recommendedTarget = rows.find((row) => !row.selectedSource)?.layer || rows[0]?.layer || '';
  return { ok: true, version: VERSION, selectedLayers: Array.from(selectedLayers), recommendedTarget, rows };
}

function getToolbarTargetLayer(toolbar = state.svgToolbar) {
  const inputValue = toolbar?.querySelector?.('[data-v25-tb-layer]')?.value?.trim?.() || '';
  const selectValue = toolbar?.querySelector?.('[data-v25-tb-layer-select]')?.value?.trim?.() || '';
  return inputValue || selectValue;
}

function setToolbarTargetLayer(layerName) {
  const toolbar = state.svgToolbar || getV24Overlay()?.querySelector?.('#essam-v25-svg-toolbar');
  const layer = String(layerName || '').trim();
  if (!toolbar) return { ok: false, reason: 'toolbar-not-created' };
  const select = toolbar.querySelector('[data-v25-tb-layer-select]');
  const input = toolbar.querySelector('[data-v25-tb-layer]');
  if (select && Array.from(select.options).some((option) => option.value === layer)) {
    select.value = layer;
    if (input) input.value = '';
  } else if (input) {
    input.value = layer;
  }
  return { ok: true, targetLayer: getToolbarTargetLayer(toolbar), toolbar: getSvgEditToolbarSummary() };
}

function ensureSvgEditToolbar() {
  const overlay = getV24Overlay();
  if (!overlay) return { ok: false, reason: 'v24-overlay-not-found' };
  injectSvgToolbarStyles();
  let toolbar = overlay.querySelector('#essam-v25-svg-toolbar');
  if (toolbar) {
    state.svgToolbar = toolbar;
    toolbar.style.display = state.svgToolbarVisible ? 'flex' : 'none';
    return { ok: true, exists: true };
  }
  toolbar = document.createElement('div');
  toolbar.id = 'essam-v25-svg-toolbar';
  toolbar.innerHTML = `
    <div class="essam-v25-svg-toolbar-left">
      <strong>V25 Edits</strong>
      <span data-v25-toolbar-selection>0 selected</span>
      <span data-v25-toolbar-stats></span>
    </div>
    <div class="essam-v25-svg-toolbar-actions">
      <button type="button" data-v25-tb="hide">Hide</button>
      <button type="button" data-v25-tb="delete">Delete</button>
      <button type="button" data-v25-tb="restore">Restore</button>
      <select data-v25-tb-layer-select title="Move selected to layer"></select>
      <input data-v25-tb-layer type="text" placeholder="or new layer">
      <button type="button" data-v25-tb="move">Move</button>
      <button type="button" data-v25-tb="undo">Undo</button>
      <button type="button" data-v25-tb="redo">Redo</button>
      <button type="button" data-v25-tb="save">Save</button>
      <button type="button" data-v25-tb="load">Load</button>
      <button type="button" data-v25-tb="panel">Panel</button>
    </div>
  `;
  const header = overlay.querySelector('.essam-v24-header');
  const main = overlay.querySelector('.essam-v24-main');
  if (main?.parentNode) main.parentNode.insertBefore(toolbar, main);
  else if (header?.parentNode) header.parentNode.insertBefore(toolbar, header.nextSibling);
  else overlay.prepend(toolbar);

  bindSvgToolbar(toolbar);
  state.svgToolbar = toolbar;
  toolbar.style.display = state.svgToolbarVisible ? 'flex' : 'none';
  refreshSvgEditToolbar();
  return { ok: true, created: true };
}

function bindSvgToolbar(toolbar) {
  if (!toolbar || toolbar.__essamV25ToolbarBound) return;
  toolbar.__essamV25ToolbarBound = true;
  toolbar.querySelector('[data-v25-tb="hide"]')?.addEventListener('click', () => toolbarRun('hideSelectedAsEdit', () => hideSelectedAsEdit()));
  toolbar.querySelector('[data-v25-tb="delete"]')?.addEventListener('click', () => toolbarRun('deleteSelectedAsEdit', () => deleteSelectedAsEdit()));
  toolbar.querySelector('[data-v25-tb="restore"]')?.addEventListener('click', () => toolbarRun('restoreSelectedAsEdit', () => restoreSelectedAsEdit()));
  toolbar.querySelector('[data-v25-tb="move"]')?.addEventListener('click', () => {
    const layer = getToolbarTargetLayer(toolbar);
    toolbarRun('moveSelectedToLayerAsEdit', () => moveSelectedToLayerAsEdit(layer));
  });
  toolbar.querySelector('[data-v25-tb-layer-select]')?.addEventListener('change', () => {
    const input = toolbar.querySelector('[data-v25-tb-layer]');
    if (input) input.value = '';
  });
  toolbar.querySelector('[data-v25-tb="undo"]')?.addEventListener('click', () => toolbarRun('undo', () => undo()));
  toolbar.querySelector('[data-v25-tb="redo"]')?.addEventListener('click', () => toolbarRun('redo', () => redo()));
  toolbar.querySelector('[data-v25-tb="save"]')?.addEventListener('click', () => toolbarRunAsync('saveEditsAndGetReport', () => saveEditsAndGetReport()));
  toolbar.querySelector('[data-v25-tb="load"]')?.addEventListener('click', () => toolbarRunAsync('loadEditsAndGetReport', () => loadEditsAndGetReport()));
  toolbar.querySelector('[data-v25-tb="panel"]')?.addEventListener('click', () => showEditPanel());
}

function toolbarRun(name, fn) {
  try {
    const result = fn();
    refreshSvgEditToolbar();
    return result;
  } catch (err) {
    console.warn(`[Essam ${VERSION}] Toolbar action failed: ${name}`, err);
    return { ok: false, action: name, error: err?.message || String(err) };
  }
}

async function toolbarRunAsync(name, fn) {
  try {
    const result = await fn();
    refreshSvgEditToolbar();
    return result;
  } catch (err) {
    console.warn(`[Essam ${VERSION}] Toolbar async action failed: ${name}`, err);
    return { ok: false, action: name, error: err?.message || String(err) };
  }
}

function refreshSvgEditToolbar() {
  const toolbar = state.svgToolbar || getV24Overlay()?.querySelector?.('#essam-v25-svg-toolbar');
  if (!toolbar) return { ok: false, reason: 'toolbar-not-created' };
  const stats = getStats();
  const selectedCount = getSelectedCountFromV24();
  const selection = toolbar.querySelector('[data-v25-toolbar-selection]');
  const statText = toolbar.querySelector('[data-v25-toolbar-stats]');
  if (selection) selection.textContent = `${selectedCount} selected`;
  if (statText) statText.textContent = `hidden ${stats.hidden} · deleted ${stats.deleted} · moved ${stats.movedLayer} · undo ${stats.undo} · redo ${stats.redo}`;
  const layerInput = toolbar.querySelector('[data-v25-tb-layer]');
  const layerSelect = toolbar.querySelector('[data-v25-tb-layer-select]');
  const layerOptions = getLayerMoveOptions();
  state.lastToolbarLayerOptions = layerOptions;
  if (layerSelect) {
    const current = layerSelect.value;
    layerSelect.innerHTML = layerOptions.rows.map((row) => `<option value="${escapeHtml(row.layer)}">${escapeHtml(row.label)}</option>`).join('');
    if (current && layerOptions.rows.some((row) => row.layer === current)) layerSelect.value = current;
    else if (layerOptions.recommendedTarget) layerSelect.value = layerOptions.recommendedTarget;
  }
  if (layerInput && layerInput.value && layerSelect) layerSelect.value = '';
  const needsSelection = toolbar.querySelectorAll('[data-v25-tb="hide"], [data-v25-tb="delete"], [data-v25-tb="restore"], [data-v25-tb="move"]');
  needsSelection.forEach((btn) => { btn.disabled = selectedCount <= 0; });
  return { ok: true, version: VERSION, selectedCount, stats, toolbarVisible: state.svgToolbarVisible };
}

function showSvgEditToolbar() {
  state.svgToolbarVisible = true;
  const ensured = ensureSvgEditToolbar();
  if (state.svgToolbar) state.svgToolbar.style.display = 'flex';
  return { ...ensured, visible: true, refresh: refreshSvgEditToolbar() };
}

function hideSvgEditToolbar() {
  state.svgToolbarVisible = false;
  const toolbar = state.svgToolbar || getV24Overlay()?.querySelector?.('#essam-v25-svg-toolbar');
  if (toolbar) toolbar.style.display = 'none';
  return { ok: true, visible: false };
}

function toggleSvgEditToolbar() {
  return state.svgToolbarVisible ? hideSvgEditToolbar() : showSvgEditToolbar();
}

function getSvgEditToolbarSummary() {
  return {
    ok: true,
    version: VERSION,
    visible: state.svgToolbarVisible,
    exists: !!(state.svgToolbar || getV24Overlay()?.querySelector?.('#essam-v25-svg-toolbar')),
    refresh: refreshSvgEditToolbar(),
  };
}

function injectSvgToolbarStyles() {
  if (document.getElementById('essam-v25-svg-toolbar-style')) return;
  const style = document.createElement('style');
  style.id = 'essam-v25-svg-toolbar-style';
  style.textContent = `
    #essam-v25-svg-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 10px;
      background: #142233;
      color: #eef7ff;
      border-bottom: 1px solid rgba(255,255,255,.12);
      font: 12px Arial, sans-serif;
      direction: ltr;
    }
    #essam-v25-svg-toolbar .essam-v25-svg-toolbar-left,
    #essam-v25-svg-toolbar .essam-v25-svg-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-wrap: wrap;
    }
    #essam-v25-svg-toolbar [data-v25-toolbar-selection] {
      color: #ffe8a5;
      background: rgba(255,196,64,.13);
      border: 1px solid rgba(255,196,64,.22);
      border-radius: 999px;
      padding: 3px 8px;
    }
    #essam-v25-svg-toolbar [data-v25-toolbar-stats] { opacity: .78; }
    #essam-v25-svg-toolbar button,
    #essam-v25-svg-toolbar input,
    #essam-v25-svg-toolbar select {
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 7px;
      background: #26384a;
      color: #fff;
      padding: 5px 8px;
      font-size: 11px;
    }
    #essam-v25-svg-toolbar input,
    #essam-v25-svg-toolbar select {
      width: 150px;
      background: #0f1823;
    }
    #essam-v25-svg-toolbar [data-v25-tb-layer] { width: 110px; }
    #essam-v25-svg-toolbar button:disabled {
      opacity: .45;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

function ensureEditPanel() {
  if (state.panel && document.body.contains(state.panel)) return state.panel;
  injectPanelStyles();
  const el = document.createElement('div');
  el.id = 'essam-v25-edit-panel';
  el.innerHTML = `
    <div class="essam-v25-panel-header">
      <strong>V25 Edits</strong>
      <span data-v25-project class="essam-v25-project"></span>
      <button type="button" data-v25-action="hide-panel">×</button>
    </div>
    <div class="essam-v25-panel-body">
      <div class="essam-v25-stats" data-v25-stats></div>
      <div class="essam-v25-actions">
        <button type="button" data-v25-action="undo">Undo</button>
        <button type="button" data-v25-action="redo">Redo</button>
        <button type="button" data-v25-action="apply">Apply</button>
        <button type="button" data-v25-action="save">Save</button>
        <button type="button" data-v25-action="load">Load</button>
        <button type="button" data-v25-action="export">Export</button>
        <button type="button" data-v25-action="verify">Verify moves</button>
        <button type="button" data-v25-action="clear">Clear</button>
      </div>
      <pre data-v25-log class="essam-v25-log"></pre>
    </div>
  `;
  document.body.appendChild(el);
  state.panel = el;
  el.querySelector('[data-v25-action="hide-panel"]').addEventListener('click', hideEditPanel);
  el.querySelector('[data-v25-action="undo"]').addEventListener('click', () => panelRun('undo', () => undo()));
  el.querySelector('[data-v25-action="redo"]').addEventListener('click', () => panelRun('redo', () => redo()));
  el.querySelector('[data-v25-action="apply"]').addEventListener('click', () => panelRun('apply', () => applyEditsToSvg()));
  el.querySelector('[data-v25-action="save"]').addEventListener('click', () => panelRunAsync('save+report', () => saveEditsAndGetReport()));
  el.querySelector('[data-v25-action="load"]').addEventListener('click', () => panelRunAsync('load+report', () => loadEditsAndGetReport()));
  el.querySelector('[data-v25-action="export"]').addEventListener('click', () => panelRun('export', () => exportEditsJson()));
  el.querySelector('[data-v25-action="verify"]').addEventListener('click', () => panelRun('verifyLayerMoveApplication', () => verifyLayerMoveApplication()));
  el.querySelector('[data-v25-action="clear"]').addEventListener('click', () => {
    if (confirm('Clear all V25 delta edits for the current in-memory state?')) panelRun('clearEdits', () => clearEdits());
  });
  refreshEditPanel();
  return el;
}

function injectPanelStyles() {
  if (document.getElementById('essam-v25-edit-panel-style')) return;
  const style = document.createElement('style');
  style.id = 'essam-v25-edit-panel-style';
  style.textContent = `
    #essam-v25-edit-panel {
      position: fixed;
      right: 18px;
      bottom: 18px;
      width: 340px;
      max-height: 76vh;
      z-index: 2147482600;
      display: none;
      flex-direction: column;
      background: #101820;
      color: #f3f8ff;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 12px 34px rgba(0,0,0,.42);
      font: 12px Arial, sans-serif;
      direction: ltr;
    }
    #essam-v25-edit-panel .essam-v25-panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 10px;
      background: #182638;
      border-bottom: 1px solid rgba(255,255,255,.12);
    }
    #essam-v25-edit-panel .essam-v25-panel-header strong { font-size: 13px; }
    #essam-v25-edit-panel .essam-v25-project {
      flex: 1;
      opacity: .75;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #essam-v25-edit-panel button {
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 7px;
      background: #26384a;
      color: #fff;
      padding: 5px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    #essam-v25-edit-panel button:hover { background: #31506c; }
    #essam-v25-edit-panel .essam-v25-panel-body { padding: 10px; overflow: auto; }
    #essam-v25-edit-panel .essam-v25-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 10px;
    }
    #essam-v25-edit-panel .essam-v25-stat {
      background: rgba(255,255,255,.07);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 10px;
      padding: 7px 6px;
      text-align: center;
    }
    #essam-v25-edit-panel .essam-v25-stat b { display: block; font-size: 16px; }
    #essam-v25-edit-panel .essam-v25-stat span { opacity: .72; }
    #essam-v25-edit-panel .essam-v25-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    #essam-v25-edit-panel .essam-v25-log {
      max-height: 180px;
      overflow: auto;
      margin: 0;
      padding: 8px;
      border-radius: 9px;
      background: rgba(0,0,0,.3);
      color: #d6e8ff;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(style);
}

function showEditPanel() {
  const panel = ensureEditPanel();
  panel.style.display = 'flex';
  state.panelVisible = true;
  refreshEditPanel();
  return getEditPanelSummary();
}

function hideEditPanel() {
  if (state.panel) state.panel.style.display = 'none';
  state.panelVisible = false;
  return getEditPanelSummary();
}

function toggleEditPanel() {
  return state.panelVisible ? hideEditPanel() : showEditPanel();
}

function getEditPanelSummary() {
  return { ok: true, version: VERSION, visible: state.panelVisible, exists: !!state.panel, stats: getStats(), projectKey: getProjectKey() };
}

function refreshEditPanel() {
  if (!state.panel || !document.body.contains(state.panel)) return { ok: false, reason: 'panel-not-created' };
  const stats = getStats();
  const project = state.panel.querySelector('[data-v25-project]');
  if (project) project.textContent = getProjectKey();
  const statsEl = state.panel.querySelector('[data-v25-stats]');
  if (statsEl) {
    statsEl.innerHTML = [
      ['hidden', stats.hidden],
      ['deleted', stats.deleted],
      ['moved', stats.movedLayer],
      ['undo', stats.undo],
      ['redo', stats.redo],
      ['modified', stats.modified],
      ['apply', state.applyCount],
      ['auto', state.autoApply ? 'on' : 'off'],
    ].map(([label, value]) => `<div class="essam-v25-stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('');
  }
  return { ok: true, stats };
}

function panelLog(name, value) {
  const panel = ensureEditPanel();
  const log = panel.querySelector('[data-v25-log]');
  const summary = summarizePanelResult(value);
  if (log) log.textContent = `${new Date().toLocaleTimeString()} — ${name}\n${JSON.stringify(summary, null, 2)}`;
  refreshEditPanel();
  return value;
}

function panelRun(name, fn) {
  try { return panelLog(name, fn()); }
  catch (err) { return panelLog(name, { ok: false, error: err?.message || String(err) }); }
}

async function panelRunAsync(name, fn) {
  try { return panelLog(name, await fn()); }
  catch (err) { return panelLog(name, { ok: false, error: err?.message || String(err) }); }
}

function summarizePanelResult(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    ok: value.ok,
    reason: value.reason,
    action: value.action,
    stats: value.stats || getStats(),
    apply: value.apply ? { ok: value.apply.ok, touched: value.apply.touched, movedApplied: value.apply.movedApplied, movedMissing: value.apply.movedMissing } : undefined,
    key: value.key,
    savedAt: value.savedAt,
    loadedAt: value.loadedAt,
    failed: value.failed,
    checked: value.checked,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
}

function getSummary() {
  return {
    installed: true,
    version: VERSION,
    projectKey: getProjectKey(),
    hasV23: !!window.__essamV23,
    hasV24: !!window.__essamV24,
    hasActiveSvg: !!getActiveSvg(),
    autoApply: state.autoApply,
    autoLoad: state.autoLoad,
    wrappedV24: state.wrappedV24,
    loadedKeys: Array.from(state.loadedKeys),
    stats: getStats(),
    edits: getEdits(),
    lastApply: state.lastApply,
    lastMoveReport: state.lastMoveReport,
    applyCount: state.applyCount,
    editPanel: getEditPanelSummary(),
    svgEditToolbar: getSvgEditToolbarSummary(),
    movedLayerReport: getMovedLayerReport(),
    layerMoveOptions: state.lastToolbarLayerOptions,
    lastPersistenceReport: state.lastPersistenceReport,
    lastSave: state.lastSave,
    lastLoad: state.lastLoad,
    lastAutoApply: state.lastAutoApply,
  };
}

function sanitizeFileName(name) {
  return String(name || 'edits.json').replace(/[^a-zA-Z0-9_.\-\u0600-\u06FF]+/g, '_');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

window.__essamV25 = {
  version: VERSION,
  getSummary,
  getEdits,
  getStats,
  applyEditsToSvg,
  hideSelectedAsEdit,
  unhideSelectedAsEdit,
  deleteSelectedAsEdit,
  restoreSelectedAsEdit,
  moveSelectedToLayerAsEdit,
  moveIdsToLayerAsEdit,
  getAvailableSvgLayers,
  getLayerMoveOptions,
  setToolbarTargetLayer,
  getMovedLayerReport,
  verifyLayerMoveApplication,
  hideIdsAsEdit,
  deleteIdsAsEdit,
  undo,
  redo,
  clearEdits,
  exportEditsJson,
  saveEditsToIndexedDb,
  loadEditsFromIndexedDb,
  loadAndApplyEditsFromIndexedDb,
  getEditPersistenceReport,
  saveEditsAndGetReport,
  loadEditsAndGetReport,
  exportEditPersistenceReport,
  autoLoadAndApplyEdits,
  wrapV24PreviewFunctions,
  setAutoApply,
  setAutoLoad,
  resetLoadedEditCache,
  showEditPanel,
  hideEditPanel,
  toggleEditPanel,
  refreshEditPanel,
  getEditPanelSummary,
  ensureSvgEditToolbar,
  showSvgEditToolbar,
  hideSvgEditToolbar,
  toggleSvgEditToolbar,
  refreshSvgEditToolbar,
  getSvgEditToolbarSummary,
};

// Best-effort wrap. If V24 is loaded later, retry briefly.
wrapV24PreviewFunctions();
const __v25WrapTimer = setInterval(() => {
  const result = wrapV24PreviewFunctions();
  if (result.ok || state.wrappedV24) clearInterval(__v25WrapTimer);
}, 500);
setTimeout(() => clearInterval(__v25WrapTimer), 10000);

console.info(`[Essam V25.6] Delta Edit System with layer dropdown polish + persistence reports installed. Use window.__essamV25.getSummary()`);

export default window.__essamV25;
