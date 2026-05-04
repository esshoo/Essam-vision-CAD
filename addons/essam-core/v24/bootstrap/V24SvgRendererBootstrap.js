/**
 * V24SvgRendererBootstrap.js
 * V24.5 SVG Entity Selection Prototype.
 * Adds a safe SVG renderer beside the current PDF/CAD viewer.
 * It does not replace current 2D rendering.
 */
import { compilePageToSvg, getSvgPageCompileEstimate, diagnoseSvgPageData, getSvgLayerStats } from '../renderers/svg2d/SvgPageCompiler.js';

const VERSION = 'V24.5.1-svg-selection-recursion-fix';
const state = {
  installedAt: new Date().toISOString(),
  lastCompile: null,
  lastPreview: null,
  overlay: null,
  coordinateMode: localStorage.getItem('essam-v24-coordinate-mode') || 'normalized-flip-y',
  debug: false,
  selectedEntityIds: new Set(),
  selectionStats: { clicks: 0, lastSelectedId: null, lastEventAt: null },
};

function ensurePackage() {
  if (!window.__essamV23) throw new Error('V23 is not installed. Load V23DocumentPackageBootstrap.js before V24.');
  if (!window.__essamV23.getCurrentPackage) throw new Error('V23.2 accessors are required. Install the V24 patch replacement for V23 bootstrap.');
  return window.__essamV23.getCurrentPackage();
}

function getCoordinateMode(options = {}) {
  return options.coordinateMode || state.coordinateMode || 'normalized-flip-y';
}

function setCoordinateMode(mode = 'normalized-flip-y') {
  const allowed = new Set(['normalized', 'normalized-flip-y', 'raw']);
  const next = allowed.has(String(mode)) ? String(mode) : 'normalized-flip-y';
  state.coordinateMode = next;
  try { localStorage.setItem('essam-v24-coordinate-mode', next); } catch (_) {}
  return getSummary();
}

function toggleCoordinateMode() {
  return setCoordinateMode(state.coordinateMode === 'normalized-flip-y' ? 'normalized' : 'normalized-flip-y');
}

function compileCurrentPageToSvg(options = {}) {
  const pkg = ensurePackage();
  const page = Number(options.page || getCurrentPage() || 1) || 1;
  const result = compilePageToSvg(pkg, { coordinateMode: getCoordinateMode(options), page, ...(options || {}) });
  state.lastCompile = { at: new Date().toISOString(), stats: result.stats };
  return result;
}

function estimateCurrentPageSvg(options = {}) {
  const pkg = ensurePackage();
  const page = Number(options.page || getCurrentPage() || 1) || 1;
  return getSvgPageCompileEstimate(pkg, { coordinateMode: getCoordinateMode(options), page, ...(options || {}) });
}
function diagnoseCurrentPageSvg(options = {}) {
  const pkg = ensurePackage();
  const page = Number(options.page || getCurrentPage() || 1) || 1;
  return diagnoseSvgPageData(pkg, { coordinateMode: getCoordinateMode(options), page, ...(options || {}) });
}

function getCurrentPageLayerStats(options = {}) {
  const pkg = ensurePackage();
  const page = Number(options.page || getCurrentPage() || 1) || 1;
  return getSvgLayerStats(pkg, { coordinateMode: getCoordinateMode(options), page, ...(options || {}) });
}

async function showSvgProgressivePreview(options = {}) {
  const limits = Array.isArray(options.limits) && options.limits.length
    ? options.limits.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [15000, 30000, 60000, 100000, Number(options.maxEntities || 160000)].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
  const delayMs = Number(options.delayMs || 140);
  const overlay = ensureOverlay();
  overlay.style.display = 'flex';
  let last = null;
  state.progressiveRun = { startedAt: new Date().toISOString(), limits, current: 0, done: false };
  for (const limit of limits) {
    if (state.progressiveRun.cancelled) break;
    last = showSvgPreview({
      ...options,
      maxEntities: limit,
      coordinateMode: getCoordinateMode(options),
      limitStrategy: options.limitStrategy || 'balanced-by-layer',
      boundsMode: options.boundsMode || 'robust',
    });
    state.progressiveRun.current = limit;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  state.progressiveRun.done = true;
  state.progressiveRun.finishedAt = new Date().toISOString();
  return { ok: true, last, progressiveRun: state.progressiveRun };
}

function cancelSvgProgressivePreview() {
  if (state.progressiveRun) state.progressiveRun.cancelled = true;
  return { ok: true, progressiveRun: state.progressiveRun || null };
}


function downloadCurrentPageSvg(options = {}) {
  const full = options.full === true;
  const maxEntities = full ? 0 : Number(options.maxEntities || 50000);
  const result = compileCurrentPageToSvg({ ...options, maxEntities });
  const fileName = sanitizeFileName(`${window.__essamV23.getSummary()?.currentFile?.name || 'active-file'}_page-${result.stats.page}_v24.svg`);
  return downloadText(fileName, result.svgText, 'image/svg+xml;charset=utf-8', { stats: result.stats });
}

function showSvgPreview(options = {}) {
  const maxEntities = Number(options.maxEntities || 25000);
  const result = compileCurrentPageToSvg({ ...options, maxEntities });
  const overlay = ensureOverlay();
  const body = overlay.querySelector('[data-essam-v24-body]');
  const title = overlay.querySelector('[data-essam-v24-title]');
  title.textContent = `V24.3 SVG Preview — page ${result.stats.page} — ${result.stats.outputEntities}/${result.stats.inputEntities} entities — ${result.stats.boundsMode} bounds`;
  body.innerHTML = result.svgText;
  overlay.style.display = 'flex';
  state.lastPreview = { at: new Date().toISOString(), stats: result.stats };
  clearSvgSelection({ silent: true });
  installSvgSelectionHandlers();
  refreshSvgLayerPanel();
  return { ok: true, stats: result.stats, truncated: result.stats.truncated, layerStats: getSvgDomLayerStats(), selection: getSvgSelectionSummary() };
}


function showSvgFullCoveragePreview(options = {}) {
  return showSvgPreview({
    maxEntities: Number(options.maxEntities || 50000),
    limitStrategy: 'balanced-by-layer',
    coordinateMode: getCoordinateMode(options),
    boundsMode: 'robust',
    ...(options || {}),
  });
}

function showSvgPreviewNormal(options = {}) {
  return showSvgPreview({ ...(options || {}), coordinateMode: 'normalized' });
}

function showSvgPreviewFlipped(options = {}) {
  return showSvgPreview({ ...(options || {}), coordinateMode: 'normalized-flip-y' });
}

async function showSvgProgressivePreviewNormal(options = {}) {
  return showSvgProgressivePreview({ ...(options || {}), coordinateMode: 'normalized' });
}

async function showSvgProgressivePreviewFlipped(options = {}) {
  return showSvgProgressivePreview({ ...(options || {}), coordinateMode: 'normalized-flip-y' });
}


function getActiveSvg() {
  const overlay = state.overlay || document.getElementById('essam-v24-svg-preview');
  return overlay?.querySelector?.('svg[data-essam-svg]') || null;
}

function normalizeLayerName(layerName) {
  return String(layerName || '').trim();
}

function getLayerGroup(layerName) {
  const layer = normalizeLayerName(layerName);
  const svg = getActiveSvg();
  if (!svg || !layer) return null;
  const groups = Array.from(svg.querySelectorAll('g.essam-layer[data-layer]'));
  return groups.find((g) => String(g.getAttribute('data-layer') || '') === layer) || null;
}

function setSvgLayerVisibility(layerName, visible = true) {
  const group = getLayerGroup(layerName);
  if (!group) return { ok: false, reason: 'layer-not-found', layer: layerName };
  const isVisible = visible !== false;
  group.style.display = isVisible ? '' : 'none';
  group.setAttribute('data-visible2d', isVisible ? 'true' : 'false');
  refreshSvgLayerPanel({ preserveScroll: true });
  return { ok: true, layer: layerName, visible: isVisible };
}

function hideSvgLayer(layerName) { return setSvgLayerVisibility(layerName, false); }
function showSvgLayer(layerName) { return setSvgLayerVisibility(layerName, true); }
function toggleSvgLayer(layerName) {
  const group = getLayerGroup(layerName);
  if (!group) return { ok: false, reason: 'layer-not-found', layer: layerName };
  return setSvgLayerVisibility(layerName, group.style.display === 'none');
}

function showAllSvgLayers() {
  const svg = getActiveSvg();
  if (!svg) return { ok: false, reason: 'no-active-svg' };
  let count = 0;
  svg.querySelectorAll('g.essam-layer[data-layer]').forEach((g) => {
    g.style.display = '';
    g.setAttribute('data-visible2d', 'true');
    count++;
  });
  refreshSvgLayerPanel({ preserveScroll: true });
  return { ok: true, visible: true, count };
}

function hideAllSvgLayers() {
  const svg = getActiveSvg();
  if (!svg) return { ok: false, reason: 'no-active-svg' };
  let count = 0;
  svg.querySelectorAll('g.essam-layer[data-layer]').forEach((g) => {
    g.style.display = 'none';
    g.setAttribute('data-visible2d', 'false');
    count++;
  });
  refreshSvgLayerPanel({ preserveScroll: true });
  return { ok: true, visible: false, count };
}

function isolateSvgLayer(layerName) {
  const layer = normalizeLayerName(layerName);
  const svg = getActiveSvg();
  if (!svg) return { ok: false, reason: 'no-active-svg' };
  let found = false;
  let count = 0;
  svg.querySelectorAll('g.essam-layer[data-layer]').forEach((g) => {
    const isTarget = String(g.getAttribute('data-layer') || '') === layer;
    g.style.display = isTarget ? '' : 'none';
    g.setAttribute('data-visible2d', isTarget ? 'true' : 'false');
    if (isTarget) found = true;
    count++;
  });
  refreshSvgLayerPanel({ preserveScroll: true });
  return { ok: found, layer, count, reason: found ? null : 'layer-not-found' };
}

function getSvgDomLayerStats() {
  const svg = getActiveSvg();
  if (!svg) return { ok: false, reason: 'no-active-svg', layers: [] };
  const layers = Array.from(svg.querySelectorAll('g.essam-layer[data-layer]')).map((g) => {
    const layer = g.getAttribute('data-layer') || '';
    const children = Math.max(0, g.children.length - 1); // title + entities
    const visible = g.style.display !== 'none';
    return { layer, visible, entityCount: children, id: g.id || '' };
  }).sort((a, b) => b.entityCount - a.entityCount || a.layer.localeCompare(b.layer));
  return {
    ok: true,
    version: VERSION,
    layerCount: layers.length,
    visibleCount: layers.filter((l) => l.visible).length,
    hiddenCount: layers.filter((l) => !l.visible).length,
    totalEntities: layers.reduce((sum, l) => sum + l.entityCount, 0),
    layers,
  };
}

function refreshSvgLayerPanel(options = {}) {
  const overlay = state.overlay || document.getElementById('essam-v24-svg-preview');
  if (!overlay) return { ok: false, reason: 'no-overlay' };
  const panel = overlay.querySelector('[data-essam-v24-layers]');
  if (!panel) return { ok: false, reason: 'no-layer-panel' };
  const oldScroll = panel.scrollTop;
  const stats = getSvgDomLayerStats();
  if (!stats.ok) {
    panel.innerHTML = '<div class="essam-v24-layer-empty">No active SVG layers.</div>';
    return stats;
  }
  const top = stats.layers;
  panel.innerHTML = `
    <div class="essam-v24-layer-toolbar">
      <button type="button" data-v24-layer-action="show-all">Show all</button>
      <button type="button" data-v24-layer-action="hide-all">Hide all</button>
    </div>
    <div class="essam-v24-layer-summary">${stats.visibleCount}/${stats.layerCount} visible · ${stats.totalEntities} entities</div>
    ${top.map((l) => `
      <label class="essam-v24-layer-row" title="${escapeHtml(l.layer)}">
        <input type="checkbox" data-v24-layer-toggle="${escapeHtml(l.layer)}" ${l.visible ? 'checked' : ''}>
        <span class="essam-v24-layer-name">${escapeHtml(l.layer)}</span>
        <span class="essam-v24-layer-count">${l.entityCount}</span>
        <button type="button" data-v24-layer-isolate="${escapeHtml(l.layer)}">solo</button>
      </label>
    `).join('')}
  `;
  panel.querySelectorAll('[data-v24-layer-toggle]').forEach((input) => {
    input.addEventListener('change', (event) => setSvgLayerVisibility(event.target.getAttribute('data-v24-layer-toggle'), event.target.checked));
  });
  panel.querySelectorAll('[data-v24-layer-isolate]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      isolateSvgLayer(btn.getAttribute('data-v24-layer-isolate'));
    });
  });
  const showAll = panel.querySelector('[data-v24-layer-action="show-all"]');
  const hideAll = panel.querySelector('[data-v24-layer-action="hide-all"]');
  showAll?.addEventListener('click', showAllSvgLayers);
  hideAll?.addEventListener('click', hideAllSvgLayers);
  if (options.preserveScroll) panel.scrollTop = oldScroll;
  return stats;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
}


function getSelectableSvgElements() {
  const svg = getActiveSvg();
  if (!svg) return [];
  return Array.from(svg.querySelectorAll('[data-entity-id]'));
}

function findSvgEntityElement(entityId) {
  const svg = getActiveSvg();
  if (!svg || !entityId) return null;
  const id = String(entityId);
  return getSelectableSvgElements().find((el) => String(el.getAttribute('data-entity-id') || '') === id) || null;
}

function getSvgSelectionSummary() {
  return {
    ok: true,
    version: VERSION,
    selectedCount: state.selectedEntityIds.size,
    selectedIds: Array.from(state.selectedEntityIds),
    stats: { ...state.selectionStats },
  };
}

function getSelectedSvgEntities() {
  const out = [];
  for (const id of state.selectedEntityIds) {
    const el = findSvgEntityElement(id);
    out.push({
      id,
      existsInDom: !!el,
      layer: el?.getAttribute?.('data-layer') || null,
      tagName: el?.tagName || null,
      visible: el ? el.style.display !== 'none' : null,
      className: el?.getAttribute?.('class') || '',
    });
  }
  return { ok: true, version: VERSION, selectedCount: out.length, entities: out };
}

function applySvgSelectionToDom() {
  for (const el of getSelectableSvgElements()) {
    const id = String(el.getAttribute('data-entity-id') || '');
    const selected = state.selectedEntityIds.has(id);
    el.classList.toggle('essam-svg-entity-selected', selected);
    if (selected) el.setAttribute('data-selected', 'true');
    else el.removeAttribute('data-selected');
  }
  updateSelectionBadge();
  return getSvgSelectionSummary();
}

function updateSelectionBadge() {
  const overlay = state.overlay || document.getElementById('essam-v24-svg-preview');
  const badge = overlay?.querySelector?.('[data-essam-v24-selection]');
  if (badge) badge.textContent = `${state.selectedEntityIds.size} selected`;
}

function clearSvgSelection(options = {}) {
  state.selectedEntityIds.clear();
  if (!options.silent) state.selectionStats.lastEventAt = new Date().toISOString();
  return applySvgSelectionToDom();
}

function selectSvgEntity(entityId, options = {}) {
  const id = String(entityId || '');
  if (!id) return { ok: false, reason: 'missing-entity-id' };
  if (!options.add) state.selectedEntityIds.clear();
  state.selectedEntityIds.add(id);
  state.selectionStats.lastSelectedId = id;
  state.selectionStats.lastEventAt = new Date().toISOString();
  return applySvgSelectionToDom();
}

function deselectSvgEntity(entityId) {
  const id = String(entityId || '');
  state.selectedEntityIds.delete(id);
  state.selectionStats.lastEventAt = new Date().toISOString();
  return applySvgSelectionToDom();
}

function toggleSvgEntitySelection(entityId, options = {}) {
  const id = String(entityId || '');
  if (!id) return { ok: false, reason: 'missing-entity-id' };
  if (!options.add && !state.selectedEntityIds.has(id)) state.selectedEntityIds.clear();
  if (state.selectedEntityIds.has(id)) state.selectedEntityIds.delete(id);
  else state.selectedEntityIds.add(id);
  state.selectionStats.lastSelectedId = id;
  state.selectionStats.lastEventAt = new Date().toISOString();
  return applySvgSelectionToDom();
}

function hideSelectedSvgEntities() {
  let changed = 0;
  for (const id of Array.from(state.selectedEntityIds)) {
    const el = findSvgEntityElement(id);
    if (!el) continue;
    el.style.display = 'none';
    el.setAttribute('data-preview-hidden', 'true');
    changed += 1;
  }
  return { ok: true, mode: 'preview-only', changed, selection: getSvgSelectionSummary() };
}

function showPreviewHiddenSvgEntities() {
  let changed = 0;
  const svg = getActiveSvg();
  svg?.querySelectorAll?.('[data-preview-hidden="true"]').forEach((el) => {
    el.style.display = '';
    el.removeAttribute('data-preview-hidden');
    changed += 1;
  });
  return { ok: true, mode: 'preview-only', changed };
}

function deleteSelectedSvgEntitiesFromPreview() {
  let changed = 0;
  for (const id of Array.from(state.selectedEntityIds)) {
    const el = findSvgEntityElement(id);
    if (!el) continue;
    el.remove();
    changed += 1;
  }
  state.selectedEntityIds.clear();
  applySvgSelectionToDom();
  refreshSvgLayerPanel({ preserveScroll: true });
  return { ok: true, mode: 'preview-only-not-persisted', changed };
}

function zoomToSelectedSvgEntities() {
  const svg = getActiveSvg();
  if (!svg || state.selectedEntityIds.size === 0) return { ok: false, reason: 'no-selection' };
  const boxes = [];
  for (const id of state.selectedEntityIds) {
    const el = findSvgEntityElement(id);
    if (!el?.getBBox) continue;
    try {
      const b = el.getBBox();
      if (Number.isFinite(b.x) && Number.isFinite(b.y) && b.width >= 0 && b.height >= 0) boxes.push(b);
    } catch (_) {}
  }
  if (!boxes.length) return { ok: false, reason: 'no-bounds' };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.18 + 20;
  const vb = `${Math.max(0, minX - pad)} ${Math.max(0, minY - pad)} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}`;
  svg.setAttribute('viewBox', vb);
  return { ok: true, viewBox: vb, selectedCount: state.selectedEntityIds.size };
}

function installSvgSelectionHandlers() {
  const overlay = state.overlay || ensureOverlay();
  const body = overlay?.querySelector?.('[data-essam-v24-body]');
  if (!body || body.__essamV245SelectionInstalled) return;
  body.__essamV245SelectionInstalled = true;

  body.addEventListener('click', (event) => {
    const target = event.target?.closest?.('[data-entity-id]');
    if (!target || !body.contains(target)) {
      if (!event.ctrlKey && !event.shiftKey && !event.metaKey) clearSvgSelection();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const id = target.getAttribute('data-entity-id');
    state.selectionStats.clicks += 1;
    toggleSvgEntitySelection(id, { add: event.ctrlKey || event.shiftKey || event.metaKey });
  }, true);
}

function hideSvgPreview() {
  if (state.overlay) state.overlay.style.display = 'none';
  return { ok: true };
}

function removeSvgPreview() {
  if (state.overlay) state.overlay.remove();
  state.overlay = null;
  return { ok: true };
}

function ensureOverlay() {
  if (state.overlay && document.body.contains(state.overlay)) return state.overlay;
  injectCss();
  const el = document.createElement('div');
  el.id = 'essam-v24-svg-preview';
  el.innerHTML = `
    <div class="essam-v24-panel">
      <div class="essam-v24-header">
        <strong data-essam-v24-title>V24 SVG Preview</strong>
        <div class="essam-v24-actions">
          <span class="essam-v24-selection-badge" data-essam-v24-selection>0 selected</span>
          <button type="button" data-essam-v24-clear-selection>Clear selection</button>
          <button type="button" data-essam-v24-refresh-layers>Refresh layers</button>
          <button type="button" data-essam-v24-download>Download SVG</button>
          <button type="button" data-essam-v24-close>Close</button>
        </div>
      </div>
      <div class="essam-v24-main">
        <aside class="essam-v24-layers" data-essam-v24-layers></aside>
        <div class="essam-v24-body" data-essam-v24-body></div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  // Important: assign state.overlay before installing handlers.
  // installSvgSelectionHandlers() calls ensureOverlay(), so assigning after it causes recursion.
  state.overlay = el;
  el.querySelector('[data-essam-v24-close]').addEventListener('click', hideSvgPreview);
  el.querySelector('[data-essam-v24-download]').addEventListener('click', () => downloadCurrentPageSvg({ maxEntities: state.lastPreview?.stats?.outputEntities || 50000 }));
  el.querySelector('[data-essam-v24-refresh-layers]').addEventListener('click', () => refreshSvgLayerPanel());
  el.querySelector('[data-essam-v24-clear-selection]').addEventListener('click', () => clearSvgSelection());
  installSvgSelectionHandlers();
  return el;
}

function injectCss() {
  if (document.getElementById('essam-v24-svg-preview-style')) return;
  const style = document.createElement('style');
  style.id = 'essam-v24-svg-preview-style';
  style.textContent = `
    #essam-v24-svg-preview {
      position: fixed;
      inset: 16px;
      z-index: 2147482000;
      display: none;
      align-items: stretch;
      justify-content: center;
      background: rgba(0,0,0,.42);
      direction: ltr;
    }
    #essam-v24-svg-preview .essam-v24-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #101418;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.45);
    }
    #essam-v24-svg-preview .essam-v24-header {
      min-height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      color: #f7fbff;
      background: #18212b;
      font: 13px Arial, sans-serif;
    }
    #essam-v24-svg-preview button {
      border: 1px solid rgba(255,255,255,.22);
      background: #26384a;
      color: #fff;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
    }
    #essam-v24-svg-preview .essam-v24-main {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 280px 1fr;
      overflow: hidden;
    }
    #essam-v24-svg-preview .essam-v24-layers {
      overflow: auto;
      background: #121a22;
      color: #dbeeff;
      border-inline-end: 1px solid rgba(255,255,255,.12);
      padding: 8px;
      font: 12px Arial, sans-serif;
    }
    #essam-v24-svg-preview .essam-v24-layer-toolbar {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    #essam-v24-svg-preview .essam-v24-layer-toolbar button,
    #essam-v24-svg-preview .essam-v24-layer-row button {
      font-size: 11px;
      padding: 3px 6px;
      border-radius: 6px;
    }
    #essam-v24-svg-preview .essam-v24-layer-summary {
      opacity: .85;
      margin-bottom: 8px;
    }
    #essam-v24-svg-preview .essam-v24-layer-row {
      display: grid;
      grid-template-columns: 18px 1fr auto auto;
      gap: 6px;
      align-items: center;
      padding: 5px 4px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      cursor: pointer;
    }
    #essam-v24-svg-preview .essam-v24-layer-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #essam-v24-svg-preview .essam-v24-layer-count {
      opacity: .75;
      font-variant-numeric: tabular-nums;
    }
    #essam-v24-svg-preview .essam-v24-selection-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(255, 196, 64, .16);
      color: #ffe9a8;
      border: 1px solid rgba(255, 196, 64, .26);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    #essam-v24-svg-preview [data-entity-id] {
      cursor: pointer;
    }
    #essam-v24-svg-preview .essam-svg-entity-selected {
      stroke: #ff3b30 !important;
      stroke-width: 2.25px !important;
      filter: drop-shadow(0 0 2px rgba(255, 59, 48, .85));
    }
    #essam-v24-svg-preview .essam-v24-body {
      flex: 1;
      overflow: auto;
      background: #fff;
    }
    #essam-v24-svg-preview svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;
  document.head.appendChild(style);
}

function getCurrentPage() {
  return Number(window.cadApp?._pdfCurrentPage || window.currentPdfPage || window.cadDrawingOverlay?.currentPage || 1) || 1;
}

function downloadText(fileName, text, type = 'text/plain;charset=utf-8', extra = {}) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, fileName, size: blob.size, ...extra };
}

function sanitizeFileName(name) {
  return String(name || 'page.svg').replace(/[^a-zA-Z0-9_.\-\u0600-\u06FF]+/g, '_');
}

function getSummary() {
  return {
    installed: true,
    version: VERSION,
    hasV23: !!window.__essamV23,
    hasV23PackageAccessors: !!window.__essamV23?.getCurrentPackage,
    currentPage: getCurrentPage(),
    coordinateMode: state.coordinateMode,
    lastCompile: state.lastCompile,
    lastPreview: state.lastPreview,
    activeSvgLayers: getSvgDomLayerStats(),
    selection: getSvgSelectionSummary(),
    progressiveRun: state.progressiveRun || null,
    v23: window.__essamV23?.getSummary?.() || null,
  };
}

window.__essamV24 = {
  version: VERSION,
  compileCurrentPageToSvg,
  estimateCurrentPageSvg,
  diagnoseCurrentPageSvg,
  getCurrentPageLayerStats,
  setCoordinateMode,
  toggleCoordinateMode,
  showSvgProgressivePreview,
  cancelSvgProgressivePreview,
  downloadCurrentPageSvg,
  showSvgPreview,
  showSvgPreviewNormal,
  showSvgPreviewFlipped,
  showSvgProgressivePreviewNormal,
  showSvgProgressivePreviewFlipped,
  showSvgFullCoveragePreview,
  getSvgDomLayerStats,
  getSvgSelectionSummary,
  getSelectedSvgEntities,
  selectSvgEntity,
  deselectSvgEntity,
  toggleSvgEntitySelection,
  clearSvgSelection,
  hideSelectedSvgEntities,
  showPreviewHiddenSvgEntities,
  deleteSelectedSvgEntitiesFromPreview,
  zoomToSelectedSvgEntities,
  refreshSvgLayerPanel,
  setSvgLayerVisibility,
  hideSvgLayer,
  showSvgLayer,
  toggleSvgLayer,
  isolateSvgLayer,
  showAllSvgLayers,
  hideAllSvgLayers,
  hideSvgPreview,
  removeSvgPreview,
  getSummary,
};

console.info(`[Essam V24.5.1] SVG entity selection prototype installed. Use window.__essamV24.diagnoseCurrentPageSvg()`);

export default window.__essamV24;
